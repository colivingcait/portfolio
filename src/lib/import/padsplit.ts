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
  PadSplitMonthTotal,
  SummaryRow,
} from '../engine/padsplit';

export type PadSplitFileKind = 'summary' | 'billed' | 'collected' | 'earnings_table';

/**
 * Header aliases, not exact names.
 *
 * The one export seen so far says "Booking Fees Amount"; a prior build of this
 * had already met "Booking Fee Amount", "Booking Fee" and "Booking Fees" in
 * the wild. A parser matching one exact string would keep working right up
 * until the day PadSplit changed a heading, and would then read that column as
 * absent — a zero, silently, in the middle of the money. Every alias below is
 * one somebody has actually been handed.
 *
 * Matching is case-insensitive and trimmed, exact before partial, so a longer
 * heading never steals a shorter one's column.
 */
const PROPERTY_ID = ['property id', 'psid', 'propertyid'];
const ROOM_ID = ['room id', 'roomid'];
const ROOM_NUMBER = ['room number', 'room #', 'room'];
const MEMBER_ID = ['member id', 'memberid'];
const MEMBER_FIRST = ['member first name', 'first name'];
const MEMBER_LAST = ['member last name', 'last name'];
const EARNINGS_MONTH = ['earnings month', 'earning month'];
const PAYOUT_MONTH = ['payout month', 'payoutmonth'];
const CREATED = ['created', 'created date', 'created at', 'bill date', 'payout date'];
const BILL_ID = ['bill id', 'billid'];
const BILL_TYPE = ['bill type', 'billtype'];
const GROSS_COLLECTED = ['gross collected', 'gross collections', 'gross'];
const BOOKING_FEES = ['booking fees amount', 'booking fee amount', 'booking fees', 'booking fee'];
const NET_OF_BOOKING = ['collections net of booking fees', 'net of booking fees'];
const SERVICE_FEES = ['service fees amount', 'service fee amount', 'service fees', 'service fee'];
/**
 * Not present in the export seen so far, and read anyway.
 *
 * A prior build met it as a separate column. If PadSplit starts charging one
 * and it is not read, it disappears from the fee total rather than showing up
 * as an unrecognised heading, and the bottom line quietly overstates.
 */
const TRANSACTION_FEES = ['txn fees', 'txn fee', 'transaction fees amount', 'transaction fee amount', 'transaction fees', 'transaction fee'];
const HOST_EARNINGS = ['host earnings', 'host earning'];
const ADJUSTMENTS = ['adjustments', 'adjustment'];
const TOTAL_PAYOUT = ['total payout', 'payout'];
const PAYOUT_ACCOUNT = ['payout account'];
const ADDRESS = ['property address', 'address', 'street 1'];
const AMOUNT = ['amount'];
const TRANSACTION_TYPE = ['transaction type', 'txn type'];
const TRANSACTION_REASON = ['transaction reason', 'reason'];
const CATEGORY = ['category'];
const ROW_TYPE = ['row_type', 'row type'];
const MONTH = ['month'];
const IN_FLIGHT = ['is_in_flight', 'is in flight', 'in_flight'];
const TOTAL_COLLECTIONS = ['total_collections', 'total collections'];
const TOTAL_EXPENSES = ['total_expenses', 'total expenses'];
const TOTAL_ADJUSTMENTS = ['total_adjustments', 'total adjustments'];
const TOTAL_PAYOUT_COL = ['total_payout', 'total payout'];

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
  monthTotals: PadSplitMonthTotal[];
  yearToDate: { year: number; collectionsCents: number; expensesCents: number; adjustmentsCents: number; payoutCents: number } | null;
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
 * Each has something none of the others has: earnings_table is the only one
 * with a row_type, collected the only one pairing a payout month with a bill
 * id, summary the only per-property file with a total payout, and billed the
 * only one with a transaction type.
 */
