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
  /** When the money actually lands, which is the earnings month plus one. */
  payoutMonth: MonthKey;
  grossCents: Cents;
  /** Negative, as exported. Charged when a room is re-let. */
  bookingFeesCents: Cents;
  netOfBookingFeesCents: Cents;
  /** Negative, as exported. 8% of collections net of booking fees. */
  serviceFeesCents: Cents;
  hostEarningsCents: Cents;
  /** Refunded booking fees and the like: income, not rent against a bill. */
  adjustmentsCents: Cents;
  /** Host earnings plus adjustments — the figure that hits the bank. */
  totalPayoutCents: Cents;
  /** The account it was paid into, as exported ("… ***7250"). */
  payoutAccount: string | null;
  address: string | null;
}

/** Booking fees plus service fees: everything PadSplit kept. Negative. */
export function summaryFees(row: SummaryRow): Cents {
  return row.bookingFeesCents + row.serviceFeesCents;
}

export type BilledKind = 'fee' | 'fine' | 'concession';

export interface BilledLine {
  /** Joins to a collection line, which is what makes ageing possible. */
  billId: string;
  propertyExternalId: string | null;
  roomExternalId: string | null;
  roomNumber: string | null;
  memberId: string | null;
  memberName: string | null;
  /** The billed file has no month column; this is the month it was raised. */
  earningsMonth: MonthKey;
  billedDate: IsoDate;
  billType: string;
  /** membership_dues, promo_room_discount, overdue_balance, and so on. */
  reason: string;
  kind: BilledKind;
  /** As exported: charges negative, concessions positive. */
  amountCents: Cents;
}

export type CollectionCategory = 'collected' | 'adjustment';

