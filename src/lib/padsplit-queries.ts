import 'server-only';
import { prisma } from './db';
import { requireIsoDate } from './mappers';
import {
  MEMBERSHIP_DUES,
  metricsFor,
  residents,
  roomsOccupied,
  turnovers,
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
  /** Distinct people who paid in the month. More than rooms means turnover. */
  membersActive: number;
  /** People beyond one per occupied room — rooms that changed hands. */
  turnovers: number;
  /** Charges raised this month, and what has since been collected against them. */
  cohortChargedCents: number;
  cohortCollectedCents: number;
}

export interface RoomHistory {
  propertyId: string;
  propertyName: string;
  roomNumber: string;
  /** Host earnings per month, null where the room earned nothing at all. */
  byMonth: (number | null)[];
  medianCents: number | null;
  /** Distinct people in the room across every month imported. */
  people: number;
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
  /** No charge in the latest month. Money from them rarely arrives. */
  movedOut: boolean;
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
  memberBalances: MemberBalance[];
  rooms: RoomHistory[];
  /** Members with no charge in the latest month — money from them rarely arrives. */
  movedOutOwedCents: number;
  currentOwedCents: number;
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

    // Reversed bookings are netted out by the engine: a booking that fell
    // through appears as a charge and its mirror, and counting either as a
    // resident put people in rooms they never took.
    const lines = c.map((line) => ({
      ...line,
      category: line.category === 'adjustment' ? ('adjustment' as const) : ('collected' as const),
      createdDate: requireIsoDate(line.createdDate),
    }));
    const occupied = roomsOccupied(lines);
    const charges = b.filter((x) => x.kind !== 'concession');

