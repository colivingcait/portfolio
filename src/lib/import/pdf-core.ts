/**
 * PDF bank statements (§7) — the pure half.
 *
 * No pdfjs in here, so this runs in a browser as happily as on a server. That
 * matters: extracting a statement client-side keeps a multi-megabyte file off
 * the wire entirely, and a serverless request body is capped well below what
 * a scanned statement can weigh.
 *
 * A statement PDF is a page of positioned text, not a table: there are no rows
 * or columns in the file, only glyphs at coordinates. Reconstructing the rows
 * is therefore heuristic, which would be alarming if anything downstream
 * trusted the result — but the balance check does not. A misread statement
 * fails to tie and is refused, exactly like a truncated CSV.
 *
 * Text extraction lives here; the reconstruction below it is pure and tested
 * without a PDF.
 */

import type { IsoDate } from '../engine/dates';
import type { Cents } from '../engine/money';
import type { RawTransaction } from '../engine/bank';
import { parseAmount, parseDate, type ParsedStatement } from './csv';

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
}

export interface PdfLine {
  page: number;
  y: number;
  text: string;
  items: PdfTextItem[];
}

/** Items on the same visual line, left to right. */
export function groupIntoLines(items: PdfTextItem[], page = 1, tolerance = 2): PdfLine[] {
  const rows: PdfTextItem[][] = [];

  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) <= tolerance);
    if (row) row.push(item);
    else rows.push([item]);
  }

  return rows.map((row) => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    return {
      page,
      y: ordered[0].y,
      text: ordered.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim(),
      items: ordered,
    };
  });
}

const MONEY = /^\(?-?\$?\d{1,3}(,\d{3})*(\.\d{2})?\)?-?$/;

/** Money-looking tokens on a line, with where they sit horizontally. */
function amountsOn(line: PdfLine): { cents: number; x: number; raw: string }[] {
  const found: { cents: number; x: number; raw: string }[] = [];
  for (const item of line.items) {
    for (const token of item.text.split(/\s+/)) {
      if (!MONEY.test(token)) continue;
      if (!/\d/.test(token)) continue;
      // A bare integer with no decimals is usually a reference or a date part.
      if (!token.includes('.')) continue;
      const cents = parseAmount(token);
      if (cents !== null) found.push({ cents, x: item.x, raw: token });
    }
  }
  return found;
}

function leadingDate(line: PdfLine, year?: number): { date: string; rest: string } | null {
  const text = line.text;
  const match = text.match(/^\s*(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\s+\d{1,2},?\s*\d{0,4})/);
  if (!match) return null;

  let candidate = match[1];
  // A statement often omits the year on each row; the period supplies it.
  // A bare 07/01 takes its year from the statement period, never from today:
  // importing a 2025 statement in 2026 would otherwise date every row wrong.
  if (/^\d{1,2}[/-]\d{1,2}$/.test(candidate)) {
    if (year === undefined) return null;
    candidate = `${candidate}/${year}`;
  }

  const date = parseDate(candidate);
  if (!date) return null;
  return { date, rest: text.slice(match[0].length).trim() };
}

const OPENING_LABELS = /(beginning|opening|previous|starting)\s+balance/i;
const CLOSING_LABELS = /(ending|closing|new)\s+balance/i;
const TOTAL_LINE = /^total\s+(.+?)\s*\$?[\d,]+\.\d{2}$/i;

/**
 * Which way the amounts in a section run.
 *
 * Plenty of statements — Chase's among them — print every figure as a bare
 * positive and convey direction by the heading it sits under. Reading the
 * headings is the only way those come out right.
 */
export type SectionDirection = 'credit' | 'debit' | 'ignore' | null;

export function directionOf(heading: string): SectionDirection {
  const text = heading.toLowerCase();

  // Recap blocks carry dates and amounts but no transactions. A daily ending
  // balance table in particular reads exactly like rows of money moving, and
  // importing it would double the statement.
  if (/(summary|daily ending balance|balance summary|totals?$)/.test(text)) return 'ignore';

  if (/(deposit|addition|credit)/.test(text)) return 'credit';
  if (/(withdrawal|debit|check|fee|charge|payment)/.test(text)) return 'debit';
  return null;
}

/** Returned by headingOf where a statement marks the end of a section. */
export const END_OF_SECTION = '\u0000end';

