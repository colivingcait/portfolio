/**
 * PadSplit import (§6).
 *
 * Four files per month. The rules below are the ones the spec says must not
 * drift, and each is expressed once, here, so nothing re-derives them badly
 * somewhere else.
 */

import { addDays, daysBetween, monthEnd, monthOf, monthStart, type IsoDate, type MonthKey } from './dates';
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
 * Occupancy and turnover are read off the BILLED file, never the collected one.
 *
 * They used to be read off collections, and both were wrong in ways that hid
 * each other. A room counted as occupied if any cash landed on it, so a room
 * that collected $178 of $880 billed scored the same as a room that paid in
 * full — while a room let to someone delinquent scored as empty. And a person
 * counted as a resident if they paid in the month, so a member who had already
 * moved out and was settling an old balance — seventeen cents, in one real
 * case — appeared as a second occupant and invented a turnover.
 *
 * Who was billed for a room is who lived in it. What they were billed, net of
 * every waiver and proration, is how much of the month they had it for.
 * Whether they then paid is the collection rate's business, and is deliberately
 * a separate number.
 */

/**
 * Billed lines that are rent, or adjust rent.
 *
 * Fines go by kind. These two are `fee` lines that are nonetheless not rent —
 * an administrative charge and the flexible-stay premium — and neither says
 * anything about whether a room was let.
 */
const NON_DUES_REASONS = new Set(['administrative', 'flexible_stay_fee_host']);

export function isDuesLine(line: BilledLine): boolean {
  return line.kind !== 'fine' && !NON_DUES_REASONS.has(line.reason);
}

/**
 * Dues billed, net of everything credited back against them.
 *
 * Positive means charged. A booking that fell through nets to zero, because
 * the export raises the dues and then waives the same amount; so does a member
 * whose transfer was cancelled. Someone who moved out mid-week nets to a part
 * of the week, which is exactly the resolution wanted.
 */
export function netDuesBilled(lines: readonly BilledLine[]): Cents {
  const total = sumCents(lines.filter(isDuesLine).map((l) => l.amountCents));
  // Negating a zero sum yields -0, which is not Object.is-equal to 0 and would
  // surface as "-$0.00" the moment one reached a formatter.
  return total === 0 ? 0 : -total;
}

function netDuesBilledBy(
  lines: readonly BilledLine[],
  key: (line: BilledLine) => string | null,
): Map<string, Cents> {
  const totals = new Map<string, Cents>();
  for (const line of lines) {
    if (!isDuesLine(line)) continue;
    const id = key(line);
    if (!id) continue;
    totals.set(id, (totals.get(id) ?? 0) - line.amountCents);
  }
  return totals;
}

/** Rooms someone was billed rent for: rooms that were let, at all, that month. */
export function roomsLet(lines: readonly BilledLine[]): number {
  return [...netDuesBilledBy(lines, (l) => l.roomNumber).values()].filter((cents) => cents > 0).length;
}

/** People who actually took a room. Fallen-through bookings net to nothing. */
export function residentsBilled(lines: readonly BilledLine[]): number {
  return [...netDuesBilledBy(lines, (l) => l.memberId).values()].filter((cents) => cents > 0).length;
}

/** PadSplit bills dues weekly, in advance, on each member's own anniversary day. */
export const DUES_PERIOD_DAYS = 7;

export interface TenancyEnd {
  roomNumber: string;
  memberId: string;
  memberName: string | null;
  /** The last week they were billed for. */
  lastDuesDate: IsoDate;
  /** The month the turnover is attributed to. */
  earningsMonth: MonthKey;
}

/**
 * Tenancies that ended, read off the billing cadence.
 *
 * A turnover is a room emptying, and the earlier rule — people beyond one per
 * room — could only see a handover that completed inside one calendar month.
 * A resident who left with nobody lined up registered in no month at all: five
 * people left one house in a single week and it reported zero.
 *
 * Dues are billed weekly in advance, so a tenancy shows its own end by
 * stopping. If the next week's charge was due before the export was taken and
 * never came, they had gone by then.
 *
 * `horizon` is the last date the export can speak to — the latest billed date
 * in the file. Someone whose next charge falls after it is not judged, which
 * is why a move-out in the final week of an export is invisible until the next
 * one arrives: the count for the most recent month is a floor, not a total.
 *
 * A move between rooms in the same house ends a tenancy here, and should: the
 * room they left emptied and had to be re-let.
 */
export function tenancyEnds(lines: readonly BilledLine[], horizon: IsoDate): TenancyEnd[] {
  interface Last {
    date: IsoDate;
    month: MonthKey;
    name: string | null;
  }
  const last = new Map<string, Last>();

  for (const line of lines) {
    if (line.reason !== 'membership_dues' || line.amountCents >= 0) continue;
    if (!line.roomNumber || !line.memberId) continue;
    const key = `${line.roomNumber}|${line.memberId}`;
    const found = last.get(key);
    if (!found || line.billedDate > found.date) {
      last.set(key, { date: line.billedDate, month: line.earningsMonth, name: line.memberName });
    }
  }

  // A booking that fell through is charged and waived to nothing. It never was
  // a tenancy, so it cannot have ended.
  const net = netDuesBilledBy(lines, (l) => (l.roomNumber && l.memberId ? `${l.roomNumber}|${l.memberId}` : null));

  const ends: TenancyEnd[] = [];
  for (const [key, found] of last) {
    if ((net.get(key) ?? 0) <= 0) continue;
    if (daysBetween(found.date, horizon) < DUES_PERIOD_DAYS) continue;
    const [roomNumber, memberId] = key.split('|');
    ends.push({ roomNumber, memberId, memberName: found.name, lastDuesDate: found.date, earningsMonth: found.month });
  }
  return ends.sort((a, b) => a.lastDuesDate.localeCompare(b.lastDuesDate));
}

