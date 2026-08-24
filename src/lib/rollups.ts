import 'server-only';
import { prisma } from './db';
import { getCategoryCatalog } from './categories-queries';
import { toLoanPayment, toLoanTerms, requireIsoDate } from './mappers';
import { balanceAtDate, debtServiceForMonth } from './engine/amortization';
import { assemblePropertyRollup, deriveFromBank } from './engine/assemble';
import { periodTotals, type ClassifiedTransaction } from './engine/bank';
import { monthEnd, monthStart, type MonthKey } from './engine/dates';

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
    // PadSplit figures arrive with build step 4; until then a coliving house
    // shows its owner-paid costs and its deposits, and nothing it has not
    // actually got data for.
    padsplit: null,
  });

  const data = {
    revenueCents: rollup.revenueCents,
    hostEarningsCents: rollup.hostEarningsCents,
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
