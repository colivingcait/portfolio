import 'server-only';
import { prisma } from './db';
import { toLoanTerms, toLoanPayment, toManagementPeriod, toOwnershipInterest, requireIsoDate } from './mappers';
import { effectiveShare, findTotalsWarnings, type OwnershipInterest } from './engine/ownership';
import { balanceAtDate, buildMaturityLadder, debtServiceForMonth, maturityDateOf, type LoanTerms, type LoanPaymentRecord } from './engine/amortization';
import { managementForMonth, type ManagementPeriod } from './engine/management';
import { monthEnd, monthStart, type IsoDate, type MonthKey } from './engine/dates';
import type { ViewKind } from './engine/rollup';

export function currentMonth(): MonthKey {
  return new Date().toISOString().slice(0, 7);
}

export function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

/** The node the "My share" view traverses from. */
export async function getViewer() {
  return prisma.entity.findFirst({ where: { isViewer: true } });
}

export interface OwnershipContext {
  interests: OwnershipInterest[];
  /** propertyId -> effective percent for the viewer, on `asOf`. */
  shares: Map<string, number>;
  /** Interests in one thing that do not total 100% on `asOf`. Warn, never block. */
  warnings: { ownedId: string; ownedType: 'property' | 'entity'; totalPercent: number }[];
  viewerId: string | null;
  names: Map<string, string>;
}

export async function getOwnershipContext(asOf: IsoDate, viewerIdOverride?: string | null): Promise<OwnershipContext> {
  const [rows, entities, properties, viewer] = await Promise.all([
    prisma.ownershipInterest.findMany(),
    prisma.entity.findMany(),
    prisma.property.findMany({ select: { id: true, name: true } }),
    viewerIdOverride ? null : getViewer(),
  ]);

  const interests = rows.map(toOwnershipInterest);
  const viewerId = viewerIdOverride ?? viewer?.id ?? null;

  const shares = new Map<string, number>();
  if (viewerId) {
    for (const property of properties) {
      const share = effectiveShare(interests, viewerId, property.id, asOf);
      if (share.percent > 0) shares.set(property.id, share.percent);
    }
  }

  const names = new Map<string, string>();
  for (const e of entities) names.set(e.id, e.name);
  for (const p of properties) names.set(p.id, p.name);

  return { interests, shares, warnings: findTotalsWarnings(interests, asOf), viewerId, names };
}

export interface PropertyDebt {
  balanceCents: number;
  monthlyDebtServiceCents: number;
  loanCount: number;
  guaranteedCents: number;
  nextMaturity: IsoDate | null;
}

interface LoanBundle {
  id: string;
  propertyId: string;
  terms: LoanTerms;
  payments: LoanPaymentRecord[];
  guarantor: boolean;
}

async function loadLoans(where: { propertyId?: string } = {}): Promise<LoanBundle[]> {
  const loans = await prisma.loan.findMany({
    where: { status: 'active', ...where },
    include: { payments: { orderBy: { date: 'asc' } } },
  });
  return loans.map((loan) => ({
    id: loan.id,
    propertyId: loan.propertyId,
    terms: toLoanTerms(loan),
    payments: loan.payments.map(toLoanPayment),
    guarantor: loan.personallyGuaranteed,
  }));
}

/**
 * Debt per property, as of a date and over a stretch of months.
 *
 * The balance is a position and is taken at `asOf`; debt service is a flow and
 * is summed over every month asked for. Passing one month gives the old
 * behaviour.
 */
export async function getDebtByProperty(
  asOf: IsoDate,
  months: MonthKey | readonly MonthKey[],
): Promise<Map<string, PropertyDebt>> {
  const span = typeof months === 'string' ? [months] : [...months];
  const loans = await loadLoans();
  const byProperty = new Map<string, PropertyDebt>();

  for (const loan of loans) {
    const balance = balanceAtDate(loan.terms, asOf, loan.payments);
    const debtService = span.reduce(
      (total, month) => total + debtServiceForMonth(loan.terms, month, loan.payments),
      0,
    );
    const maturity = maturityDateOf(loan.terms);

    const current = byProperty.get(loan.propertyId) ?? {
      balanceCents: 0,
      monthlyDebtServiceCents: 0,
      loanCount: 0,
      guaranteedCents: 0,
      nextMaturity: null,
    };

    current.balanceCents += balance;
    current.monthlyDebtServiceCents += debtService;
    current.loanCount += 1;
    if (loan.guarantor) current.guaranteedCents += balance;
    if (!current.nextMaturity || maturity < current.nextMaturity) current.nextMaturity = maturity;

    byProperty.set(loan.propertyId, current);
  }

  return byProperty;
}

