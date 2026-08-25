import 'server-only';
import { prisma } from './db';
import { getCategoryCatalog } from './categories-queries';
import { toLoanPayment, toLoanTerms, requireIsoDate } from './mappers';
import { balanceAtDate, debtServiceForMonth } from './engine/amortization';
import { assemblePropertyRollup, deriveFromBank } from './engine/assemble';
import { periodTotals, type ClassifiedTransaction } from './engine/bank';
import { monthEnd, monthStart, type MonthKey } from './engine/dates';
import { MEMBERSHIP_DUES } from './engine/padsplit';

/**
 * Rollups are materialized and recomputed on every import (§11).
 *
 * They are always stored at property level and at 100%; the view multiplier is
 * applied at read time. Storing a pro-rated figure would bake one viewer's
 * share into a number every other view has to undo.
 */
export async function recomputePropertyMonth(propertyId: string, month: MonthKey): Promise<void> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { bankAccounts: true, loans: { include: { payments: true } } },
  });
  if (!property) return;

  const accountIds = property.bankAccounts.map((a) => a.id);
  const transactions = accountIds.length
    ? await prisma.bankTransaction.findMany({
        where: {
          statement: { bankAccountId: { in: accountIds }, status: 'posted' },
          date: { gte: new Date(`${monthStart(month)}T00:00:00.000Z`), lte: new Date(`${monthEnd(month)}T00:00:00.000Z`) },
          // A row that was split is a container; its pieces carry the money.
          splits: { none: {} },
        },
      })
    : [];

  const classified: ClassifiedTransaction[] = transactions.map((t) => ({
    date: requireIsoDate(t.date),
    description: t.description,
    amountCents: t.amountCents,
    runningBalanceCents: t.runningBalanceCents,
    categoryKey: t.categoryKey,
    matchedRuleId: t.matchedRuleId,
  }));

  const catalog = await getCategoryCatalog();
  const bank = deriveFromBank(periodTotals(classified, catalog), catalog);
  const asOf = monthEnd(month);

  // PadSplit, on a cash basis: the rent for an earnings month lands the month
  // after, so the month being computed takes the summary row whose PAYOUT
  // month is this one. That is what makes the revenue here agree with the
  // deposit on the statement.
  //
  // The operational figures — rooms, occupancy, collection — come from the
  // same row but describe its earnings month, which is why they are read
  // separately and never mixed with the money above.
  const summary = await prisma.summaryLine.findFirst({
    where: { propertyId, payoutMonth: month },
  });

  let padsplit: Parameters<typeof assemblePropertyRollup>[0]['padsplit'] = null;
  if (summary) {
    const lines = await prisma.collectionLine.findMany({
      where: { propertyId, earningsMonth: summary.earningsMonth },
      select: { roomExternalId: true, billType: true, category: true },
    });
    const billedLines = await prisma.billedLine.findMany({
      where: { propertyId, earningsMonth: summary.earningsMonth },
      select: { amountCents: true },
    });
    const rooms = new Set(
      lines
        .filter((l) => l.billType === MEMBERSHIP_DUES && l.category === 'collected' && l.roomExternalId)
        .map((l) => l.roomExternalId as string),
    );
    const netBilledCents = -billedLines.reduce((total, line) => total + line.amountCents, 0);
    const inFlight = await prisma.padSplitMonthTotal.findFirst({
      where: { earningsMonth: summary.earningsMonth, inFlight: true },
    });

    padsplit = {
      grossCollectedCents: summary.grossCents,
      // Booking plus service fees, as a positive cost.
      platformFeesCents: -(summary.bookingFeesCents + summary.serviceFeesCents),
      adjustmentsCents: summary.adjustmentsCents,
      hostEarningsCents: summary.hostEarningsCents,
      // A PM fee is charged on top of the platform's cut where a manager is
      // involved; self-managed coliving has none, and it is derived elsewhere.
      pmFeeCents: 0,
      pmPaidOpexCents: 0,
      roomsOccupied: rooms.size,
      occupancyRate: property.roomCount ? (rooms.size / property.roomCount) * 100 : null,
      // Withheld while the month is still collecting: a partial figure read as
      // a final one is worse than no figure.
      collectionRate: inFlight || netBilledCents === 0 ? null : (summary.grossCents / netBilledCents) * 100,
      delinquencyCents: inFlight ? 0 : netBilledCents - summary.grossCents,
      trueRoomRateCents: null,
    };
  }

  const activeLoans = property.loans.filter((loan) => loan.status === 'active');
  const debtServiceCents = activeLoans.reduce(
    (total, loan) => total + debtServiceForMonth(toLoanTerms(loan), month, loan.payments.map(toLoanPayment)),
    0,
  );
  const debtBalanceCents = activeLoans.reduce(
    (total, loan) => total + balanceAtDate(toLoanTerms(loan), asOf, loan.payments.map(toLoanPayment)),
    0,
  );

  const rollup = assemblePropertyRollup({
    propertyId,
    month,
    entityId: property.titleEntityId,
    bank,
    debtServiceCents,
    debtBalanceCents,
    roomsTotal: property.roomCount ?? 0,
    padsplit,
  });

  const data = {
    revenueCents: rollup.revenueCents,
    hostEarningsCents: rollup.hostEarningsCents,
    platformFeesCents: rollup.platformFeesCents,
    pmFeeCents: rollup.pmFeeCents,
    ownerPaidOpexCents: rollup.ownerPaidOpexCents,
    pmPaidOpexCents: rollup.pmPaidOpexCents,
    operatingExpenseCents: rollup.operatingExpenseCents,
    noiCents: rollup.noiCents,
    depositReceivedCents: rollup.depositReceivedCents,
    debtServiceCents: rollup.debtServiceCents,
    debtBalanceCents: rollup.debtBalanceCents,
    netCashCents: rollup.netCashCents,
    roomsTotal: rollup.roomsTotal,
    roomsOccupied: rollup.roomsOccupied,
    occupancyRate: rollup.occupancyRate,
    collectionRate: rollup.collectionRate,
    delinquencyCents: rollup.delinquencyCents,
    trueRoomRateCents: rollup.trueRoomRateCents,
    tieStatus: 'tied',
    computedAt: new Date(),
  };

  // Cash and accrual are the same figure for a property whose revenue is
  // categorized on its own statement — there is no earnings month to key to
  // until the PadSplit or PM data exists. Both rows are written so the
  // cash/accrual toggle has something to read either way, and so the day they
  // diverge nothing downstream has to change shape.
  for (const basis of ['cash', 'accrual'] as const) {
    await prisma.monthlyPropertyRollup.upsert({
      where: { propertyId_month_basis: { propertyId, month, basis } },
      create: { propertyId, month, basis, ...data },
      update: data,
    });
  }
}

/** Recompute every month a statement touched. */
export async function recomputeMonths(propertyId: string, months: readonly MonthKey[]): Promise<void> {
  for (const month of [...new Set(months)]) {
    await recomputePropertyMonth(propertyId, month);
  }
}