export interface CollectionLine {
  /** Blank on an adjustment, which is not against any bill. */
  billId: string | null;
  propertyExternalId: string | null;
  roomExternalId: string | null;
  roomNumber: string | null;
  memberId: string | null;
  memberName: string | null;
  billType: string;
  category: CollectionCategory;
  /** Gross collected on this line. */
  amountCents: Cents;
  bookingFeeCents: Cents;
  serviceFeeCents: Cents;
  hostEarningsCents: Cents;
  /**
   * The column is labelled "Payout Month" but holds the EARNINGS month.
   * Blank on the in-flight month.
   */
  payoutMonthRaw: MonthKey | null;
  createdDate: IsoDate;
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
 * Cash collected against what was billed, for an earnings month.
 *
 * Adjustments are NOT included, which an earlier version of this got wrong.
 * Verified against a real export: excluding them makes all twenty
 * property-months tie to summary.csv on gross collected AND on adjustments,
 * and including them makes five of the twenty miss by exactly the adjustment.
 *
 * They are income — refunded booking fees and the like — but they are not
 * money against a bill, so they belong in revenue and not in the denominator
 * of a collection rate. `adjustments()` is the other half of this pair.
 */
export function grossCollected(lines: readonly CollectionLine[]): Cents {
  return sumCents(lines.filter((l) => l.category === 'collected').map((l) => l.amountCents));
}

/**
 * Miscellaneous income for the month: refunded booking fees and similar.
 *
 * These carry no room and no bill type, and PadSplit takes no service fee on
 * them — they pass through at face value, which is why they sit outside host
 * earnings and are added after it to reach the payout.
 */
export function adjustments(lines: readonly CollectionLine[]): Cents {
  return sumCents(lines.filter((l) => l.category === 'adjustment').map((l) => l.amountCents));
}

export function delinquency(netBilledCents: Cents, grossCollectedCents: Cents): Cents {
  return netBilledCents - grossCollectedCents;
}

/** >100% means the property is catching up on prior arrears. Not an error. */
export function collectionRate(netBilledCents: Cents, grossCollectedCents: Cents): number | null {
  if (netBilledCents === 0) return null;
  return (grossCollectedCents / netBilledCents) * 100;
}

/**
 * Dues that survived, netted per room and per member.
 *
 * A dues charge that is later undone is not absent from the export — it is
 * charged and then reversed, same bill, usually the same day, and both halves
 * are Membership Dues marked collected. Two different things produce that
 * shape and the data cannot tell them apart:
 *
 *   - a booking request that never became a move-in;
 *   - a resident moved between rooms, where the old room is reversed and the
 *     new one charged.
 *
 * Netting handles both without needing to know which. The reversed side sums
 * to zero and drops out; the side where the money stuck counts. A transferred
 * resident is counted once, in the room that kept the money, rather than twice
 * or in the room they left.
 *
 * Counting distinct rooms with any dues line instead put people in rooms they
 * never occupied: Glen Mora read 7 of 8 rooms in a month it had 5. Sixteen
 * member-months in one real export net to exactly zero this way.
 *
 * A member who paid something PadSplit then kept entirely as a booking fee did
 * move in and is counted — the host earned nothing that month, which is a fact
 * about the money and not about whether the room was occupied.
 */
function netDuesBy(
  lines: readonly CollectionLine[],
  key: (line: CollectionLine) => string | null,
): Map<string, Cents> {
  const totals = new Map<string, Cents>();
  for (const line of lines) {
    if (line.billType !== MEMBERSHIP_DUES || line.category !== 'collected') continue;
    const id = key(line);
    if (!id) continue;
    totals.set(id, (totals.get(id) ?? 0) + line.amountCents);
  }
  return totals;
}

export function roomsOccupied(lines: readonly CollectionLine[]): number {
  return [...netDuesBy(lines, (l) => l.roomExternalId).values()].filter((cents) => cents > 0).length;
}

/** People who actually took a room, reversed bookings excluded. */
export function residents(lines: readonly CollectionLine[]): number {
  return [...netDuesBy(lines, (l) => l.memberId).values()].filter((cents) => cents > 0).length;
}

/**
 * Rooms that changed hands: people beyond one per occupied room.
 *
 * Two payers in one room over a month is one turnover. Reversed bookings are
 * excluded on both sides, or a room that was merely enquired about would look
 * like a room that emptied and refilled.
 */
export function turnovers(lines: readonly CollectionLine[]): number {
  const byRoom = new Map<string, Set<string>>();
  const netByRoomMember = netDuesBy(lines, (l) => (l.roomExternalId && l.memberId ? `${l.roomExternalId}|${l.memberId}` : null));

  for (const [key, cents] of netByRoomMember) {
    if (cents <= 0) continue;
    const [room, member] = key.split('|');
    const people = byRoom.get(room) ?? new Set<string>();
    people.add(member);
    byRoom.set(room, people);
  }

  return [...byRoom.values()].reduce((total, people) => total + Math.max(0, people.size - 1), 0);
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
  /** Refunded booking fees and the like. Income, but not rent against a bill. */
  adjustmentsCents: Cents;
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
 * A month of the portfolio as PadSplit itself totals it.
 *
 * earnings_table.csv is not per property, which an earlier version of this
 * assumed. It is one row per earnings month across every house, plus a
 * year-to-date row, and it carries the in-flight flag explicitly rather than
 * leaving it to be inferred from which month happens to be latest.
 *
 * Its value is as a check: the per-property rows should add up to it, and if
 * they do not, the import is wrong before anything is posted.
 */
export interface PadSplitMonthTotal {
  earningsMonth: MonthKey;
  inFlight: boolean;
  collectionsCents: Cents;
  /** Booking fees plus service fees, as exported: negative. */
  expensesCents: Cents;
  adjustmentsCents: Cents;
  payoutCents: Cents;
}

export interface MonthTie {
  earningsMonth: MonthKey;
  field: 'collections' | 'adjustments' | 'payout';
  statedCents: Cents;
  summedCents: Cents;
  differenceCents: Cents;
}

/**
 * The per-property rows against the total PadSplit states for that month.
 *
 * Verified to hold exactly on a real export — all three fields, all eight
 * months — so a difference here is a parsing fault, not a rounding one.
 */
export function tieToMonthTotals(
  totals: readonly PadSplitMonthTotal[],
  perProperty: readonly { earningsMonth: MonthKey; grossCollectedCents: Cents; adjustmentsCents: Cents; payoutCents: Cents }[],
): MonthTie[] {
  const misses: MonthTie[] = [];

  for (const total of totals) {
    const rows = perProperty.filter((row) => row.earningsMonth === total.earningsMonth);
    const checks: [MonthTie['field'], Cents, Cents][] = [
      ['collections', total.collectionsCents, sumCents(rows.map((r) => r.grossCollectedCents))],
      ['adjustments', total.adjustmentsCents, sumCents(rows.map((r) => r.adjustmentsCents))],
      ['payout', total.payoutCents, sumCents(rows.map((r) => r.payoutCents))],
    ];
    for (const [field, stated, summed] of checks) {
      // A cent of slack: the export carries four decimal places on fees and
      // this side is whole cents.
      if (Math.abs(stated - summed) > 1) {
        misses.push({ earningsMonth: total.earningsMonth, field, statedCents: stated, summedCents: summed, differenceCents: summed - stated });
      }
    }
  }

  return misses;
}

export interface PadSplitPortfolioTotals {
  grossCents: Cents;
  feesCents: Cents;
  adjustmentsCents: Cents;
  payoutCents: Cents;
  collectionRate: number | null;
  monthsCovered: MonthKey[];
}

/**
 * The re-verification total (§6). Callers pass the completed months only —
 * the in-flight month must already be dropped, which is why `months` is
 * explicit rather than inferred here.
 */
export function portfolioTotals(propertyMonths: readonly PropertyMonth[]): PadSplitPortfolioTotals {
  const netBilledTotal = sumCents(propertyMonths.map((pm) => pm.netBilledCents));
  const collectedTotal = sumCents(propertyMonths.map((pm) => pm.grossCollectedCents));
  return {
    grossCents: sumCents(propertyMonths.map((pm) => pm.grossCents)),
    feesCents: sumCents(propertyMonths.map((pm) => pm.feesCents)),
    adjustmentsCents: sumCents(propertyMonths.map((pm) => pm.adjustmentsCents)),
    payoutCents: sumCents(propertyMonths.map((pm) => pm.payoutCents)),
    collectionRate: collectionRate(netBilledTotal, collectedTotal),
    monthsCovered: [...new Set(propertyMonths.map((pm) => pm.earningsMonth))].sort(),
  };
}