export interface PortfolioRow {
  id: string;
  name: string;
  entityId: string;
  entityName: string;
  revenueSource: string;
  unitStructure: string;
  status: string;
  dataVerified: boolean;
  roomCount: number | null;
  unitCount: number | null;
  managementMode: 'self' | 'pm' | null;
  managerName: string | null;
  feePercent: number | null;
  transitionMonth: boolean;
  sharePercent: number;
  /** A posted statement covers this month, so zero costs means zero, not missing. */
  hasStatement: boolean;
  debt: PropertyDebt | null;
  /** Present only once imports have run — step 2 onwards. */
  rollup: {
    revenueCents: number;
    platformFeesCents: number;
    pmFeeCents: number;
    depositReceivedCents: number;
    expectedDepositCents: number;
    depositVarianceCents: number;
    ownerPaidOpexCents: number;
    debtServiceCents: number;
    netCashCents: number;
    occupancyRate: number | null;
    collectionRate: number | null;
    tieStatus: string;
    inFlight: boolean;
    /** How many months of the period actually had figures. */
    monthsCovered: number;
  } | null;
}

export interface PortfolioData {
  /** Every month the figures cover, ascending. */
  months: MonthKey[];
  /** The last of them, which is what a balance is "as of". */
  month: MonthKey;
  rows: PortfolioRow[];
  ownership: OwnershipContext;
  crossesEntities: boolean;
  unverifiedCount: number;
  hasAnyRollup: boolean;
}

/**
 * The portfolio across a stretch of months.
 *
 * Flow lines add up; balances do not. Debt balance is taken at the end of the
 * period rather than summed, and a rate is rebuilt from its own two halves —
 * occupancy over a quarter is room-days over room-days, never the mean of
 * three monthly percentages.
 */
export async function getPortfolio(
  months: readonly MonthKey[],
  view: ViewKind,
  entityId?: string | null,
  propertyId?: string | null,
): Promise<PortfolioData> {
  const span = [...months].sort();
  const first = span[0] ?? currentMonth();
  const last = span[span.length - 1] ?? first;
  const asOf = monthEnd(last);

  const statementMonths = await prisma.bankStatement.findMany({
    where: { status: 'posted', periodStart: { lte: new Date(`${asOf}T00:00:00Z`) }, periodEnd: { gte: new Date(`${monthStart(first)}T00:00:00Z`) } },
    select: { bankAccount: { select: { propertyId: true } } },
  });
  const covered = new Set(statementMonths.map((s) => s.bankAccount.propertyId));

  const [properties, periods, ownership, debt, rollups] = await Promise.all([
    prisma.property.findMany({
      where: {
        ...(entityId ? { titleEntityId: entityId } : {}),
        ...(propertyId ? { id: propertyId } : {}),
      },
      include: { titleEntity: true },
      orderBy: { name: 'asc' },
    }),
    prisma.managementPeriod.findMany(),
    getOwnershipContext(asOf),
    getDebtByProperty(asOf, span),
    prisma.monthlyPropertyRollup.findMany({
      where: { month: { in: span }, basis: 'accrual' },
      orderBy: { month: 'asc' },
    }),
  ]);

  const enginePeriods: ManagementPeriod[] = periods.map(toManagementPeriod);

  const byProperty = new Map<string, typeof rollups>();
  for (const row of rollups) {
    const own = byProperty.get(row.propertyId) ?? [];
    own.push(row);
    byProperty.set(row.propertyId, own);
  }

  const rows: PortfolioRow[] = properties.map((property) => {
    const management = managementForMonth(enginePeriods, property.id, last);
    const own = byProperty.get(property.id) ?? [];
    const rollup = aggregateRollups(own);
    const sharePercent =
      view === 'portfolio' || view === 'property' ? 100 : (ownership.shares.get(property.id) ?? 0);

    return {
      id: property.id,
      name: property.name,
      entityId: property.titleEntityId,
      entityName: property.titleEntity.name,
      revenueSource: property.revenueSource,
      unitStructure: property.unitStructure,
      status: property.status,
      dataVerified: property.dataVerified,
      roomCount: property.roomCount,
      unitCount: property.unitCount,
      managementMode: management.effective?.mode ?? null,
      managerName: management.effective?.managerName ?? null,
      feePercent: management.effective?.feePercent ?? null,
      transitionMonth: management.transition,
      sharePercent,
      hasStatement: covered.has(property.id),
      debt: debt.get(property.id) ?? null,
      rollup,
    };
  });

  const visible = view === 'my_share' || view === 'partner' ? rows.filter((r) => r.sharePercent > 0) : rows;

  return {
    months: span,
    month: last,
    rows: visible,
    ownership,
    crossesEntities: new Set(visible.map((r) => r.entityId)).size > 1,
    unverifiedCount: visible.filter((r) => !r.dataVerified).length,
    hasAnyRollup: rollups.length > 0,
  };
}

