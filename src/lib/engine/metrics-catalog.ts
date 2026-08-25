/**
 * The metrics one chart can be pointed at, and the timeframes it can cover.
 *
 * Declared once, in the engine, so the server that shapes the numbers and the
 * client that draws them cannot disagree about what a metric means, how it is
 * formatted, or how a portfolio figure is arrived at.
 */
export type MetricUnit = 'money' | 'percent' | 'count';

export interface MetricSpec {
  key: string;
  label: string;
  unit: MetricUnit;
  /** Said under the chart, so a figure is never left to be guessed at. */
  note: string;
}

export const METRICS: MetricSpec[] = [
  {
    key: 'hostEarnings',
    label: 'Host earnings',
    unit: 'money',
    note: 'Rent collected less what PadSplit kept. The portfolio line is the sum of the houses.',
  },
  {
    key: 'grossCollected',
    label: 'Gross collected',
    unit: 'money',
    note: 'Rent the platform actually collected from members, before it took its cut.',
  },
  {
    key: 'platformFees',
    label: 'PadSplit fees',
    unit: 'money',
    note: 'Booking and service fees, drawn as the positive amount kept. Booking fees spike in a month with turnover.',
  },
  {
    key: 'payout',
    label: 'Total payout',
    unit: 'money',
    note: 'Host earnings plus adjustments — the figure that reaches the bank the following month.',
  },
  {
    key: 'occupancy',
    label: 'Occupancy',
    unit: 'percent',
    note: 'Room-days let against room-days the houses had to sell. Each weekly charge is spread across the seven days it pays for, so a room let for nine days of a month counts as nine days — and a week raised on 30 July is credited to August, where it belongs.',
  },
  {
    key: 'turnovers',
    label: 'Turnovers',
    unit: 'count',
    note: 'Tenancies that ended — a room emptying, whether or not anyone replaced them. Every one eventually costs a booking fee, so this line usually explains the fee line. The most recent month is a floor: a move-out in the export’s last week is not visible yet.',
  },
  {
    key: 'collectionRate',
    label: 'Collection rate',
    unit: 'percent',
    note: 'Cash in against what was billed that month. Over 100% is a house catching up on arrears, not an error. Blank while a month is still collecting.',
  },
  {
    key: 'delinquency',
    label: 'Delinquency',
    unit: 'money',
    note: 'Billed and not collected within the month. Blank while a month is still collecting.',
  },
  {
    key: 'perRoom',
    label: 'Earnings per room',
    unit: 'money',
    note: 'Host earnings divided by the rooms that were occupied — what a filled room is worth, with vacancy taken out of the comparison.',
  },
];

export const RANGES = [
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: '12m', label: '12M', months: 12 },
  { key: 'ytd', label: 'YTD', months: 0 },
  { key: 'all', label: 'All', months: 0 },
  { key: 'custom', label: 'Custom', months: 0 },
] as const;

export type RangeKey = (typeof RANGES)[number]['key'];

/**
 * The months a range covers, from the months there is data for.
 *
 * A custom range is bounded by the two months given; either may be missing,
 * in which case that end is left open.
 */
export function monthsInRange(
  months: readonly string[],
  range: RangeKey,
  custom?: { from?: string; to?: string },
): string[] {
  if (months.length === 0) return [];
  if (range === 'all') return [...months];
  if (range === 'custom') {
    const from = custom?.from ?? months[0];
    const to = custom?.to ?? months[months.length - 1];
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return months.filter((month) => month >= lo && month <= hi);
  }
  if (range === 'ytd') {
    const year = months[months.length - 1].slice(0, 4);
    return months.filter((month) => month.startsWith(year));
  }
  const span = RANGES.find((r) => r.key === range)?.months ?? months.length;
  return months.slice(Math.max(0, months.length - span));
}

/** "2025-09" as "Sep 25", which is what fits on an axis. */
export function shortMonth(month: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const index = Number(month.slice(5, 7)) - 1;
  const name = names[index] ?? month.slice(5, 7);
  return `${name} ${month.slice(2, 4)}`;
}
