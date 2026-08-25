import 'server-only';
import { prisma } from './db';
import { requireIsoDate } from './mappers';
import {
  MEMBERSHIP_DUES,
  metricsFor,
  trueRoomRate,
  type PropertyMonth,
  type PropertyMonthMetrics,
} from './engine/padsplit';
import type { MonthKey } from './engine/dates';

export interface OperationsRow extends PropertyMonth {
  propertyId: string;
  propertyName: string;
  metrics: PropertyMonthMetrics;
  /** Straight off summary.csv, which is authoritative for the money. */
  bookingFeesCents: number;
  serviceFeesCents: number;
  membersActive: number;
  /** Charges raised this month, and what has since been collected against them. */
  cohortChargedCents: number;
  cohortCollectedCents: number;
}

export interface AgeingBucket {
  label: string;
  amountCents: number;
}

export interface MemberBalance {
  memberId: string;
  memberName: string;
  propertyName: string;
  roomNumber: string | null;
  outstandingCents: number;
}

export interface OperationsData {
  months: MonthKey[];
  month: MonthKey;
  inFlight: boolean;
  rows: OperationsRow[];
  /** Every month for every property, for the per-property trend. */
  history: OperationsRow[];
  trueRoomRates: { propertyId: string; propertyName: string; rateCents: number | null; monthsUsed: number }[];
  ageing: AgeingBucket[];
  outstandingTotalCents: number;
  outstandingByReason: { reason: string; amountCents: number }[];
  memberBalances: MemberBalance[];
  daysToCollect: { median: number; p90: number; count: number } | null;
  hasData: boolean;
}

/**
 * The operating picture, keyed to the earnings month.
 *
 * Deliberately not the payout month, which is where the cash-basis income
 * belongs: occupancy in August is a fact about August, and reading it against
 * the month the money happened to arrive would make it meaningless. The two
 * keys answer different questions and both are kept.
 */