export function detectFileKind(headers: string[]): PadSplitFileKind | null {
  const has = (candidates: string[]) => findColumn(headers, candidates) !== -1;

  if (has(ROW_TYPE) && has(TOTAL_COLLECTIONS)) return 'earnings_table';
  if (has(TRANSACTION_TYPE) && has(AMOUNT)) return 'billed';
  if (has(PAYOUT_MONTH) && has(BILL_ID)) return 'collected';
  if (has(EARNINGS_MONTH) && has(TOTAL_PAYOUT)) return 'summary';
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
 * The export states both of these outright, so neither is inferred.
 *
 * An earlier version read them out of the bill-type wording, which was a
 * guess made before anyone had seen a real file. Transaction Type carries
 * fee/concession/fine, and Category carries collected/adjustment.
 */
export function billedKindOf(transactionType: string): BilledKind {
  const value = transactionType.trim().toLowerCase();
  return value === 'concession' || value === 'fine' ? value : 'fee';
}

export function collectionCategoryOf(category: string): CollectionCategory {
  return category.trim().toLowerCase() === 'adjustment' ? 'adjustment' : 'collected';
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

  // Headers in the collected export carry leading and trailing spaces.
  const headers = rows[0].map((header) => header.trim());
  const kind = detectFileKind(headers);
  if (!kind) throw new UnknownPadSplitFileError(headers);

  const FIELDS: Record<PadSplitFileKind, Record<string, string[]>> = {
    summary: {
      earningsMonth: EARNINGS_MONTH, payoutMonth: PAYOUT_MONTH, propertyExternalId: PROPERTY_ID,
      address: ADDRESS, gross: GROSS_COLLECTED, bookingFees: BOOKING_FEES, netOfBooking: NET_OF_BOOKING,
      serviceFees: SERVICE_FEES, transactionFees: TRANSACTION_FEES, hostEarnings: HOST_EARNINGS,
      adjustments: ADJUSTMENTS, totalPayout: TOTAL_PAYOUT, payoutAccount: PAYOUT_ACCOUNT,
    },
    billed: {
      billId: BILL_ID, created: CREATED, propertyExternalId: PROPERTY_ID, roomExternalId: ROOM_ID,
      roomNumber: ROOM_NUMBER, memberId: MEMBER_ID, memberFirst: MEMBER_FIRST, memberLast: MEMBER_LAST,
      amount: AMOUNT, transactionType: TRANSACTION_TYPE, reason: TRANSACTION_REASON, category: CATEGORY,
    },
    collected: {
      created: CREATED, payoutMonth: PAYOUT_MONTH, propertyExternalId: PROPERTY_ID, roomExternalId: ROOM_ID,
      roomNumber: ROOM_NUMBER, memberId: MEMBER_ID, memberFirst: MEMBER_FIRST, memberLast: MEMBER_LAST,
      billId: BILL_ID, billType: BILL_TYPE, gross: GROSS_COLLECTED, bookingFee: BOOKING_FEES,
      serviceFees: SERVICE_FEES, transactionFees: TRANSACTION_FEES, hostEarnings: HOST_EARNINGS,
      category: CATEGORY,
    },
    earnings_table: {
      rowType: ROW_TYPE, month: MONTH, inFlight: IN_FLIGHT, collections: TOTAL_COLLECTIONS,
      expenses: TOTAL_EXPENSES, adjustments: TOTAL_ADJUSTMENTS, payout: TOTAL_PAYOUT_COL,
    },
  };

  const { columns, used } = report(headers, FIELDS[kind]);
  const at = (field: string) => columns.find((column) => column.field === field)?.index ?? -1;
  const cell = (row: string[], field: string) => (at(field) === -1 ? '' : (row[at(field)] ?? '').trim());
  const money = (row: string[], field: string) => parseAmount(cell(row, field)) ?? 0;

  const result: ParsedPadSplitFile = {
    kind,
    months: [],
    summary: [],
    billed: [],
    collected: [],
    monthTotals: [],
    yearToDate: null,
    rowCount: 0,
    skipped: [],
    columns,
    unrecognizedHeaders: headers.filter((header, index) => header !== '' && !used.has(index)),
  };

  const months = new Set<MonthKey>();
  const name = (row: string[]) => {
    const full = `${cell(row, 'memberFirst')} ${cell(row, 'memberLast')}`.trim();
    return full === '' ? null : full;
  };

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const raw = row.join(',');
    const skip = (reason: string) => result.skipped.push({ line: i + 1, reason, raw });

    if (kind === 'summary') {
      const earningsMonth = parseMonth(cell(row, 'earningsMonth'));
      const propertyExternalId = blankToNull(cell(row, 'propertyExternalId'));
      if (!earningsMonth) { skip('no earnings month'); continue; }
      if (!propertyExternalId) { skip('no property id'); continue; }
      months.add(earningsMonth);
      result.summary.push({
        propertyExternalId,
        earningsMonth,
        // Stated in the file rather than assumed to be the next month.
        payoutMonth: parseMonth(cell(row, 'payoutMonth')) ?? addMonth(earningsMonth),
        grossCents: money(row, 'gross'),
        bookingFeesCents: money(row, 'bookingFees'),
        netOfBookingFeesCents: money(row, 'netOfBooking'),
        // Folded in with the service fee: it is the platform's cut either way,
        // and keeping it separate would mean every total had to remember it.
        serviceFeesCents: money(row, 'serviceFees') + money(row, 'transactionFees'),
        hostEarningsCents: money(row, 'hostEarnings'),
        adjustmentsCents: money(row, 'adjustments'),
        totalPayoutCents: money(row, 'totalPayout'),
        payoutAccount: blankToNull(cell(row, 'payoutAccount')),
        address: blankToNull(cell(row, 'address')),
      });
      result.rowCount += 1;
      continue;
    }

    if (kind === 'earnings_table') {
      const rowType = cell(row, 'rowType').toLowerCase();
      const total = {
        collectionsCents: money(row, 'collections'),
        expensesCents: money(row, 'expenses'),
        adjustmentsCents: money(row, 'adjustments'),
        payoutCents: money(row, 'payout'),
      };
      if (rowType === 'year_to_date') {
        result.yearToDate = { year: Number(cell(row, 'month')) || 0, ...total };
        result.rowCount += 1;
        continue;
      }
      const month = parseMonth(cell(row, 'month'));
      if (!month) { skip('no month'); continue; }
      months.add(month);
      result.monthTotals.push({
        earningsMonth: month,
        // Stated outright, so which month is still collecting never has to be
        // guessed from whichever happens to be latest in the file.
        inFlight: /^(true|yes|1)$/i.test(cell(row, 'inFlight')),
        ...total,
      });
      result.rowCount += 1;
      continue;
    }

    if (kind === 'billed') {
      const billedDate = parseDate(cell(row, 'created'));
      if (!billedDate) { skip('no created date'); continue; }
      const amount = parseAmount(cell(row, 'amount'));
      if (amount === null) { skip('no amount'); continue; }
      const earningsMonth = billedDate.slice(0, 7);
      months.add(earningsMonth);
      result.billed.push({
        billId: cell(row, 'billId'),
        propertyExternalId: blankToNull(cell(row, 'propertyExternalId')),
        roomExternalId: blankToNull(cell(row, 'roomExternalId')),
        roomNumber: blankToNull(cell(row, 'roomNumber')),
        memberId: blankToNull(cell(row, 'memberId')),
        memberName: name(row),
        earningsMonth,
        billedDate,
        billType: cell(row, 'category'),
        reason: cell(row, 'reason'),
        kind: billedKindOf(cell(row, 'transactionType')),
        amountCents: amount,
      });
      result.rowCount += 1;
      continue;
    }

    // collected
    const createdDate = parseDate(cell(row, 'created'));
    if (!createdDate) { skip('no created date'); continue; }
    const amount = parseAmount(cell(row, 'gross'));
    if (amount === null) { skip('no gross collected'); continue; }
    // Mislabelled on purpose: this column holds the EARNINGS month, and is
    // blank while that month is still collecting. Verified on a real export,
    // including one June collection booked back to May — so the column wins
    // over the created date wherever it has a value.
    const payoutMonthRaw = parseMonth(cell(row, 'payoutMonth'));
    months.add(payoutMonthRaw ?? createdDate.slice(0, 7));
    result.collected.push({
      billId: blankToNull(cell(row, 'billId')),
      propertyExternalId: blankToNull(cell(row, 'propertyExternalId')),
      roomExternalId: blankToNull(cell(row, 'roomExternalId')),
      roomNumber: blankToNull(cell(row, 'roomNumber')),
      memberId: blankToNull(cell(row, 'memberId')),
      memberName: name(row),
      billType: cell(row, 'billType'),
      category: collectionCategoryOf(cell(row, 'category')),
      amountCents: amount,
      bookingFeeCents: money(row, 'bookingFee'),
      serviceFeeCents: money(row, 'serviceFees') + money(row, 'transactionFees'),
      hostEarningsCents: money(row, 'hostEarnings'),
      payoutMonthRaw,
      createdDate,
    });
    result.rowCount += 1;
  }

  result.months = [...months].sort();
  return result;
}

/** The month after this one, for the rare summary row with no payout month. */
function addMonth(month: MonthKey): MonthKey {
  const [year, index] = month.split('-').map(Number);
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
}
