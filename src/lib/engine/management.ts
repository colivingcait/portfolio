/**
 * Management periods (§4).
 *
 * A property's management arrangement is a dated record, not a property-level
 * setting. The engine looks up the period covering an earnings month and
 * applies the matching reconciliation identity — so historical months compute
 * with no PM fee, without a special case anywhere in the code.
 */

import { monthEnd, monthStart, overlapsMonth, type IsoDate, type MonthKey } from './dates';

export type ManagementMode = 'self' | 'pm';
export type FeeBasis = 'gross_collected' | 'host_earnings' | 'net_billed';

export interface ManagementPeriod {
  id: string;
  propertyId: string;
  startDate: IsoDate;
  endDate: IsoDate | null;
  mode: ManagementMode;
  managerName: string | null;
  /** Whole-number percentage: 10.5 means 10.5%. */
  feePercent: number | null;
  feeBasis: FeeBasis | null;
}

export interface MonthManagement {
  month: MonthKey;
  periods: ManagementPeriod[];
  /** The period to price the month with. See `transition`. */
  effective: ManagementPeriod | null;
  /**
   * More than one period touches the month. Do NOT prorate the fee: when the
   * PM's statement exists it is the truth for that month. Flag and move on.
   */
  transition: boolean;
}

/**
 * Periods touching a month, and which one prices it.
 *
 * Where a month is split, the PM period wins — because the PM statement, once
 * it exists, is the truth for the whole month.
 */
export function managementForMonth(
  periods: readonly ManagementPeriod[],
  propertyId: string,
  month: MonthKey,
): MonthManagement {
  const touching = periods
    .filter((p) => p.propertyId === propertyId && overlapsMonth(p, month))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const transition = touching.length > 1;
  const effective = transition
    ? (touching.find((p) => p.mode === 'pm') ?? touching[touching.length - 1])
    : (touching[0] ?? null);

  return { month, periods: touching, effective: effective ?? null, transition };
}

export function modeForMonth(
  periods: readonly ManagementPeriod[],
  propertyId: string,
  month: MonthKey,
): ManagementMode | null {
  return managementForMonth(periods, propertyId, month).effective?.mode ?? null;
}

export interface ManagementBoundary {
  /** The first month under the new arrangement. */
  month: MonthKey;
  from: ManagementMode;
  to: ManagementMode;
  label: string;
}

/**
 * Boundaries inside a month range, for marking on trends.
 *
 * §4: under self-management maintenance costs were artificially low — unpaid
 * own labour never hit a statement. The same work under the PM arrives as a
 * priced invoice, so any chart crossing the boundary shows maintenance
 * apparently exploding. Every trend that crosses one must say so.
 */
export function managementBoundaries(
  periods: readonly ManagementPeriod[],
  propertyId: string,
  months: readonly MonthKey[],
): ManagementBoundary[] {
  const boundaries: ManagementBoundary[] = [];
  let previous: ManagementMode | null = null;

  for (const month of months) {
    const mode = modeForMonth(periods, propertyId, month);
    if (mode && previous && mode !== previous) {
      boundaries.push({
        month,
        from: previous,
        to: mode,
        label:
          mode === 'pm'
            ? 'PM took over — priced vendor invoices replace unpriced own labour'
            : 'Returned to self-management — maintenance costs stop being arm’s length',
      });
    }
    if (mode) previous = mode;
  }
  return boundaries;
}

/** True where a trend spanning these months crosses a management boundary. */
export function crossesBoundary(
  periods: readonly ManagementPeriod[],
  propertyId: string,
  months: readonly MonthKey[],
): boolean {
  return managementBoundaries(periods, propertyId, months).length > 0;
}

/**
 * Self-managed months are a soft baseline, not a true picture of what a house
 * costs to run at arm's length. Anything averaging maintenance across a
 * boundary should carry this.
 */
export function comparabilityWarning(
  periods: readonly ManagementPeriod[],
  propertyId: string,
  months: readonly MonthKey[],
): string | null {
  if (!crossesBoundary(periods, propertyId, months)) return null;
  return 'This range crosses a management boundary. Self-managed months exclude unpriced own labour, so maintenance is understated before the boundary and is not comparable with months after it.';
}

/** Month bounds, for callers that need dates rather than a month key. */
export function monthBounds(month: MonthKey): { start: IsoDate; end: IsoDate } {
  return { start: monthStart(month), end: monthEnd(month) };
}
