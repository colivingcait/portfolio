/**
 * PadSplit exports (§6).
 *
 * Four files per month, and the semantics of three of them are not what their
 * column names say. Those traps are the whole reason this is a module rather
 * than a loop: the "Payout Month" column holds the EARNINGS month and is blank
 * on the month still collecting; unallocated adjustments carry no Property ID
 * at all, which is why credits have to come off earnings_table rather than
 * summary; and billed amounts arrive with charges negative.
 *
 * Text in, engine row shapes out. No database, no Next, nothing impure — the
 * engine in engine/padsplit.ts does the arithmetic and this only reads files.
 *
 * The column names below are matched generously and reported back. A header
 * this does not recognise is surfaced on the preview screen rather than
 * silently dropped, because a column read as the wrong thing is far worse than
 * one read as nothing.
 */

import { findColumn, parseAmount, parseCsv, parseDate } from './csv';
import type { MonthKey } from '../engine/dates';
import type {
  BilledKind,
  BilledLine,
  CollectionCategory,
  CollectionLine,
  EarningsTableRow,
  SummaryRow,
} from '../engine/padsplit';

export type PadSplitFileKind = 'summary' | 'billed' | 'collected' | 'earnings_table';

const PROPERTY_ID = ['property id', 'propertyid', 'property', 'psid', 'property external id'];
const ROOM_ID = ['room id', 'roomid', 'room', 'unit id', 'room external id'];
const MONTH = ['earnings month', 'month', 'earning month', 'period'];
const GROSS = ['gross', 'gross earnings', 'gross revenue', 'gross amount'];
const FEES = ['fees', 'fee', 'padsplit fees', 'service fees', 'total fees'];
const HOST_EARNINGS = ['host earnings', 'host earning', 'net earnings', 'host payout', 'earnings'];
const CREDITS = ['credits', 'credit', 'adjustments', 'total credits'];
const PAYOUT = ['payout', 'net payout', 'total payout', 'amount paid'];
const BILL_TYPE = ['bill type', 'billtype', 'type', 'charge type', 'category'];
const AMOUNT = ['amount', 'total', 'value'];
const PAYOUT_MONTH = ['payout month', 'payoutmonth'];
const CREATED = ['created', 'created date', 'created at', 'date created', 'date'];

/** A header we matched, for the preview to show what it decided. */
export interface ColumnReport {
  field: string;
  header: string | null;
  index: number;
}

export interface ParsedPadSplitFile {
  kind: PadSplitFileKind;
  /** Months present in the file, ascending. */
  months: MonthKey[];
  summary: SummaryRow[];
  billed: BilledLine[];
  collected: CollectionLine[];
  earnings: EarningsTableRow[];
  rowCount: number;
  /** Rows that could not be read, and why. */
  skipped: { line: number; reason: string; raw: string }[];
  /** What each field was matched to. */
  columns: ColumnReport[];
  /** Headers in the file that nothing claimed. */
  unrecognizedHeaders: string[];
}

export class UnknownPadSplitFileError extends Error {
  constructor(readonly headers: string[]) {
    super(
      `This does not look like a PadSplit export. Headers found: ${headers.filter(Boolean).join(', ') || '(none)'}`,
    );
    this.name = 'UnknownPadSplitFileError';
  }
}

/**
 * Which of the four files this is, from its headers alone.
 *
 * Order matters. earnings_table and summary both carry gross and fees, so the
 * columns unique to each are what separate them; collected and billed both
 * carry a bill type, and only collected has a created date.
 */
export function detectFileKind(headers: string[]): PadSplitFileKind | null {
  const has = (candidates: string[]) => findColumn(headers, candidates) !== -1;

  if (has(CREDITS) && has(PAYOUT)) return 'earnings_table';
  if (has(PAYOUT_MONTH) || (has(CREATED) && has(BILL_TYPE))) return 'collected';
  if (has(HOST_EARNINGS) && has(GROSS)) return 'summary';
  if (has(BILL_TYPE) && has(AMOUNT)) return 'billed';
  return null;
}

