import 'server-only';
import { prisma } from './db';
import { toLoanPayment, toLoanTerms, toOwnershipInterest, requireIsoDate } from './mappers';
import { buildSchedule } from './engine/amortization';
import { effectiveShare } from './engine/ownership';
import {
  capitalPositions,
  paymentsDueIn,
  payoutTotals,
  planDistribution,
  type CapitalEntry,
  type DuePayment,
  type OwnerShare,
} from './engine/payouts';
import { monthEnd, type MonthKey } from './engine/dates';

export interface PropertyPayout {
  propertyId: string;
  propertyName: string;
  netCashCents: number;
  hasRollup: boolean;
  owners: (OwnerShare & { amountCents: number; alreadyPaidCents: number })[];
  distributableCents: number;
}

export interface PayoutsData {
  month: MonthKey;
  properties: PropertyPayout[];
  due: DuePayment[];
  totals: ReturnType<typeof payoutTotals>;
  capital: {
    entityId: string;
    entityName: string;
    propertyName: string | null;
    contributedCents: number;
    profitDistributedCents: number;
    returnedCents: number;
    outstandingCents: number;
  }[];
  entities: { value: string; label: string }[];
  properties_: { value: string; label: string }[];
}

export async function getPayouts(month: MonthKey): Promise<PayoutsData> {
  const asOf = monthEnd(month);

  const [properties, interests, entities, loans, rollups, capitalEntries] = await Promise.all([
    prisma.property.findMany({ orderBy: { name: 'asc' } }),
    prisma.ownershipInterest.findMany(),
    prisma.entity.findMany({ orderBy: { name: 'asc' } }),
    prisma.loan.findMany({
      where: { status: 'active' },
      include: { property: true, payments: true },
      orderBy: { maturityDate: 'asc' },
    }),
    prisma.monthlyPropertyRollup.findMany({ where: { month, basis: 'cash' } }),
    prisma.capitalAccountEntry.findMany({ include: { entity: true, property: true } }),
  ]);

  const engineInterests = interests.map(toOwnershipInterest);
  const entityNames = new Map(entities.map((e) => [e.id, e.name]));
  const rollupByProperty = new Map(rollups.map((r) => [r.propertyId, r]));

  // Distributions follow the cash split, which may differ from equity (§3).
  const payoutProperties: PropertyPayout[] = properties.map((property) => {
    const owners: OwnerShare[] = entities
      .map((entity) => ({
        entityId: entity.id,
        name: entity.name,
        sharePercent: effectiveShare(engineInterests, entity.id, property.id, asOf, 'distribution').percent,
      }))
      .filter((owner) => owner.sharePercent > 0);

    const rollup = rollupByProperty.get(property.id);
    const netCashCents = rollup?.netCashCents ?? 0;

    const plan = planDistribution({
      month,
      propertyId: property.id,
      netCashCents,
      owners,
    });

    const paidThisMonth = capitalEntries.filter(
      (e) => e.propertyId === property.id && e.kind === 'distribution' && e.month === month,
    );

    return {
      propertyId: property.id,
      propertyName: property.name,
      netCashCents,
      hasRollup: Boolean(rollup),
      distributableCents: plan.distributableCents,
      owners: plan.allocations.map((allocation) => ({
        ...allocation,
        alreadyPaidCents: paidThisMonth
          .filter((e) => e.entityId === allocation.entityId)
          .reduce((sum, e) => sum + e.amountCents, 0),
      })),
    };
  });

  const due = paymentsDueIn(
    month,
    loans.map((loan) => ({
      loanId: loan.id,
      lender: loan.lender,
      propertyId: loan.propertyId,
      propertyName: loan.property.name,
      loanType: loan.type,
      schedule: buildSchedule(toLoanTerms(loan), loan.payments.map(toLoanPayment)),
      actualPaymentDates: loan.payments.filter((p) => p.source === 'actual').map((p) => requireIsoDate(p.date)),
    })),
  );

  const allAllocations = payoutProperties.flatMap((p) => p.owners);

  const entries: CapitalEntry[] = capitalEntries.map((entry) => ({
    entityId: entry.entityId,
    propertyId: entry.propertyId,
    kind: entry.kind,
    date: requireIsoDate(entry.date),
    amountCents: entry.amountCents,
  }));

  // One position per investor per property, since capital is committed to a
  // property rather than to the portfolio in general.
  const scopes = [...new Set(entries.map((e) => e.propertyId ?? 'portfolio'))];
  const capital = scopes.flatMap((scope) => {
    const propertyId = scope === 'portfolio' ? null : scope;
    const positions = capitalPositions(entries, propertyId);
    const propertyName = propertyId ? (properties.find((p) => p.id === propertyId)?.name ?? null) : null;
    return positions.map((position) => ({
      ...position,
      entityName: entityNames.get(position.entityId) ?? 'Unknown',
      propertyName,
    }));
  });

  return {
    month,
    properties: payoutProperties,
    due,
    totals: payoutTotals(due, allAllocations),
    capital: capital.filter((c) => c.contributedCents !== 0 || c.profitDistributedCents !== 0),
    entities: entities.map((e) => ({ value: e.id, label: e.name })),
    properties_: properties.map((p) => ({ value: p.id, label: p.name })),
  };
}