export async function getOperations(monthParam?: string): Promise<OperationsData> {
  const [summaries, collected, billed, totals, properties] = await Promise.all([
    prisma.summaryLine.findMany({ orderBy: [{ earningsMonth: 'asc' }] }),
    prisma.collectionLine.findMany(),
    prisma.billedLine.findMany(),
    prisma.padSplitMonthTotal.findMany(),
    prisma.property.findMany({ select: { id: true, name: true, externalId: true, roomCount: true } }),
  ]);

  const byPsid = new Map(properties.filter((p) => p.externalId).map((p) => [p.externalId as string, p]));
  const months = [...new Set(summaries.map((s) => s.earningsMonth))].sort();
  const month = monthParam && months.includes(monthParam) ? monthParam : (months[months.length - 1] ?? '');
  const inFlightMonths = new Set(totals.filter((t) => t.inFlight).map((t) => t.earningsMonth));

  // Which month of this property's own run each one is, for the ramp rule.
  const runIndex = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const s of summaries) {
    const next = (seen.get(s.propertyExternalId) ?? 0) + 1;
    seen.set(s.propertyExternalId, next);
    runIndex.set(`${s.propertyExternalId}:${s.earningsMonth}`, next);
  }

  // Cash collected against each individual charge, which is what makes a
  // recovery rate meaningful: a bill raised in July and paid in August belongs
  // to July's cohort, not August's.
  const paidByBill = new Map<string, number>();
  for (const line of collected) {
    if (!line.billId) continue;
    paidByBill.set(line.billId, (paidByBill.get(line.billId) ?? 0) + line.amountCents);
  }

  const build = (s: (typeof summaries)[number]): OperationsRow | null => {
    const property = byPsid.get(s.propertyExternalId);
    if (!property) return null;

    const c = collected.filter((x) => x.propertyExternalId === s.propertyExternalId && x.earningsMonth === s.earningsMonth);
    const b = billed.filter((x) => x.propertyExternalId === s.propertyExternalId && x.earningsMonth === s.earningsMonth);

    const rooms = new Set(
      c.filter((x) => x.billType === MEMBERSHIP_DUES && x.category === 'collected' && x.roomExternalId).map((x) => x.roomExternalId as string),
    );
    const charges = b.filter((x) => x.kind !== 'concession');

    const pm: PropertyMonth = {
      propertyExternalId: s.propertyExternalId,
      earningsMonth: s.earningsMonth,
      roomsTotal: property.roomCount ?? rooms.size,
      roomsOccupied: rooms.size,
      grossCents: s.grossCents,
      feesCents: s.bookingFeesCents + s.serviceFeesCents,
      adjustmentsCents: s.adjustmentsCents,
      hostEarningsCents: s.hostEarningsCents,
      payoutCents: s.totalPayoutCents,
      netBilledCents: -b.reduce((sum, x) => sum + x.amountCents, 0),
      grossCollectedCents: s.grossCents,
      activeMonthIndex: runIndex.get(`${s.propertyExternalId}:${s.earningsMonth}`) ?? 1,
      divesting: false,
      inFlight: inFlightMonths.has(s.earningsMonth),
    };

    return {
      ...pm,
      propertyId: property.id,
      propertyName: property.name,
      metrics: metricsFor(pm),
      bookingFeesCents: s.bookingFeesCents,
      serviceFeesCents: s.serviceFeesCents,
      membersActive: new Set(c.map((x) => x.memberId).filter(Boolean)).size,
      cohortChargedCents: -charges.reduce((sum, x) => sum + x.amountCents, 0),
      cohortCollectedCents: charges.reduce((sum, x) => sum + (paidByBill.get(x.billId) ?? 0), 0),
    };
  };

  const history = summaries.map(build).filter((row): row is OperationsRow => row !== null);
  const rows = history.filter((row) => row.earningsMonth === month);

  const trueRoomRates = [...new Set(history.map((row) => row.propertyId))].map((propertyId) => {
    const own = history.filter((row) => row.propertyId === propertyId);
    return {
      propertyId,
      propertyName: own[0].propertyName,
      rateCents: trueRoomRate(own),
      monthsUsed: own.filter((row) => !row.inFlight && !row.metrics.outlier).length,
    };
  });

  // What is still owed, aged by how old the charge is. Concessions are money
  // given back, never owed, so they are not in here.
  const order = [...months].reverse();
  const bucketOf = (m: string) => {
    const index = order.indexOf(m);
    return index === 0 ? '0–30 days' : index === 1 ? '31–60 days' : index === 2 ? '61–90 days' : 'Over 90 days';
  };
  const ageing = new Map<string, number>();
  const byReason = new Map<string, number>();
  const byMember = new Map<string, MemberBalance>();

  for (const bill of billed) {
    if (bill.kind === 'concession') continue;
    const outstanding = -bill.amountCents - (paidByBill.get(bill.billId) ?? 0);
    if (outstanding <= 0) continue;

    const bucket = bucketOf(bill.earningsMonth);
    ageing.set(bucket, (ageing.get(bucket) ?? 0) + outstanding);
    byReason.set(bill.reason, (byReason.get(bill.reason) ?? 0) + outstanding);

    if (bill.memberId) {
      const existing = byMember.get(bill.memberId);
      byMember.set(bill.memberId, {
        memberId: bill.memberId,
        memberName: bill.memberName ?? 'Unknown',
        propertyName: byPsid.get(bill.propertyExternalId ?? '')?.name ?? '—',
        roomNumber: bill.roomNumber,
        outstandingCents: (existing?.outstandingCents ?? 0) + outstanding,
      });
    }
  }

  // How long cash actually takes to arrive after a charge is raised.
  const billDate = new Map(billed.map((b) => [b.billId, requireIsoDate(b.billedDate)]));
  const lags: number[] = [];
  for (const line of collected) {
    const raised = line.billId ? billDate.get(line.billId) : undefined;
    if (!raised) continue;
    const days = Math.round((Date.parse(requireIsoDate(line.createdDate)) - Date.parse(raised)) / 86_400_000);
    if (days >= 0) lags.push(days);
  }
  lags.sort((a, b) => a - b);

  return {
    months,
    month,
    inFlight: inFlightMonths.has(month),
    rows,
    history,
    trueRoomRates,
    ageing: ['0–30 days', '31–60 days', '61–90 days', 'Over 90 days'].map((label) => ({
      label,
      amountCents: ageing.get(label) ?? 0,
    })),
    outstandingTotalCents: [...ageing.values()].reduce((sum, value) => sum + value, 0),
    outstandingByReason: [...byReason.entries()]
      .map(([reason, amountCents]) => ({ reason, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 8),
    memberBalances: [...byMember.values()].sort((a, b) => b.outstandingCents - a.outstandingCents).slice(0, 12),
    daysToCollect: lags.length
      ? { median: lags[Math.floor(lags.length / 2)], p90: lags[Math.floor(lags.length * 0.9)], count: lags.length }
      : null,
    hasData: summaries.length > 0,
  };
}
