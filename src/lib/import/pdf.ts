/**
 * PDF bank statements (§7).
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

function leadingDate(line: PdfLine): { date: string; rest: string } | null {
  const text = line.text;
  const match = text.match(/^\s*(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\s+\d{1,2},?\s*\d{0,4})/);
  if (!match) return null;

  let candidate = match[1];
  // A statement often omits the year on each row; the period supplies it.
  if (/^\d{1,2}[/-]\d{1,2}$/.test(candidate)) candidate = `${candidate}/${new Date().getUTCFullYear()}`;

  const date = parseDate(candidate);
  if (!date) return null;
  return { date, rest: text.slice(match[0].length).trim() };
}

const OPENING_LABELS = /(beginning|opening|previous|starting)\s+balance/i;
const CLOSING_LABELS = /(ending|closing|new|current)\s+balance/i;

export interface PdfStatementDraft {
  transactions: RawTransaction[];
  skipped: { line: number; reason: string; raw: string }[];
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  /** How each amount's direction was decided — shown to the user, not hidden. */
  signSource: 'running_balance' | 'column_position' | 'as_printed';
  lineCount: number;
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
  const candidates: {
    date: string;
    description: string;
    amount: { cents: number; x: number };
    balance: number | null;
    lineNumber: number;
  }[] = [];

  // Held on an object rather than in two locals: assigning inside the loop
  // below would otherwise narrow them to null for the code that follows.
  const summary: { opening: number | null; closing: number | null } = { opening: null, closing: null };

  lines.forEach((line, index) => {
    const amounts = amountsOn(line);

    // Summary lines carry the figures the balance check needs.
    if (OPENING_LABELS.test(line.text) && amounts.length > 0) {
      summary.opening = amounts[amounts.length - 1].cents;
      return;
    }
    if (CLOSING_LABELS.test(line.text) && amounts.length > 0) {
      summary.closing = amounts[amounts.length - 1].cents;
      return;
    }

    const dated = leadingDate(line);
    if (!dated || amounts.length === 0) return;

    let date = dated.date;
    if (opts.year && /^\d{4}/.test(date)) date = `${opts.year}${date.slice(4)}`;

    // Where a running balance is printed it is the rightmost figure.
    const hasBalance = amounts.length >= 2;
    const amount = hasBalance ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
    const balance = hasBalance ? amounts[amounts.length - 1].cents : null;

    const description = dated.rest
      .replace(new RegExp(amounts.map((a) => a.raw.replace(/[$()]/g, '\\$&')).join('|'), 'g'), '')
      .replace(/\s+/g, ' ')
      .trim();

    candidates.push({
      date,
      description: description || '(no description)',
      amount: { cents: amount.cents, x: amount.x },
      balance,
      lineNumber: index + 1,
    });
  });

  // Direction. A running balance settles it outright: the movement between one
  // row and the next IS the amount, sign included. Nothing needs guessing.
  const withBalances = candidates.filter((c) => c.balance !== null);
  let signSource: PdfStatementDraft['signSource'] = 'as_printed';

  if (withBalances.length >= 2 && summary.opening !== null) {
    signSource = 'running_balance';
    let previous: number = summary.opening;
    for (const candidate of candidates) {
      if (candidate.balance === null) continue;
      const delta = candidate.balance - previous;
      // Trust the delta only where it agrees in magnitude with the figure
      // printed on the row; otherwise the row is something else entirely.
      if (Math.abs(Math.abs(delta) - Math.abs(candidate.amount.cents)) <= 1) {
        candidate.amount.cents = delta;
      } else {
        skipped.push({
          line: candidate.lineNumber,
          reason: `balance moves by ${(delta / 100).toFixed(2)} but the row shows ${(candidate.amount.cents / 100).toFixed(2)}`,
          raw: `${candidate.date} ${candidate.description}`,
        });
      }
      previous = candidate.balance;
    }
  } else if (candidates.length > 0) {
    // No running balance: fall back to which column the figure sits in.
    // US statements conventionally print withdrawals left of deposits.
    const xs = [...new Set(candidates.map((c) => Math.round(c.amount.x)))].sort((a, b) => a - b);
    if (xs.length >= 2) {
      const split = (xs[0] + xs[xs.length - 1]) / 2;
      const spread = xs[xs.length - 1] - xs[0];
      if (spread > 20) {
        signSource = 'column_position';
        for (const candidate of candidates) {
          candidate.amount.cents =
            candidate.amount.x < split ? -Math.abs(candidate.amount.cents) : Math.abs(candidate.amount.cents);
        }
      }
    }
  }

  const failed = new Set(skipped.map((s) => s.line));

  return {
    transactions: candidates
      .filter((c) => !failed.has(c.lineNumber))
      .map((c) => ({
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
  };
}

/** Pull positioned text out of a PDF, page by page. */
export async function extractLines(data: Uint8Array): Promise<PdfLine[]> {
  // The legacy build is the one that runs outside a browser.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const lines: PdfLine[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];

    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const transform = item.transform as number[];
      items.push({ text: item.str, x: transform[4], y: transform[5] });
    }

    lines.push(...groupIntoLines(items, pageNumber));
  }

  await doc.cleanup();
  return lines;
}

/** A PDF, in the same shape the CSV path produces. */
export async function parsePdfStatement(
  data: Uint8Array,
  options: { flipSign?: boolean; year?: number } = {},
): Promise<ParsedStatement & { signSource: PdfStatementDraft['signSource'] }> {
  const lines = await extractLines(data);
  const draft = rowsFromLines(lines, { year: options.year });

  return {
    transactions: options.flipSign
      ? draft.transactions.map((t) => ({ ...t, amountCents: -t.amountCents }))
      : draft.transactions,
    skipped: draft.skipped,
    columns: { date: -1, description: -1, amount: -1, debit: -1, credit: -1, balance: -1 },
    headers: [],
    impliedOpeningBalanceCents: draft.openingBalanceCents,
    impliedClosingBalanceCents: draft.closingBalanceCents,
    signSource: draft.signSource,
  };
}
