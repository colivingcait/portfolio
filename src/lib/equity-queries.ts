import 'server-only';
import { prisma } from './db';
import { toLoanPayment, toLoanTerms, toOwnershipInterest, requireIsoDate } from './mappers';
import { balanceAtDate } from './engine/amortization';
import { effectiveShare } from './engine/ownership';
import { capitalPositions, type CapitalEntry } from './engine/payouts';
import {
  propertyEquity,
  saleWaterfall,
  totalEquity,
  valuationAge,
  valuationAsOf,
  type SaleWaterfall,
  type Valuation,
  type ValuationSource,
} from './engine/equity';
import type { IsoDate } from './engine/dates';

export interface EquityRow {
  propertyId: string;
  propertyName: string;
  entityName: string;
  valued: boolean;
  valuationDate: IsoDate | null;
  valuationSource: ValuationSource | null;
  stale: boolean;
  ageDays: number | null;
  valueCents: number;
  debtBalanceCents: number;
  equityCents: number;
  ltvPercent: number | null;
  sharePercent: number;
  shareOfEquityCents: number;
  waterfall: SaleWaterfall;
  hasCapital: boolean;
}

export async function getEquity(asOf: IsoDate, sellingCostsPercent = 0) {
  const [properties, valuationRows, loans, interests, entities, capitalRows] = await Promise.all([
    prisma.property.findMany({ include: { titleEntity: true }, orderBy: { name: 'asc' } }),
    prisma.valuation.findMany(),
    prisma.loan.findMany({ where: { status: 'active' }, include: { payments: true } }),
    prisma.ownershipInterest.findMany(),
    prisma.entity.findMany(),
    prisma.capitalAccountEntry.findMany(),
  ]);

  const valuations: Valuation[] = valuationRows.map((v) => ({
    id: v.id,
    propertyId: v.propertyId,
    date: requireIsoDate(v.date),
    valueCents: v.valueCents,
    source: v.source as ValuationSource,
  }));

  const engineInterests = interests.map(toOwnershipInterest);
  const viewer = entities.find((e) => e.isViewer);
  const entityNames = new Map(entities.map((e) => [e.id, e.name]));

  const capitalEntries: CapitalEntry[] = capitalRows.map((entry) => ({
    entityId: entry.entityId,
    propertyId: entry.propertyId,
    kind: entry.kind,
    date: requireIsoDate(entry.date),
    amountCents: entry.amountCents,
  }));

  const rows: EquityRow[] = properties.map((property) => {
    const valuation = valuationAsOf(valuations, property.id, asOf);
    const age = valuationAge(valuation, asOf);

    const debtBalanceCents = loans
      .filter((loan) => loan.propertyId === property.id)
      .reduce(
        (sum, loan) => sum + balanceAtDate(toLoanTerms(loan), asOf, loan.payments.map(toLoanPayment)),
        0,
      );

    const sharePercent = viewer
      ? effectiveShare(engineInterests, viewer.id, property.id, asOf, 'equity').percent
      : 0;

    const equity = propertyEquity({
      propertyId: property.id,
      valueCents: valuation?.valueCents ?? 0,
      debtBalanceCents,
      sharePercent,
    });

    // Everyone with an interest shares the proceeds; everyone with capital
    // outstanding is repaid out of them first.
    const owners = entities
      .map((entity) => ({
        entityId: entity.id,
        name: entity.name,
        sharePercent: effectiveShare(engineInterests, entity.id, property.id, asOf, 'equity').percent,
      }))
      .filter((owner) => owner.sharePercent > 0);

    const capital = capitalPositions(capitalEntries, property.id)
      .filter((position) => position.outstandingCents > 0)
      .map((position) => ({
        entityId: position.entityId,
        name: entityNames.get(position.entityId) ?? 'Unknown',
        outstandingCents: position.outstandingCents,
      }));

    return {
      propertyName: property.name,
      entityName: property.titleEntity.name,
      valued: valuation !== null,
      valuationDate: valuation?.date ?? null,
      valuationSource: valuation?.source ?? null,
      stale: age?.stale ?? false,
      ageDays: age?.days ?? null,
      ...equity,
      propertyId: property.id,
      hasCapital: capital.length > 0,
      waterfall: saleWaterfall({
        valueCents: valuation?.valueCents ?? 0,
        debtBalanceCents,
        sellingCostsPercent,
        capital,
        owners,
      }),
    };
  });

  return {
    rows,
    totals: totalEquity(rows),
    hasViewer: Boolean(viewer),
    sellingCostsPercent,
  };
}