/** A heading is short, has no date and no money on it. */
function headingOf(line: PdfLine): string | null {
  const text = line.text.trim();

  // Some statements mark their sections explicitly in the text layer.
  const marker = text.match(/^\*start\*(.+)$/i);
  if (marker) return marker[1];
  if (/^\*end\*/i.test(text)) return END_OF_SECTION;

  if (text.length > 60 || text.length < 4) return null;
  if (/\d[\d,]*\.\d{2}/.test(text)) return null;
  if (/^\d{1,2}[/-]\d{1,2}/.test(text)) return null;

  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return null;
  // Headings are set in capitals on every statement I have seen.
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
  return upper > 0.85 ? text : null;
}

export interface PdfStatementDraft {
  transactions: RawTransaction[];
  skipped: { line: number; reason: string; raw: string }[];
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  /** How each amount's direction was decided — shown to the user, not hidden. */
  signSource: 'running_balance' | 'section_heading' | 'column_position' | 'as_printed';
  lineCount: number;
  /** A statement's own section totals, against what was parsed out of them. */
  sectionChecks: { section: string; statedCents: Cents; parsedCents: Cents; agrees: boolean }[];
  /** The period the statement covers, where it says so. */
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
}

/**
 * Rows out of reconstructed lines.
 *
 * Pure, so the awkward parts — which number is the amount, which is the running
 * balance, whether a row is a debit — are testable without a PDF anywhere near
 * them.
 */
