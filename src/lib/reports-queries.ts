import 'server-only';
import { prisma } from './db';
import { getCategoryCatalog } from './categories-queries';
import { requireIsoDate, toLoanPayment, toLoanTerms, toOwnershipInterest } from './mappers';
import { buildSchedule } from './engine/amortization';
import { effectiveShare } from './engine/ownership';
import { capitalPositions, type CapitalEntry } from './engine/payouts';
import { valuationAsOf, type Valuation, type ValuationSource } from './engine/equity';
import { buildScheduleE, monthsOfYear, type ScheduleEReport, type TaxTransaction } from './engine/tax';
import { capRate, cashOnCash, dscr, equityMultiple, expenseRatio, propertyIrr, type IrrResult } from './engine/metrics';

export interface PropertyYear {
  propertyId: string;
  propertyName: string;
  entityId: string;
  entityName: string;
  scheduleE: ScheduleEReport;
  /** Interest and principal separated, from the schedules. */
  mortgageInterestCents: number;
  principalPaidCents: number;
  debtServiceCents: number;
  noiCents: number;
  revenueCents: number;
  operatingExpenseCents: number;
  netCashCents: number;
  monthsWithData: number;
  valueCents: number;
  debtBalanceCents: number;
  cashInvestedCents: number;
  sharePercent: number;
  metrics: {
    capRatePercent: number | null;
    capRateAnnualised: boolean;
    dscr: number | null;
    cashOnCashPercent: number | null;
    expenseRatioPercent: number | null;
    equityMultiple: number | null;
    irr: IrrResult;
  };
}

