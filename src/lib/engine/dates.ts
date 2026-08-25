/**
 * Dates are ISO strings: 'YYYY-MM-DD' for days, 'YYYY-MM' for months.
 *
 * Strings, not Date objects, because every date in this domain is a calendar
 * date with no time and no zone. A Date is a timestamp, and a timestamp read
 * back in another zone silently becomes the previous day — which would move a
 * transaction into the wrong statement period.
 */

export type IsoDate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return DATE_RE.test(value);
}

export function isMonthKey(value: string): boolean {
  return MONTH_RE.test(value);
}

export function monthOf(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

export function parts(date: IsoDate): { y: number; m: number; d: number } {
  return { y: +date.slice(0, 4), m: +date.slice(5, 7), d: +date.slice(8, 10) };
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function makeDate(y: number, m: number, d: number): IsoDate {
  const dd = Math.min(d, daysInMonth(y, m));
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function addMonths(date: IsoDate, n: number): IsoDate {
  const { y, m, d } = parts(date);
  const total = y * 12 + (m - 1) + n;
  return makeDate(Math.floor(total / 12), (total % 12) + 1, d);
}

export function addMonthsToMonth(month: MonthKey, n: number): MonthKey {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthStart(month: MonthKey): IsoDate {
  return `${month}-01`;
}

export function monthEnd(month: MonthKey): IsoDate {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const { y, m, d } = parts(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parts(from);
  const b = parts(to);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** Months from `from` to `to`, ignoring day-of-month. */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  return (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7));
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

/**
 * A dated record covers `date` when it started on or before it and has either
 * not ended or ended on or after it. End dates are INCLUSIVE throughout: a
 * management period ending 2026-07-31 covers all of July.
 */
export interface DatedRange {
  startDate: IsoDate;
  endDate: IsoDate | null;
}

export function covers(range: DatedRange, date: IsoDate): boolean {
  if (date < range.startDate) return false;
  return range.endDate === null || date <= range.endDate;
}

export function overlapsMonth(range: DatedRange, month: MonthKey): boolean {
  const start = monthStart(month);
  const end = monthEnd(month);
  if (range.startDate > end) return false;
  return range.endDate === null || range.endDate >= start;
}
