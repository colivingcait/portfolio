/**
 * CSV parsing for bank statements (§7).
 *
 * Kept out of src/lib/engine deliberately: the engine stays pure and
 * dependency-free, and parsing is its own layer (§12). This module knows
 * nothing about the database either — text in, rows out.
 *
 * Every bank exports a different shape. Rather than a per-bank adapter, this
 * detects the handful of column conventions in use and normalises them into
 * one representation: credits positive, debits negative.
 */

import type { IsoDate } from '../engine/dates';
import type { RawTransaction } from '../engine/bank';

/** RFC 4180-ish: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const DATE_HEADERS = ['transaction date', 'posted date', 'post date', 'date', 'posting date'];
const DESCRIPTION_HEADERS = ['description', 'payee', 'memo', 'name', 'details', 'transaction', 'merchant'];
const AMOUNT_HEADERS = ['amount', 'transaction amount'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals', 'money out', 'payment'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits', 'money in'];
const BALANCE_HEADERS = ['balance', 'running balance', 'ending balance', 'available balance'];

export function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  // Exact match first — 'amount' should not lose to 'transaction amount type'.
  for (const candidate of candidates) {
    const exact = normalized.indexOf(candidate);
    if (exact !== -1) return exact;
  }
  for (const candidate of candidates) {
    const partial = normalized.findIndex((h) => h.includes(candidate));
    if (partial !== -1) return partial;
  }
  return -1;
}

export interface ColumnMap {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
}

export function detectColumns(headers: string[]): ColumnMap {
  return {
    date: findColumn(headers, DATE_HEADERS),
    description: findColumn(headers, DESCRIPTION_HEADERS),
    amount: findColumn(headers, AMOUNT_HEADERS),
    debit: findColumn(headers, DEBIT_HEADERS),
    credit: findColumn(headers, CREDIT_HEADERS),
    balance: findColumn(headers, BALANCE_HEADERS),
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Bank date formats, normalised to YYYY-MM-DD.
 *
 * US ordering (MM/DD) is assumed for slash dates, since every account here is
 * a US bank account. A two-digit year is read as 20xx.
 */
export function parseDate(raw: string): IsoDate | null {
  const value = raw.trim();
  if (value === '') return null;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const slash = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }

  const named = value.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (!month) return null;
    const year = named[3].length === 2 ? `20${named[3]}` : named[3];
    return `${year}-${String(month).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
  }

  const monthFirst = value.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    if (!month) return null;
    return `${monthFirst[3]}-${String(month).padStart(2, '0')}-${monthFirst[2].padStart(2, '0')}`;
  }

  return null;
}

/**
 * '$1,234.56' / '(45.00)' / '-45.00' / '45.00-' → integer cents.
 * Parentheses and a trailing minus both mean negative; banks use both.
 */
export function parseAmount(raw: string): number | null {
  const value = raw.trim();
  if (value === '') return null;

  const negative = /^\(.*\)$/.test(value) || value.endsWith('-');
  const cleaned = value.replace(/[$,()\s]/g, '').replace(/-/g, '');
  if (cleaned === '') return null;

  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) return null;

  const cents = Math.round(parsed * 100);
  const explicitMinus = value.trimStart().startsWith('-');
  return negative || explicitMinus ? -cents : cents;
}

export interface ParsedStatement {
  transactions: RawTransaction[];
  /** Rows that could not be read, with the reason and the raw line. */
  skipped: { line: number; reason: string; raw: string }[];
  columns: ColumnMap;
  headers: string[];
  /** Derived from a running-balance column when the file has one. */
  impliedOpeningBalanceCents: number | null;
  impliedClosingBalanceCents: number | null;
}

export interface ParseOptions {
  /**
   * Some exports list every amount as a positive number in one column, with
   * direction implied elsewhere. Where that is the case the importer offers
   * this rather than guessing.
   */
  flipSign?: boolean;
}

export function parseStatement(text: string, options: ParseOptions = {}): ParsedStatement {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      transactions: [],
      skipped: [],
      columns: { date: -1, description: -1, amount: -1, debit: -1, credit: -1, balance: -1 },
      headers: [],
      impliedOpeningBalanceCents: null,
      impliedClosingBalanceCents: null,
    };
  }

  const headers = rows[0];
  const columns = detectColumns(headers);
  const transactions: RawTransaction[] = [];
  const skipped: ParsedStatement['skipped'] = [];

  // A file with no recognisable date column is not a statement we can read;
  // report every row rather than silently importing nothing.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const raw = row.join(',');

    const date = columns.date >= 0 ? parseDate(row[columns.date] ?? '') : null;
    if (!date) {
      skipped.push({ line: i + 1, reason: 'no readable date', raw });
      continue;
    }

    let amountCents: number | null = null;
    if (columns.amount >= 0) {
      amountCents = parseAmount(row[columns.amount] ?? '');
    }
    if (amountCents === null && (columns.debit >= 0 || columns.credit >= 0)) {
      const debit = columns.debit >= 0 ? (parseAmount(row[columns.debit] ?? '') ?? 0) : 0;
      const credit = columns.credit >= 0 ? (parseAmount(row[columns.credit] ?? '') ?? 0) : 0;
      // Debit columns are conventionally positive magnitudes.
      amountCents = credit - Math.abs(debit);
    }
    if (amountCents === null) {
      skipped.push({ line: i + 1, reason: 'no readable amount', raw });
      continue;
    }

    const description = (columns.description >= 0 ? (row[columns.description] ?? '') : '').trim();
    const balance = columns.balance >= 0 ? parseAmount(row[columns.balance] ?? '') : null;

    transactions.push({
      date,
      description: description || '(no description)',
      amountCents: options.flipSign ? -amountCents : amountCents,
      runningBalanceCents: balance,
    });
  }

  // A running balance lets the importer propose the opening and closing
  // figures rather than making someone read them off a PDF.
  const withBalance = transactions.filter((t) => t.runningBalanceCents !== null && t.runningBalanceCents !== undefined);
  const ordered = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const firstWithBalance = ordered.find((t) => t.runningBalanceCents !== null && t.runningBalanceCents !== undefined);
  const lastWithBalance = [...ordered].reverse().find((t) => t.runningBalanceCents !== null && t.runningBalanceCents !== undefined);

  return {
    transactions,
    skipped,
    columns,
    headers,
    impliedOpeningBalanceCents:
      withBalance.length > 0 && firstWithBalance
        ? (firstWithBalance.runningBalanceCents as number) - firstWithBalance.amountCents
        : null,
    impliedClosingBalanceCents:
      withBalance.length > 0 && lastWithBalance ? (lastWithBalance.runningBalanceCents as number) : null,
  };
}