export async function getYearReport(year: number, entityId?: string | null) {
  const months = monthsOfYear(year);
  const yearEnd = `${year}-12-31`;

  const [catalog, properties, accounts, transactions, loans, rollups, valuationRows, interests, entities, capitalRows] =
    await Promise.all([
      getCategoryCatalog(),
      prisma.property.findMany({
        where: entityId ? { titleEntityId: entityId } : {},
        include: { titleEntity: true },
        orderBy: { name: 'asc' },
      }),
      prisma.bankAccount.findMany(),
      prisma.bankTransaction.findMany({
        where: { statement: { status: 'posted' }, date: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
        include: { statement: { include: { bankAccount: true } } },
      }),
      prisma.loan.findMany({ include: { payments: true } }),
      prisma.monthlyPropertyRollup.findMany({ where: { month: { in: months }, basis: 'cash' } }),
      prisma.valuation.findMany(),
      prisma.ownershipInterest.findMany(),
      prisma.entity.findMany(),
      prisma.capitalAccountEntry.findMany(),
    ]);

  const engineInterests = interests.map(toOwnershipInterest);
  const viewer = entities.find((e) => e.isViewer);
  const valuations: Valuation[] = valuationRows.map((v) => ({
    id: v.id,
    propertyId: v.propertyId,
    date: requireIsoDate(v.date),
    valueCents: v.valueCents,
    source: v.source as ValuationSource,
  }));
  const capitalEntries: CapitalEntry[] = capitalRows.map((entry) => ({
    entityId: entry.entityId,
    propertyId: entry.propertyId,
    kind: entry.kind,
    date: requireIsoDate(entry.date),
    amountCents: entry.amountCents,
  }));

  const accountProperty = new Map(accounts.map((a) => [a.id, a.propertyId]));

  const rows: PropertyYear[] = properties.map((property) => {
    const propertyTransactions: TaxTransaction[] = transactions
      .filter((t) => accountProperty.get(t.statement.bankAccountId) === property.id)
      .map((t) => ({
        date: requireIsoDate(t.date),
        categoryKey: t.categoryKey,
        amountCents: t.amountCents,
        description: t.description,
      }));

    // Interest and principal come from the schedules; a statement shows one
    // undivided debit, and only the interest half is deductible.
    let mortgageInterest = 0;
    let principalPaid = 0;
    let debtService = 0;
    let escrowPaid = 0;
    let escrowTax = 0;
    let escrowInsurance = 0;
    for (const loan of loans.filter((l) => l.propertyId === property.id)) {
      const schedule = buildSchedule(toLoanTerms(loan), loan.payments.map(toLoanPayment));
      let monthsInYear = 0;
      for (const row of schedule) {
        if (!months.includes(row.month)) continue;
        monthsInYear += 1;
        mortgageInterest += row.interestCents;
        principalPaid += row.principalCents + row.extraPrincipalCents;
        debtService += row.paymentCents;
        escrowPaid += row.escrowCents;
      }
      // A loan that ran for part of the year disbursed part of the year's
      // bills, so the annual figures are prorated by months scheduled.
      const share = Math.min(monthsInYear, 12) / 12;
      escrowTax += Math.round((loan.escrowTaxAnnualCents ?? 0) * share);
      escrowInsurance += Math.round((loan.escrowInsuranceAnnualCents ?? 0) * share);
    }

    const scheduleE = buildScheduleE({
      year,
      propertyId: property.id,
      transactions: propertyTransactions,
      mortgageInterestCents: mortgageInterest,
      escrowPaidCents: escrowPaid,
      escrowTaxCents: escrowTax,
      escrowInsuranceCents: escrowInsurance,
      catalog,
    });

    const propertyRollups = rollups.filter((r) => r.propertyId === property.id);
    const monthsWithData = propertyRollups.length;
    const revenue = propertyRollups.reduce((sum, r) => sum + r.revenueCents, 0);
    const operatingExpense = propertyRollups.reduce((sum, r) => sum + r.operatingExpenseCents, 0);
    const noi = propertyRollups.reduce((sum, r) => sum + r.noiCents, 0);
    const netCash = propertyRollups.reduce((sum, r) => sum + r.netCashCents, 0);

    const valuation = valuationAsOf(valuations, property.id, yearEnd);
    const debtBalance = loans
      .filter((l) => l.propertyId === property.id && l.status === 'active')
      .reduce((sum, loan) => {
        const schedule = buildSchedule(toLoanTerms(loan), loan.payments.map(toLoanPayment));
        const last = [...schedule].reverse().find((r) => r.dueDate <= yearEnd);
        return sum + (last ? last.closingBalanceCents : loan.originalPrincipalCents);
      }, 0);

    // Cash invested: what was entered, else what owners actually contributed.
    const contributed = capitalPositions(capitalEntries, property.id).reduce((sum, p) => sum + p.contributedCents, 0);
    const cashInvested = property.cashInvestedCents ?? contributed;

    const distributions = capitalEntries
      .filter((e) => e.propertyId === property.id && e.kind !== 'contribution')
      .reduce((sum, e) => sum + e.amountCents, 0);

    const sharePercent = viewer ? effectiveShare(engineInterests, viewer.id, property.id, yearEnd, 'equity').percent : 0;
    const value = valuation?.valueCents ?? 0;

    const cap = capRate({ noiCents: noi, monthsObserved: monthsWithData, valueCents: value });
    const coc = cashOnCash({ netCashCents: netCash, monthsObserved: monthsWithData, cashInvestedCents: cashInvested });

    return {
      propertyId: property.id,
      propertyName: property.name,
      entityId: property.titleEntityId,
      entityName: property.titleEntity.name,
      scheduleE,
      mortgageInterestCents: mortgageInterest,
      principalPaidCents: principalPaid,
      debtServiceCents: debtService,
      noiCents: noi,
      revenueCents: revenue,
      operatingExpenseCents: operatingExpense,
      netCashCents: netCash,
      monthsWithData,
      valueCents: value,
      debtBalanceCents: debtBalance,
      cashInvestedCents: cashInvested,
      sharePercent,
      metrics: {
        capRatePercent: cap.percent,
        capRateAnnualised: cap.annualised,
        dscr: dscr({ noiCents: noi, debtServiceCents: debtService }),
        cashOnCashPercent: coc.percent,
        expenseRatioPercent: expenseRatio({ revenueCents: revenue, operatingExpenseCents: operatingExpense }),
        equityMultiple: equityMultiple({
          distributionsCents: distributions,
          currentEquityCents: value - debtBalance,
          cashInvestedCents: cashInvested,
        }),
        irr: propertyIrr({
          cashInvestedCents: cashInvested,
          acquiredOn: property.acquiredOn ? requireIsoDate(property.acquiredOn) : null,
          monthlyNetCash: propertyRollups
            .map((r) => ({ month: r.month, netCashCents: r.netCashCents }))
            .sort((a, b) => a.month.localeCompare(b.month)),
          exitValueCents: value - debtBalance,
          exitDate: yearEnd,
          exitIsSale: false,
        }),
      },
    };
  });

  const availableYears = [...new Set(rollups.map((r) => r.month.slice(0, 4)))];

  return {
    year,
    catalog,
    rows,
    entities: entities.map((e) => ({ value: e.id, label: e.name })),
    crossesEntities: new Set(rows.map((r) => r.entityId)).size > 1,
    totalUncategorized: rows.reduce((sum, r) => sum + r.scheduleE.uncategorizedCount, 0),
    monthsCovered: new Set(rollups.map((r) => r.month)).size,
    availableYears,
  };
}