/** A month from anything a month column might hold: 2026-07, 07/2026, Jul 2026. */
export function parseMonth(raw: string): MonthKey | null {
  const value = raw.trim();
  if (value === '') return null;

  const iso = value.match(/^(\d{4})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}`;

  const slash = value.match(/^(\d{1,2})[-/](\d{4})$/);
  if (slash) return `${slash[2]}-${slash[1].padStart(2, '0')}`;

  // A full date in a month column is common enough to accept.
  const date = parseDate(value);
  if (date) return date.slice(0, 7);

  const named = value.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (named) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const index = months.indexOf(named[1].toLowerCase());
    if (index >= 0) return `${named[2]}-${String(index + 1).padStart(2, '0')}`;
  }
  return null;
}

/**
 * How a billed line is classified.
 *
 * A concession is money given back and arrives positive; a fine is a penalty;
 * everything else is a fee. Classified from the bill type text because the
 * export has no column for it.
 */
export function billedKindOf(billType: string, amountCents: number): BilledKind {
  const text = billType.toLowerCase();
  if (/concession|discount|waiver|waive|credit/.test(text)) return 'concession';
  if (/fine|penalt|violation|late fee/.test(text)) return 'fine';
  return amountCents > 0 ? 'concession' : 'fee';
}

/** Collected cash versus a correction to it. */
export function collectionCategoryOf(billType: string, rawCategory: string): CollectionCategory {
  const text = `${rawCategory} ${billType}`.toLowerCase();
  return /adjust|refund|reversal|correction|chargeback/.test(text) ? 'adjustment' : 'collected';
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function report(headers: string[], fields: Record<string, string[]>): { columns: ColumnReport[]; used: Set<number> } {
  const columns: ColumnReport[] = [];
  const used = new Set<number>();
  for (const [field, candidates] of Object.entries(fields)) {
    const index = findColumn(headers, candidates);
    columns.push({ field, header: index === -1 ? null : headers[index], index });
    if (index !== -1) used.add(index);
  }
  return { columns, used };
}

export function parsePadSplitFile(text: string): ParsedPadSplitFile {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new UnknownPadSplitFileError([]);

  const headers = rows[0].map((header) => header.trim());
  const kind = detectFileKind(headers);
  if (!kind) throw new UnknownPadSplitFileError(headers);

  const FIELDS: Record<PadSplitFileKind, Record<string, string[]>> = {
    summary: { propertyExternalId: PROPERTY_ID, earningsMonth: MONTH, gross: GROSS, fees: FEES, hostEarnings: HOST_EARNINGS },
    earnings_table: { propertyExternalId: PROPERTY_ID, earningsMonth: MONTH, gross: GROSS, fees: FEES, credits: CREDITS, payout: PAYOUT },
    billed: { propertyExternalId: PROPERTY_ID, roomExternalId: ROOM_ID, earningsMonth: MONTH, billType: BILL_TYPE, amount: AMOUNT },
    collected: { propertyExternalId: PROPERTY_ID, roomExternalId: ROOM_ID, billType: BILL_TYPE, amount: AMOUNT, payoutMonth: PAYOUT_MONTH, created: CREATED, category: ['category', 'status', 'kind'] },
  };

  const { columns, used } = report(headers, FIELDS[kind]);
  const at = (field: string) => columns.find((column) => column.field === field)?.index ?? -1;
  const cell = (row: string[], field: string) => (at(field) === -1 ? '' : (row[at(field)] ?? ''));

  const result: ParsedPadSplitFile = {
    kind,
    months: [],
    summary: [],
    billed: [],
    collected: [],
    earnings: [],
    rowCount: 0,
    skipped: [],
    columns,
    unrecognizedHeaders: headers.filter((header, index) => header !== '' && !used.has(index)),
  };

  const months = new Set<MonthKey>();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const raw = row.join(',');
    const skip = (reason: string) => result.skipped.push({ line: i + 1, reason, raw });

    if (kind === 'summary' || kind === 'earnings_table') {
      const month = parseMonth(cell(row, 'earningsMonth'));
      if (!month) {
        skip('no earnings month');
        continue;
      }
      const gross = parseAmount(cell(row, 'gross')) ?? 0;
      const fees = parseAmount(cell(row, 'fees')) ?? 0;
      months.add(month);

      if (kind === 'summary') {
        const propertyExternalId = blankToNull(cell(row, 'propertyExternalId'));
        if (!propertyExternalId) {
          skip('no property id');
          continue;
        }
        result.summary.push({
          propertyExternalId,
          earningsMonth: month,
          grossCents: gross,
          feesCents: fees,
          hostEarningsCents: parseAmount(cell(row, 'hostEarnings')) ?? gross - Math.abs(fees),
        });
      } else {
        // A blank property id is expected here and must be kept: an
        // unallocated adjustment is exactly what summary.csv loses.
        result.earnings.push({
          propertyExternalId: blankToNull(cell(row, 'propertyExternalId')),
          earningsMonth: month,
          grossCents: gross,
          feesCents: fees,
          creditsCents: parseAmount(cell(row, 'credits')) ?? 0,
          payoutCents: parseAmount(cell(row, 'payout')) ?? 0,
        });
      }
      result.rowCount += 1;
      continue;
    }

    const amount = parseAmount(cell(row, 'amount'));
    if (amount === null) {
      skip('no amount');
      continue;
    }
    const billType = cell(row, 'billType').trim();

    if (kind === 'billed') {
      const month = parseMonth(cell(row, 'earningsMonth'));
      if (!month) {
        skip('no earnings month');
        continue;
      }
      months.add(month);
      result.billed.push({
        propertyExternalId: blankToNull(cell(row, 'propertyExternalId')),
        roomExternalId: blankToNull(cell(row, 'roomExternalId')),
        earningsMonth: month,
        billType,
        kind: billedKindOf(billType, amount),
        amountCents: amount,
      });
      result.rowCount += 1;
      continue;
    }

    // collected
    const created = parseDate(cell(row, 'created'));
    if (!created) {
      skip('no created date');
      continue;
    }
    // Mislabelled on purpose: this column holds the EARNINGS month, and is
    // blank while that month is still collecting.
    const payoutMonthRaw = parseMonth(cell(row, 'payoutMonth'));
    months.add(payoutMonthRaw ?? created.slice(0, 7));
    result.collected.push({
      propertyExternalId: blankToNull(cell(row, 'propertyExternalId')),
      roomExternalId: blankToNull(cell(row, 'roomExternalId')),
      billType,
      category: collectionCategoryOf(billType, cell(row, 'category')),
      amountCents: amount,
      payoutMonthRaw,
      createdDate: created,
    });
    result.rowCount += 1;
  }

  result.months = [...months].sort();
  return result;
}