    const pm: PropertyMonth = {
      propertyExternalId: s.propertyExternalId,
      earningsMonth: s.earningsMonth,
      roomsTotal: property.roomCount ?? occupied,
      roomsOccupied: occupied,
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
      membersActive: residents(lines),
      turnovers: turnovers(lines),
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

  // What is still owed.
  //
  // Concessions are netted in, which an earlier version of this did not do:
  // it summed the charges and ignored the credits, so a member whose dues had
  // been waived still showed the full amount owing. A waiver, a discount and a
  // reversed penalty all reduce what is owed and all arrive as concession
  // lines, so the balance is the NET of everything billed less what was
  // collected against it.
  //
  // Adjustment collections are not payments — they carry no bill id and are
  // misc income to the host — so they never settle anything here.
  interface Ledger {
    netBilledCents: number;
    collectedCents: number;
  }
  const ledger = new Map<string, Map<string, Ledger>>(); // member -> month -> ledger
  const memberMeta = new Map<string, { name: string; propertyName: string; roomNumber: string | null }>();

  const entry = (memberId: string, month: string): Ledger => {
    const months = ledger.get(memberId) ?? new Map<string, Ledger>();
    const found = months.get(month) ?? { netBilledCents: 0, collectedCents: 0 };
    months.set(month, found);
    ledger.set(memberId, months);
    return found;
  };

  for (const bill of billed) {
    const memberId = bill.memberId ?? `unassigned:${bill.propertyExternalId ?? '?'}`;
    const row = entry(memberId, bill.earningsMonth);
    row.netBilledCents += -bill.amountCents; // charges negative, so owed is positive
    row.collectedCents += paidByBill.get(bill.billId) ?? 0;

    if (!memberMeta.has(memberId)) {
      memberMeta.set(memberId, {
        name: bill.memberName ?? 'Unassigned',
        propertyName: byPsid.get(bill.propertyExternalId ?? '')?.name ?? '—',
        roomNumber: bill.roomNumber,
      });
    }
  }

  // Ageing is oldest-first: money paid settles the oldest debt before the
  // newest, which is what makes "over 90 days" mean anything. Netting per
  // member and then bucketing would put a member who is paying steadily but
  // behind into the wrong bucket entirely.
  const order = [...months];
  const bucketFor = (m: string) => {
    const index = order.length - 1 - order.indexOf(m);
    return index <= 0 ? '0–30 days' : index === 1 ? '31–60 days' : index === 2 ? '61–90 days' : 'Over 90 days';
  };
  const ageing = new Map<string, number>();
  const byMember = new Map<string, MemberBalance>();

  for (const [memberId, byMonth] of ledger) {
    const owed = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let credit = owed.reduce((sum, [, row]) => sum + row.collectedCents, 0);
    let balance = 0;

    for (const [month, row] of owed) {
      let unpaid = row.netBilledCents;
      // A month that was net credited passes its credit forward.
      if (unpaid < 0) {
        credit += -unpaid;
        unpaid = 0;
      }
      const applied = Math.min(credit, unpaid);
      credit -= applied;
      unpaid -= applied;
      if (unpaid > 0) {
        ageing.set(bucketFor(month), (ageing.get(bucketFor(month)) ?? 0) + unpaid);
        balance += unpaid;
      }
    }

    const meta = memberMeta.get(memberId);
    if (balance > 0 && meta) {
      byMember.set(memberId, {
        memberId,
        memberName: meta.name,
        propertyName: meta.propertyName,
        roomNumber: meta.roomNumber,
        outstandingCents: balance,
        movedOut: false,
      });
    }
  }

  // Per room, which is the level the question is actually asked at. A median
  // across a whole house told you nothing you could act on; a room earning
  // $200 a month less than its neighbour and turning over seven times in eight
  // months is a specific thing to go and look at.
  const roomKey = (line: (typeof collected)[number]) => `${line.propertyExternalId}|${line.roomNumber}`;
  const roomTotals = new Map<string, Map<string, number>>();
  // Netted per member so a booking that fell through is not a person who lived
  // here: charged and reversed sums to zero, and only a positive total counts.
  const roomMemberNet = new Map<string, Map<string, number>>();
  for (const line of collected) {
    if (!line.roomNumber || !line.propertyExternalId || line.category !== 'collected') continue;
    const key = roomKey(line);
    const byMonth = roomTotals.get(key) ?? new Map<string, number>();
    byMonth.set(line.earningsMonth, (byMonth.get(line.earningsMonth) ?? 0) + line.hostEarningsCents);
    roomTotals.set(key, byMonth);

    if (line.memberId && line.billType === MEMBERSHIP_DUES) {
      const net = roomMemberNet.get(key) ?? new Map<string, number>();
      net.set(line.memberId, (net.get(line.memberId) ?? 0) + line.amountCents);
      roomMemberNet.set(key, net);
    }
  }

  const rooms: RoomHistory[] = [...roomTotals.entries()]
    .map(([key, byMonth]) => {
      const [psid, roomNumber] = key.split('|');
      const property = byPsid.get(psid);
      const values = months.map((m) => (byMonth.has(m) ? byMonth.get(m)! : null));
      const earned = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
      return {
        propertyId: property?.id ?? psid,
        propertyName: property?.name ?? psid,
        roomNumber,
        byMonth: values,
        medianCents: earned.length ? earned[Math.floor(earned.length / 2)] : null,
        people: [...(roomMemberNet.get(key)?.values() ?? [])].filter((cents) => cents > 0).length,
      };
    })
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName) || Number(a.roomNumber) - Number(b.roomNumber));

  // Money owed by someone who has left is a write-off in all but name: people
  // almost never pay after they move out. Splitting it out is the difference
  // between a receivable and a number that only looks like one.
  const latest = months[months.length - 1];
  const stillHere = new Set(billed.filter((b) => b.earningsMonth === latest && b.memberId).map((b) => b.memberId as string));
  const balances = [...byMember.values()];
  const currentOwedCents = balances.filter((m) => stillHere.has(m.memberId)).reduce((sum, m) => sum + m.outstandingCents, 0);
  const movedOutOwedCents = balances.filter((m) => !stillHere.has(m.memberId)).reduce((sum, m) => sum + m.outstandingCents, 0);
  for (const balance of balances) balance.movedOut = !stillHere.has(balance.memberId);

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
    memberBalances: balances.sort((a, b) => b.outstandingCents - a.outstandingCents).slice(0, 10),
    rooms,
    currentOwedCents,
    movedOutOwedCents,
    daysToCollect: lags.length
      ? { median: lags[Math.floor(lags.length / 2)], p90: lags[Math.floor(lags.length * 0.9)], count: lags.length }
      : null,
    hasData: summaries.length > 0,
  };
}
