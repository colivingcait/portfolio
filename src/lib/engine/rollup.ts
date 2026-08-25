/**
 * The rollup engine and view selector (§3, §10).
 *
 * "These are the same numbers with a different multiplier and a different
 * filter. Build one rollup engine and expose a view selector — do not build
 * five reports."
 */

import type { MonthKey } from './dates';
import { roundCents, type Cents } from './money';

export type ViewKind = 'portfolio' | 'my_share' | 'entity' | 'property' | 'partner';

export interface ViewSpec {
  kind: ViewKind;
  /** For 'my_share', 'entity' and 'partner': whose share to apply. */
  viewerEntityId?: string | null;
  /** For 'entity': restrict to what that entity owns. */
  entityId?: string | null;
  /** For 'property'. */
  propertyId?: string | null;
  /** Cash figures may follow a distribution split rather than equity (§3). */
  basis?: 'equity' | 'distribution';
}

/**
 * Pro-rate: revenue, operating expenses, NOI, net cash, debt balance, equity.
 */
export const PRORATABLE_METRICS = [
  'revenueCents',
  'hostEarningsCents',
  'platformFeesCents',
  'pmFeeCents',
  'operatingExpenseCents',
  'ownerPaidOpexCents',
  'pmPaidOpexCents',
  'noiCents',
  'netCashCents',
  'depositReceivedCents',
  'expectedDepositCents',
  'depositVarianceCents',
  'debtServiceCents',
  'debtBalanceCents',
  'equityCents',
  'principalCents',
  'interestCents',
] as const;

/**
 * Do NOT pro-rate: occupancy, collection rate, delinquency, true room rate.
 *
 * These describe how a property is performing, not how it is split. Twenty-five
 * percent of an occupancy rate is meaningless, and a view that silently
 * multiplies it will quietly corrupt every operational judgment made from the
 * dashboard (§3).
 */
export const NON_PRORATABLE_METRICS = [
  'occupancyRate',
  'collectionRate',
  'delinquencyCents',
  'trueRoomRateCents',
  'roomsTotal',
  'roomsOccupied',
] as const;

export type ProratableMetric = (typeof PRORATABLE_METRICS)[number];
export type NonProratableMetric = (typeof NON_PRORATABLE_METRICS)[number];

const PRORATABLE_SET: ReadonlySet<string> = new Set(PRORATABLE_METRICS);
const NON_PRORATABLE_SET: ReadonlySet<string> = new Set(NON_PRORATABLE_METRICS);

export function isProratable(metric: string): boolean {
  return PRORATABLE_SET.has(metric);
}

export function isNonProratable(metric: string): boolean {
  return NON_PRORATABLE_SET.has(metric);
}

export interface PropertyRollup {
  propertyId: string;
  month: MonthKey;
  entityId: string;

  // Proratable — money
  revenueCents: Cents;
  hostEarningsCents: Cents;
  /** What the platform kept out of the rent it collected. A cost. */
  platformFeesCents: Cents;
  pmFeeCents: Cents;
  ownerPaidOpexCents: Cents;
  pmPaidOpexCents: Cents;
  operatingExpenseCents: Cents;
  noiCents: Cents;
  depositReceivedCents: Cents;
  /** What the platform says will land. Defined whether or not a statement is in. */
  expectedDepositCents: Cents;
  /** Actual less expected. Non-zero means the deposit was short, late or wrong. */
  depositVarianceCents: Cents;
  debtServiceCents: Cents;
  debtBalanceCents: Cents;
  netCashCents: Cents;

  // Non-proratable — operational
  roomsTotal: number;
  roomsOccupied: number;
  occupancyRate: number | null;
  collectionRate: number | null;
  delinquencyCents: Cents;
  trueRoomRateCents: Cents | null;
}

export interface ViewedRollup extends PropertyRollup {
  /** The multiplier applied to money on this row, as a percentage. */
  sharePercent: number;
  /**
   * True where the operational figures on this row are property-level and
   * undivided even though the money is not. The UI must say so.
   */
  operationalFiguresAreUndivided: boolean;
}

/**
 * Apply a view's multiplier to one rollup.
 *
 * Money scales. Occupancy, collection rate, delinquency and true room rate do
 * not — they pass through untouched, and the row is flagged so the UI can
 * label them as property-level.
 */
export function applyShare(rollup: PropertyRollup, sharePercent: number): ViewedRollup {
  const scale = (v: Cents) => roundCents((v * sharePercent) / 100);
  return {
    ...rollup,
    revenueCents: scale(rollup.revenueCents),
    hostEarningsCents: scale(rollup.hostEarningsCents),
    pmFeeCents: scale(rollup.pmFeeCents),
    ownerPaidOpexCents: scale(rollup.ownerPaidOpexCents),
    pmPaidOpexCents: scale(rollup.pmPaidOpexCents),
    operatingExpenseCents: scale(rollup.operatingExpenseCents),
    noiCents: scale(rollup.noiCents),
    depositReceivedCents: scale(rollup.depositReceivedCents),
    debtServiceCents: scale(rollup.debtServiceCents),
    debtBalanceCents: scale(rollup.debtBalanceCents),
    netCashCents: scale(rollup.netCashCents),

    // Untouched, deliberately.
    roomsTotal: rollup.roomsTotal,
    roomsOccupied: rollup.roomsOccupied,
    occupancyRate: rollup.occupancyRate,
    collectionRate: rollup.collectionRate,
    delinquencyCents: rollup.delinquencyCents,
    trueRoomRateCents: rollup.trueRoomRateCents,

    sharePercent,
    operationalFiguresAreUndivided: sharePercent !== 100,
  };
}

