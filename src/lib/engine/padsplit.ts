/**
 * PadSplit import (§6).
 *
 * Four files per month. The rules below are the ones the spec says must not
 * drift, and each is expressed once, here, so nothing re-derives them badly
 * somewhere else.
 */

import { monthOf, type IsoDate, type MonthKey } from './dates';
import { median, roundCents, sumCents, type Cents } from './money';

export interface SummaryRow {
  propertyExternalId: string; // PSID
  earningsMonth: MonthKey;
  grossCents: Cents;
  feesCents: Cents;
  hostEarningsCents: Cents;
}

export type BilledKind = 'fee' | 'fine' | 'concession';

export interface BilledLine {
  propertyExternalId: string | null;
  roomExternalId: string | null;
  earningsMonth: MonthKey;
  billType: string;
  kind: BilledKind;
  /** As exported: charges negative, concessions positive. */
  amountCents: Cents;
}

export type CollectionCategory = 'collected' | 'adjustment';

export interface CollectionLine {
  propertyExternalId: string | null;
  roomExternalId: string | null;
  billType: string;
  category: CollectionCategory;
  amountCents: Cents;
  /**
   * The column is labelled "Payout Month" but holds the EARNINGS month.
   * Blank on the in-flight month.
   */
  payoutMonthRaw: MonthKey | null;
  createdDate: IsoDate;
}

export interface EarningsTableRow {
  propertyExternalId: string | null;
  earningsMonth: MonthKey;
  grossCents: Cents;
  feesCents: Cents;
  /** Authoritative over summary.csv, which understates credits. */
  creditsCents: Cents;
  payoutCents: Cents;
}

export const MEMBERSHIP_DUES = 'Membership Dues';

/**
 * collected."Payout Month" is mislabeled — it holds the earnings month.
 * When blank (the in-flight month), fall back to the month in Created.
 */
export function earningsMonthOf(line: CollectionLine): MonthKey {
  return line.payoutMonthRaw ?? monthOf(line.createdDate);
}

/** net_billed = -(Σ billed.Amount) — charges negative, concessions positive. */
export function netBilled(lines: readonly BilledLine[]): Cents {
  return -sumCents(lines.map((l) => l.amountCents));
}

/**
 * Cash actually collected against an earnings month.
 *
 * Adjustments are included by default: they are corrections to collected cash,
 * not a separate bucket. UNVERIFIED against a fresh export — if the trailing
 * re-run (§6) misses, this flag is the first thing to try.
 */
export function grossCollected(
  lines: readonly CollectionLine[],
  opts: { includeAdjustments?: boolean } = {},
): Cents {
  const includeAdjustments = opts.includeAdjustments ?? true;
  return sumCents(
    lines
      .filter((l) => l.category === 'collected' || (includeAdjustments && l.category === 'adjustment'))
      .map((l) => l.amountCents),
  );
}

export function delinquency(netBilledCents: Cents, grossCollectedCents: Cents): Cents {
  return netBilledCents - grossCollectedCents;
}

/** >100% means the property is catching up on prior arrears. Not an error. */
export function collectionRate(netBilledCents: Cents, grossCollectedCents: Cents): number | null {
  if (netBilledCents === 0) return null;
  return (grossCollectedCents / netBilledCents) * 100;
}

/** rooms_occupied = distinct Room IDs, Bill Type 'Membership Dues', Category 'collected'. */
export function roomsOccupied(lines: readonly CollectionLine[]): number {
  const rooms = new Set<string>();
  for (const l of lines) {
    if (l.billType === MEMBERSHIP_DUES && l.category === 'collected' && l.roomExternalId) {
      rooms.add(l.roomExternalId);
    }
  }
  return rooms.size;
}

export function occupancyRate(occupied: number, roomsTotal: number): number | null {
  if (roomsTotal <= 0) return null;
  return (occupied / roomsTotal) * 100;
}

/**
 * The in-flight month: the latest earnings month present is still collecting.
 * Excluded from delinquency, collection rate, stabilized rate and projections,
 * and never compared to a completed month.
 */
export function inFlightMonth(months: readonly MonthKey[]): MonthKey | null {
  if (months.length === 0) return null;
  return months.reduce((max, m) => (m > max ? m : max));
}

export function isInFlight(month: MonthKey, allMonths: readonly MonthKey[]): boolean {
  return inFlightMonth(allMonths) === month;
}

export interface PropertyMonth {
  propertyExternalId: string;
  earningsMonth: MonthKey;
  roomsTotal: number;
  roomsOccupied: number;
  grossCents: Cents;
  feesCents: Cents;
  creditsCents: Cents;
  hostEarningsCents: Cents;
  payoutCents: Cents;
  netBilledCents: Cents;
  grossCollectedCents: Cents;
  /** Position in this property's own run of active months, 1-based. */
  activeMonthIndex: number;
  divesting: boolean;
  inFlight: boolean;
}