type StoredRollup = Awaited<ReturnType<typeof prisma.monthlyPropertyRollup.findMany>>[number];

/**
 * Several months of one property, as one set of figures.
 *
 * Returns null for a property with nothing in the period, which is different
 * from a property that earned nothing — the caller renders those differently.
 */
function aggregateRollups(rows: StoredRollup[]): PortfolioRow['rollup'] {
  if (rows.length === 0) return null;

  const sum = (pick: (r: StoredRollup) => number) => rows.reduce((total, r) => total + pick(r), 0);
  // Ordered by month, so the last row is the end of the period.
  const end = rows[rows.length - 1];

  const roomDays = sum((r) => r.roomDaysLet);
  const roomDaysAvailable = sum((r) => r.roomDaysAvailable);
  // A month still collecting has no collection rate, and lending its billed
  // figure to the denominator would drag the period's rate down with it.
  const settled = rows.filter((r) => !r.inFlight);
  const billed = settled.reduce((total, r) => total + r.netBilledCents, 0);
  const collected = settled.reduce((total, r) => total + r.revenueCents, 0);

  return {
    revenueCents: sum((r) => r.revenueCents),
    platformFeesCents: sum((r) => r.platformFeesCents),
    pmFeeCents: sum((r) => r.pmFeeCents),
    expectedDepositCents: sum((r) => r.expectedDepositCents),
    depositVarianceCents: sum((r) => r.depositVarianceCents),
    debtServiceCents: sum((r) => r.debtServiceCents),
    depositReceivedCents: sum((r) => r.depositReceivedCents),
    ownerPaidOpexCents: sum((r) => r.ownerPaidOpexCents),
    netCashCents: sum((r) => r.netCashCents),
    occupancyRate: roomDaysAvailable > 0 ? (roomDays / roomDaysAvailable) * 100 : null,
    collectionRate: billed > 0 ? (collected / billed) * 100 : null,
    // The worst month decides: one month that does not tie makes the period
    // untied, however many others balanced.
    tieStatus: rows.some((r) => r.tieStatus !== 'tied') ? 'does_not_tie' : 'tied',
    inFlight: rows.some((r) => r.inFlight),
    monthsCovered: rows.length,
  };
}

export async function getMaturityLadder(asOf: IsoDate) {
  const [loans, ownership] = await Promise.all([
    prisma.loan.findMany({
      where: { status: 'active' },
      include: { payments: { orderBy: { date: 'asc' } }, property: true },
      orderBy: { maturityDate: 'asc' },
    }),
    getOwnershipContext(asOf),
  ]);

  const ladder = buildMaturityLadder(
    loans.map((loan) => ({
      id: loan.id,
      lender: loan.lender,
      type: loan.type,
      propertyName: loan.property.name,
      propertyId: loan.propertyId,
      structure: loan.structure,
      terms: toLoanTerms(loan),
      payments: loan.payments.map(toLoanPayment),
      guarantor: loan.personallyGuaranteed,
      sharePercent: ownership.shares.get(loan.propertyId) ?? 0,
    })),
    asOf,
  );

  const monthlyDebtService = loans.reduce(
    (total, loan) =>
      total + debtServiceForMonth(toLoanTerms(loan), asOf.slice(0, 7), loan.payments.map(toLoanPayment)),
    0,
  );

  return {
    ladder,
    monthlyDebtServiceCents: monthlyDebtService,
    totalBalanceCents: ladder.reduce((t, e) => t + e.balanceCents, 0),
    totalProRataCents: ladder.reduce((t, e) => t + e.proRataBalanceCents, 0),
    totalGuaranteedCents: ladder.reduce((t, e) => t + e.guaranteedExposureCents, 0),
    hasViewer: ownership.viewerId !== null,
  };
}

