import { addMonthsToMonth, monthRange, type MonthKey } from './dates';

/**
 * The stretches of time every screen can be pointed at.
 *
 * One definition, in the engine, because the same words have to mean the same
 * months on the overview as on operations — even though those two pages key
 * their months differently (payout month against earnings month). Which key a
 * period is applied to is the page's business; which months it covers is not.
 */
export type PeriodKey =
  | 'mtd'
  | 'last_month'
  | 'l3m'
  | 'qtd'
  | 'last_quarter'
  | 'ytd'
  | 'l12m'
  | 'all'
  | 'custom';

export interface PeriodSpec {
  key: PeriodKey;
  label: string;
  /** Said in the picker, so nobody has to guess where a boundary falls. */
  hint: string;
}

/**
 * Ordered as they are offered. `last_month` leads because it is the default,
 * and it is the default for a reason: the current month is never finished. Its
 * rent is still arriving, its bank statement does not exist yet, and its
 * collection rate is not low but unknown. A dashboard that opens on it invites
 * a decision from numbers that cannot yet support one.
 */
export const PERIODS: PeriodSpec[] = [
  { key: 'last_month', label: 'Last month', hint: 'The most recent finished month.' },
  { key: 'mtd', label: 'Month to date', hint: 'The month in progress. Incomplete by definition.' },
  { key: 'l3m', label: 'Last 3 months', hint: 'The three finished months before this one.' },
  { key: 'qtd', label: 'Quarter to date', hint: 'This calendar quarter so far.' },
  { key: 'last_quarter', label: 'Last quarter', hint: 'The previous calendar quarter, complete.' },
  { key: 'ytd', label: 'Year to date', hint: 'January to now.' },
  { key: 'l12m', label: 'Last 12 months', hint: 'A rolling year, ending with the last finished month.' },
  { key: 'all', label: 'All time', hint: 'Every month there is data for.' },
  { key: 'custom', label: 'Custom', hint: 'Pick the two ends yourself.' },
];

export const DEFAULT_PERIOD: PeriodKey = 'last_month';

export function isPeriodKey(value: string | undefined): value is PeriodKey {
  return PERIODS.some((p) => p.key === value);
}

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  /** Months in the period that there is data for, ascending. Possibly empty. */
  months: MonthKey[];
  /** The calendar bounds asked for, whether or not data exists across them. */
  from: MonthKey;
  to: MonthKey;
  /** Months in the period whose calendar month has not finished. */
  openMonths: MonthKey[];
}

/** The quarter a month belongs to, as its first month. */
function quarterStart(month: MonthKey): MonthKey {
  const m = Number(month.slice(5, 7));
  const first = Math.floor((m - 1) / 3) * 3 + 1;
  return `${month.slice(0, 4)}-${String(first).padStart(2, '0')}`;
}

/**
 * The calendar bounds of a period.
 *
 * `now` is the current calendar month and is passed in rather than read, so
 * this stays pure and a test can sit in any month it likes.
 */
function boundsOf(
  key: PeriodKey,
  now: MonthKey,
  custom?: { from?: MonthKey; to?: MonthKey },
): { from: MonthKey; to: MonthKey } {
  const lastComplete = addMonthsToMonth(now, -1);

  switch (key) {
    case 'mtd':
      return { from: now, to: now };
    case 'last_month':
      return { from: lastComplete, to: lastComplete };
    case 'l3m':
      return { from: addMonthsToMonth(lastComplete, -2), to: lastComplete };
    case 'qtd':
      return { from: quarterStart(now), to: now };
    case 'last_quarter': {
      const thisQuarter = quarterStart(now);
      const previous = addMonthsToMonth(thisQuarter, -3);
      return { from: previous, to: addMonthsToMonth(previous, 2) };
    }
    case 'ytd':
      return { from: `${now.slice(0, 4)}-01`, to: now };
    case 'l12m':
      return { from: addMonthsToMonth(lastComplete, -11), to: lastComplete };
    case 'custom': {
      const from = custom?.from ?? lastComplete;
      const to = custom?.to ?? lastComplete;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    case 'all':
    default:
      // Widened to whatever data exists by the caller.
      return { from: '0000-01', to: '9999-12' };
  }
}

/**
 * A period against the months there is actually data for.
 *
 * Never invents a month: asking for a rolling year of a portfolio eight months
 * old returns the eight. `months` is what to sum; `from`/`to` are what was
 * asked for, which is what the label has to say.
 */
export function resolvePeriod(
  key: PeriodKey,
  now: MonthKey,
  available: readonly MonthKey[],
  custom?: { from?: MonthKey; to?: MonthKey },
): ResolvedPeriod {
  const sorted = [...new Set(available)].sort();
  const spec = PERIODS.find((p) => p.key === key) ?? PERIODS[0];

  const bounds =
    key === 'all'
      ? { from: sorted[0] ?? now, to: sorted[sorted.length - 1] ?? now }
      : boundsOf(key, now, custom);

  const months = sorted.filter((month) => month >= bounds.from && month <= bounds.to);

  return {
    key,
    label: spec.label,
    months,
    from: bounds.from,
    to: bounds.to,
    // A month that has not ended cannot be complete, whatever has been imported.
    openMonths: months.filter((month) => month >= now),
  };
}

/** Every month between two bounds, for a picker that must offer gaps too. */
export function monthOptions(available: readonly MonthKey[]): MonthKey[] {
  const sorted = [...new Set(available)].sort();
  if (sorted.length === 0) return [];
  return monthRange(sorted[0], sorted[sorted.length - 1]);
}