export interface PropertyMonthMetrics {
  occupancyRate: number | null;
  collectionRate: number | null;
  delinquencyCents: Cents;
  hostEarningsPerOccupiedRoomCents: Cents | null;
  /** Excluded from projections, stabilized rates and averages. */
  outlier: boolean;
  outlierReason: 'first_active_month' | 'second_month_low_occupancy' | null;
}

/**
 * Outlier rule (§6): a property-month is excluded if it is the property's
 * first active month (always), or its second active month with occupancy
 * below 70%.
 */
export const RAMP_OCCUPANCY_FLOOR = 70;

export function metricsFor(pm: PropertyMonth): PropertyMonthMetrics {
  const occupancy = occupancyRate(pm.roomsOccupied, pm.roomsTotal);

  let outlierReason: PropertyMonthMetrics['outlierReason'] = null;
  if (pm.activeMonthIndex === 1) {
    outlierReason = 'first_active_month';
  } else if (pm.activeMonthIndex === 2 && occupancy !== null && occupancy < RAMP_OCCUPANCY_FLOOR) {
    outlierReason = 'second_month_low_occupancy';
  }

  // The in-flight month is not an "outlier" — it is incomplete. Both are
  // excluded from rates and projections, but for different reasons, and the
  // UI says which.
  return {
    occupancyRate: occupancy,
    collectionRate: pm.inFlight ? null : collectionRate(pm.netBilledCents, pm.grossCollectedCents),
    delinquencyCents: pm.inFlight ? 0 : delinquency(pm.netBilledCents, pm.grossCollectedCents),
    hostEarningsPerOccupiedRoomCents:
      pm.roomsOccupied > 0 ? roundCents(pm.hostEarningsCents / pm.roomsOccupied) : null,
    outlier: outlierReason !== null,
    outlierReason,
  };
}

/** Months usable for rates, averages and projections. */
export function comparableMonths(months: readonly PropertyMonth[]): PropertyMonth[] {
  return months.filter((pm) => !pm.inFlight && !metricsFor(pm).outlier);
}

/**
 * True room rate: the median of host-earnings-per-occupied-room across the
 * remaining non-outlier, non-divesting months. Median, not mean — one
 * catch-up month should not move it.
 */
export function trueRoomRate(months: readonly PropertyMonth[]): Cents | null {
  const values = comparableMonths(months)
    .filter((pm) => !pm.divesting)
    .map((pm) => metricsFor(pm).hostEarningsPerOccupiedRoomCents)
    .filter((v): v is Cents => v !== null);
  return median(values);
}

/**
 * Credits and payout come from earnings_table.csv, not summary.csv:
 * summary understates credits because unallocated adjustments carry a blank
 * Property ID.
 */
export function creditsAndPayout(
  earningsTable: readonly EarningsTableRow[],
  propertyExternalId: string,
  earningsMonth: MonthKey,
): { creditsCents: Cents; payoutCents: Cents } | null {
  const row = earningsTable.find(
    (r) => r.propertyExternalId === propertyExternalId && r.earningsMonth === earningsMonth,
  );
  return row ? { creditsCents: row.creditsCents, payoutCents: row.payoutCents } : null;
}

/** Adjustment lines with no Property ID — the reason summary.csv understates. */
export function unallocatedCredits(earningsTable: readonly EarningsTableRow[]): Cents {
  return sumCents(
    earningsTable.filter((r) => r.propertyExternalId === null).map((r) => r.creditsCents),
  );
}

export interface PadSplitPortfolioTotals {
  grossCents: Cents;
  feesCents: Cents;
  creditsCents: Cents;
  payoutCents: Cents;
  collectionRate: number | null;
  monthsCovered: MonthKey[];
}

/**
 * The re-verification total (§6). Callers pass the completed months only —
 * the in-flight month must already be dropped, which is why `months` is
 * explicit rather than inferred here.
 */
export function portfolioTotals(
  rows: readonly EarningsTableRow[],
  propertyMonths: readonly PropertyMonth[],
): PadSplitPortfolioTotals {
  const netBilledTotal = sumCents(propertyMonths.map((pm) => pm.netBilledCents));
  const collectedTotal = sumCents(propertyMonths.map((pm) => pm.grossCollectedCents));
  return {
    grossCents: sumCents(rows.map((r) => r.grossCents)),
    feesCents: sumCents(rows.map((r) => r.feesCents)),
    creditsCents: sumCents(rows.map((r) => r.creditsCents)),
    payoutCents: sumCents(rows.map((r) => r.payoutCents)),
    collectionRate: collectionRate(netBilledTotal, collectedTotal),
    monthsCovered: [...new Set(rows.map((r) => r.earningsMonth))].sort(),
  };
}