export function rowsFromLines(lines: readonly PdfLine[], opts: { year?: number } = {}): PdfStatementDraft {
  const skipped: PdfStatementDraft['skipped'] = [];
  const summary: { opening: number | null; closing: number | null } = { opening: null, closing: null };
  const sectionChecks: PdfStatementDraft['sectionChecks'] = [];

  // The period tells us which year a bare 07/01 belongs to. Without it an old
  // statement imported today would land its rows in the current year.
  const period = findPeriodInLines(lines);
  const year = opts.year ?? (period.start ? Number(period.start.slice(0, 4)) : undefined);

  interface Candidate {
    date: string;
    description: string;
    amount: { cents: number; x: number };
    balance: number | null;
    section: string;
    direction: SectionDirection;
    lineNumber: number;
  }

  const candidates: Candidate[] = [];
  let section = '';
  let direction: SectionDirection = null;
  let previous: Candidate | null = null;

  lines.forEach((line, index) => {
    const heading = headingOf(line);
    if (heading === END_OF_SECTION) {
      section = '';
      direction = null;
      previous = null;
      return;
    }
    if (heading !== null) {
      const headingDirection = directionOf(heading);
      // A column header — DATE DESCRIPTION AMOUNT — is a heading by shape but
      // says nothing about direction. Treating it as one would clear the
      // section its own rows belong to.
      if (headingDirection !== null) {
        section = heading;
        direction = headingDirection;
      }
      previous = null;
      return;
    }

    const amounts = amountsOn(line);

    if (OPENING_LABELS.test(line.text) && amounts.length > 0) {
      summary.opening = amounts[amounts.length - 1].cents;
      previous = null;
      return;
    }
    if (CLOSING_LABELS.test(line.text) && amounts.length > 0) {
      summary.closing = amounts[amounts.length - 1].cents;
      previous = null;
      return;
    }

    if (direction === 'ignore') {
      previous = null;
      return;
    }

    // "Total Electronic Withdrawals  $9,911.00" — a check on the section, not a row.
    const total = line.text.match(TOTAL_LINE);
    if (total && amounts.length > 0) {
      sectionChecks.push({
        section: total[1].trim(),
        statedCents: Math.abs(amounts[amounts.length - 1].cents),
        parsedCents: 0,
        agrees: false,
      });
      previous = null;
      return;
    }

    const dated = leadingDate(line, year);
    if (!dated) {
      // A description continued onto the next line — the ACH originator name
      // usually lands here, and it is what a payee rule wants to match on.
      if (previous && amounts.length === 0 && line.text.length > 3 && !/^page \d/i.test(line.text)) {
        previous.description = `${previous.description} ${line.text}`.slice(0, 180).trim();
      }
      return;
    }
    if (amounts.length === 0) {
      previous = null;
      return;
    }

    const amount = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
    const balance = amounts.length >= 2 ? amounts[amounts.length - 1].cents : null;

    const description = dated.rest
      .replace(new RegExp(amounts.map((a) => a.raw.replace(/[$()]/g, '\\$&')).join('|'), 'g'), '')
      .replace(/\s+/g, ' ')
      .trim();

    const candidate: Candidate = {
      date: dated.date,
      description: description || '(no description)',
      amount: { cents: amount.cents, x: amount.x },
      balance,
      section,
      direction,
      lineNumber: index + 1,
    };
    candidates.push(candidate);
    previous = candidate;
  });

  let signSource: PdfStatementDraft['signSource'] = 'as_printed';

  // A genuine running-balance column shows up on most rows, not a handful.
  const withBalances = candidates.filter((c) => c.balance !== null);
  const hasBalanceColumn = candidates.length > 0 && withBalances.length / candidates.length >= 0.6;
  const sectioned = candidates.filter((c) => c.direction === 'credit' || c.direction === 'debit');
  const hasSections = candidates.length > 0 && sectioned.length / candidates.length >= 0.6;

  if (hasBalanceColumn && summary.opening !== null) {
    signSource = 'running_balance';
    let running: number = summary.opening;
    for (const candidate of candidates) {
      if (candidate.balance === null) continue;
      const delta = candidate.balance - running;
      if (Math.abs(Math.abs(delta) - Math.abs(candidate.amount.cents)) <= 1) {
        candidate.amount.cents = delta;
      } else {
        skipped.push({
          line: candidate.lineNumber,
          reason: `balance moves by ${(delta / 100).toFixed(2)} but the row shows ${(candidate.amount.cents / 100).toFixed(2)}`,
          raw: `${candidate.date} ${candidate.description}`,
        });
      }
      running = candidate.balance;
    }
  } else if (hasSections) {
    // Direction from the heading each row sits under.
    signSource = 'section_heading';
    for (const candidate of candidates) {
      const magnitude = Math.abs(candidate.amount.cents);
      candidate.amount.cents = candidate.direction === 'debit' ? -magnitude : magnitude;
    }
  } else if (candidates.length > 0) {
    const xs = [...new Set(candidates.map((c) => Math.round(c.amount.x)))].sort((a, b) => a - b);
    if (xs.length >= 2) {
      const split = (xs[0] + xs[xs.length - 1]) / 2;
      if (xs[xs.length - 1] - xs[0] > 20) {
        signSource = 'column_position';
        for (const candidate of candidates) {
          candidate.amount.cents =
            candidate.amount.x < split ? -Math.abs(candidate.amount.cents) : Math.abs(candidate.amount.cents);
        }
      }
    }
  }

  const failed = new Set(skipped.map((s) => s.line));
  const kept = candidates.filter((c) => !failed.has(c.lineNumber));

  // Tally each section against the total the statement printed for it.
  for (const check of sectionChecks) {
    const rows = kept.filter((c) => c.section.toLowerCase().includes(check.section.toLowerCase().split(' ')[0]));
    check.parsedCents = Math.abs(rows.reduce((sum, r) => sum + r.amount.cents, 0));
    check.agrees = Math.abs(check.parsedCents - check.statedCents) <= 1;
  }

  return {
    transactions: kept.map((c) => ({
      date: c.date,
      description: c.description,
      amountCents: c.amount.cents,
      runningBalanceCents: c.balance,
    })),
    skipped,
    openingBalanceCents: summary.opening,
    closingBalanceCents: summary.closing,
    signSource,
    lineCount: lines.length,
    sectionChecks,
    periodStart: period.start,
    periodEnd: period.end,
  };
}

/** The statement period, from whichever line prints it. */
function findPeriodInLines(lines: readonly PdfLine[]): { start: IsoDate | null; end: IsoDate | null } {
  const dateLike = '(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s*\\d{4})';
  const pattern = new RegExp(`${dateLike}\\s*(?:-|–|—|to|through)\\s*${dateLike}`, 'i');

  for (const line of lines.slice(0, 40)) {
    const match = line.text.match(pattern);
    if (!match) continue;
    const start = parseDate(match[1]);
    const end = parseDate(match[2]);
    if (start && end && start <= end) return { start, end };
  }
  return { start: null, end: null };
}