/** The last date an export can speak to: nothing after it has been billed yet. */
export function billedHorizon(lines: readonly BilledLine[]): IsoDate | null {
  return lines.reduce<IsoDate | null>((latest, l) => (latest === null || l.billedDate > latest ? l.billedDate : latest), null);
}

/**
 * Tenancy ends per earnings month, which is the turnover count for that month.
 *
 * Pass the horizon from the whole export rather than letting it come from one
 * property's own lines: a house that stopped billing early would otherwise
 * judge itself against its own last day and report nobody as having left.
 */
export function turnoversByMonth(
  lines: readonly BilledLine[],
  exportHorizon?: IsoDate | null,
): Map<MonthKey, number> {
  const horizon = exportHorizon ?? billedHorizon(lines);
  const counts = new Map<MonthKey, number>();
  if (horizon === null) return counts;
  for (const end of tenancyEnds(lines, horizon)) {
    counts.set(end.earningsMonth, (counts.get(end.earningsMonth) ?? 0) + 1);
  }
  return counts;
}

/**
 * True while a month's turnover count can still rise: a resident billed within
 * a week of the horizon may already have gone without the export showing it.
 */
export function turnoverProvisional(
  lines: readonly BilledLine[],
  month: MonthKey,
  exportHorizon?: IsoDate | null,
): boolean {
  const horizon = exportHorizon ?? billedHorizon(lines);
  if (horizon === null) return false;
  return lines.some(
    (l) =>
      l.earningsMonth === month &&
      l.reason === 'membership_dues' &&
      l.amountCents < 0 &&
      daysBetween(l.billedDate, horizon) < DUES_PERIOD_DAYS,
  );
}

/**
 * The stretch of a month an export can actually speak to.
 *
 * A weekly charge is raised in advance and pays for the seven days from the
 * day it was raised, so a file whose last charge is the 24th has paid-for days
 * running to the 30th. Beyond that nothing has been billed yet, and counting
 * those days as vacant would report a live house as emptying every time an
 * export was taken mid-month.
 */
export interface OccupancyWindow {
  from: IsoDate;
  to: IsoDate;
  days: number;
}

export function occupancyWindow(month: MonthKey, horizon: IsoDate | null): OccupancyWindow {
  const from = monthStart(month);
  const end = monthEnd(month);
  const covered = horizon === null ? end : addDays(horizon, DUES_PERIOD_DAYS - 1);
  const to = covered < end ? covered : end;
  return { from, to, days: to < from ? 0 : daysBetween(from, to) + 1 };
}

/**
 * Room-days let in a window, allocated from the weeks that paid for them.
 *
 * Never bucketed by earnings month, which is the trap the first version fell
 * into: a charge raised on 30 July pays for the first five days of August but
 * is filed under July, so a room occupied all month showed only three of its
 * four and a half weeks. Spreading each charge across the days it covers is
 * phase-independent and gets the month boundary right.
 *
 * Days are counted per room, not per member, so a mid-month handover is one
 * occupied room rather than two.
 */
export function roomDaysLet(lines: readonly BilledLine[], window: OccupancyWindow): number {
  // A booking charged and then waived to nothing was never a tenancy and
  // bought no days.
  const net = netDuesBilledBy(lines, (l) => (l.roomNumber && l.memberId ? `${l.roomNumber}|${l.memberId}` : null));

  const days = new Set<string>();
  for (const line of lines) {
    if (line.reason !== 'membership_dues' || line.amountCents >= 0) continue;
    if (!line.roomNumber || !line.memberId) continue;
    if ((net.get(`${line.roomNumber}|${line.memberId}`) ?? 0) <= 0) continue;

    for (let offset = 0; offset < DUES_PERIOD_DAYS; offset += 1) {
      const day = addDays(line.billedDate, offset);
      if (day < window.from || day > window.to) continue;
      days.add(`${line.roomNumber}|${day}`);
    }
  }
  return days.size;
}

/** Occupancy as room-days let against room-days the house had to sell. */
export function occupancyFromRoomDays(roomDays: number, roomsTotal: number, window: OccupancyWindow): number | null {
  const available = roomsTotal * window.days;
  if (available <= 0) return null;
  return (roomDays / available) * 100;
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
  /** Rooms someone was billed rent for at any point in the month. */
  roomsLet: number;
  /** Room-days someone was billed for, allocated from the weeks that paid for them. */
  roomDaysLet: number;
  /** Room-days the house had to sell over the stretch the export can speak to. */
  roomDaysAvailable: number;
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
  const occupancy = pm.roomDaysAvailable > 0 ? (pm.roomDaysLet / pm.roomDaysAvailable) * 100 : null;

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
    hostEarningsPerOccupiedRoomCents: pm.roomsLet > 0 ? roundCents(pm.hostEarningsCents / pm.roomsLet) : null,
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