export interface PortfolioTotals {
  revenueCents: Cents;
  hostEarningsCents: Cents;
  pmFeeCents: Cents;
  operatingExpenseCents: Cents;
  ownerPaidOpexCents: Cents;
  pmPaidOpexCents: Cents;
  noiCents: Cents;
  depositReceivedCents: Cents;
  debtServiceCents: Cents;
  debtBalanceCents: Cents;
  netCashCents: Cents;
  roomsTotal: number;
  roomsOccupied: number;
  /** Weighted by rooms, never averaged across pro-rated money. */
  occupancyRate: number | null;
  /** Entity ids represented. More than one means the total crosses entities. */
  entityIds: string[];
  crossesEntities: boolean;
}

/**
 * Portfolio totals. Occupancy is recomputed from room counts rather than
 * averaged — an average of rates weights a 6-room house like an 8-room one.
 *
 * Consolidated totals must state that they cross entities (§2).
 */
export function totalRollups(rows: readonly ViewedRollup[]): PortfolioTotals {
  const sum = (pick: (r: ViewedRollup) => Cents) => rows.reduce((a, r) => a + pick(r), 0);
  const roomsTotal = rows.reduce((a, r) => a + r.roomsTotal, 0);
  const roomsOccupied = rows.reduce((a, r) => a + r.roomsOccupied, 0);
  const entityIds = [...new Set(rows.map((r) => r.entityId))].sort();

  return {
    revenueCents: sum((r) => r.revenueCents),
    hostEarningsCents: sum((r) => r.hostEarningsCents),
    pmFeeCents: sum((r) => r.pmFeeCents),
    operatingExpenseCents: sum((r) => r.operatingExpenseCents),
    ownerPaidOpexCents: sum((r) => r.ownerPaidOpexCents),
    pmPaidOpexCents: sum((r) => r.pmPaidOpexCents),
    noiCents: sum((r) => r.noiCents),
    depositReceivedCents: sum((r) => r.depositReceivedCents),
    debtServiceCents: sum((r) => r.debtServiceCents),
    debtBalanceCents: sum((r) => r.debtBalanceCents),
    netCashCents: sum((r) => r.netCashCents),
    roomsTotal,
    roomsOccupied,
    occupancyRate: roomsTotal > 0 ? (roomsOccupied / roomsTotal) * 100 : null,
    entityIds,
    crossesEntities: entityIds.length > 1,
  };
}

export interface ViewInput {
  rollups: readonly PropertyRollup[];
  /** propertyId -> effective share percent for the viewer. */
  shares: ReadonlyMap<string, number>;
  /** propertyId -> the entity holding title, for the entity filter. */
  view: ViewSpec;
}

/**
 * One engine, five views. Each view is a filter and a multiplier — nothing
 * else differs.
 */
export function buildView({ rollups, shares, view }: ViewInput): {
  rows: ViewedRollup[];
  totals: PortfolioTotals;
} {
  let filtered = [...rollups];

  if (view.kind === 'property' && view.propertyId) {
    filtered = filtered.filter((r) => r.propertyId === view.propertyId);
  }
  if (view.kind === 'entity' && view.entityId) {
    filtered = filtered.filter(
      (r) => r.entityId === view.entityId || (shares.get(r.propertyId) ?? 0) > 0,
    );
  }
  if (view.kind === 'partner' || view.kind === 'my_share') {
    filtered = filtered.filter((r) => (shares.get(r.propertyId) ?? 0) > 0);
  }

  const rows = filtered.map((r) => {
    // Portfolio and property views are undivided, at 100%.
    const sharePercent =
      view.kind === 'portfolio' || view.kind === 'property' ? 100 : (shares.get(r.propertyId) ?? 0);
    return applyShare(r, sharePercent);
  });

  return { rows, totals: totalRollups(rows) };
}

export const VIEW_LABELS: Record<ViewKind, { label: string; description: string }> = {
  portfolio: { label: 'Portfolio', description: 'Every property at 100%, property level.' },
  my_share: { label: 'My share', description: 'Effective percentages applied.' },
  entity: { label: 'Entity', description: 'Everything a given entity owns, at that entity’s level.' },
  property: { label: 'Property', description: 'One property, undivided.' },
  partner: { label: 'Partner', description: 'A co-owner’s share across everything they hold with you.' },
};