export async function getLoanDetail(loanId: string) {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: { payments: { orderBy: { date: 'asc' } }, property: true },
  });
  if (!loan) return null;
  return {
    loan,
    terms: toLoanTerms(loan),
    payments: loan.payments.map(toLoanPayment),
    // The stored rows keep their ids, which the engine's records deliberately
    // do not: an id is a fact about the database, not about the loan.
    records: loan.payments.map((payment) => ({
      id: payment.id,
      date: requireIsoDate(payment.date),
      totalCents: payment.totalCents,
      principalCents: payment.principalCents,
      interestCents: payment.interestCents,
      escrowCents: payment.escrowCents,
      extraPrincipalCents: payment.extraPrincipalCents,
      source: payment.source,
    })),
  };
}

export async function getPropertyDetail(propertyId: string, month: MonthKey) {
  const asOf = monthEnd(month);
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: {
      titleEntity: true,
      units: { orderBy: { label: 'asc' } },
      rooms: { orderBy: { label: 'asc' } },
      managementPeriods: { orderBy: { startDate: 'asc' } },
      leases: { orderBy: { startDate: 'desc' } },
      bankAccounts: { orderBy: { label: 'asc' } },
      valuations: { orderBy: { date: 'desc' } },
      loans: { include: { payments: true }, orderBy: { maturityDate: 'asc' } },
    },
  });
  if (!property) return null;

  const ownership = await getOwnershipContext(asOf);
  const interests = await prisma.ownershipInterest.findMany({
    where: { propertyId },
    include: { owner: true },
    orderBy: { startDate: 'asc' },
  });

  return {
    property,
    ownership,
    interests,
    periods: property.managementPeriods.map(toManagementPeriod),
    monthStart: monthStart(month),
    asOf,
    loans: property.loans.map((loan) => ({
      id: loan.id,
      lender: loan.lender,
      type: loan.type,
      structure: loan.structure,
      guarantor: loan.personallyGuaranteed,
      terms: toLoanTerms(loan),
      payments: loan.payments.map(toLoanPayment),
      balanceCents: balanceAtDate(toLoanTerms(loan), asOf, loan.payments.map(toLoanPayment)),
      debtServiceCents: debtServiceForMonth(toLoanTerms(loan), month, loan.payments.map(toLoanPayment)),
      maturityDate: maturityDateOf(toLoanTerms(loan)),
    })),
  };
}

export async function getSelectOptions() {
  const [entities, properties, accounts, loans, units] = await Promise.all([
    prisma.entity.findMany({ orderBy: { name: 'asc' } }),
    prisma.property.findMany({ orderBy: { name: 'asc' } }),
    prisma.bankAccount.findMany({ include: { property: true }, orderBy: { label: 'asc' } }),
    prisma.loan.findMany({ include: { property: true }, orderBy: { lender: 'asc' } }),
    prisma.unit.findMany({ include: { property: true }, orderBy: { label: 'asc' } }),
  ]);

  return {
    entities: entities.map((e) => ({ value: e.id, label: `${e.name}${e.isViewer ? ' (me)' : ''}` })),
    properties: properties.map((p) => ({ value: p.id, label: p.name })),
    accounts: accounts.map((a) => ({ value: a.id, label: `${a.property.name} · ${a.label}` })),
    loans: loans.map((l) => ({ value: l.id, label: `${l.property.name} · ${l.lender}` })),
    units: units.map((u) => ({ value: u.id, label: `${u.property.name} · ${u.label}` })),
  };
}

export { requireIsoDate };
