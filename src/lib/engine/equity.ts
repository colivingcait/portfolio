/**
 * Value and equity.
 *
 * Equity pro-rates (§3), so a share of it is meaningful in a way a share of
 * occupancy is not. But "your equity" is not simply your percentage of value
 * minus debt: an investor who put capital in is owed it back out of the
 * proceeds before profit is split. Ignoring that overstates what a sale would
 * actually put in your pocket, by exactly the amount you owe someone else.
 */

import { daysBetween, type IsoDate } from './dates';
import { roundCents, type Cents } from './money';

export type ValuationSource =
  | 'purchase'
  | 'appraisal'
  | 'broker_opinion'
  | 'avm'
  | 'owner_estimate'
  | 'contract'
  | 'sale';

export interface Valuation {
  id: string;
  propertyId: string;
  date: IsoDate;
  valueCents: Cents;
  source: ValuationSource;
}

/** How a source reads on screen. Defined once so two screens cannot disagree. */
export const SOURCE_LABELS: Record<ValuationSource, string> = {
  appraisal: 'Appraisal',
  broker_opinion: 'Broker opinion',
  contract: 'Under contract',
  sale: 'Sold',
  purchase: 'Purchase price',
  avm: 'Automated estimate',
  owner_estimate: 'Own estimate',
};

/** How much weight a source deserves, for the interface to say so plainly. */
export const SOURCE_CONFIDENCE: Record<ValuationSource, 'high' | 'medium' | 'low'> = {
  sale: 'high',
  contract: 'high',
  appraisal: 'high',
  broker_opinion: 'medium',
  purchase: 'medium',
  avm: 'low',
  owner_estimate: 'low',
};

/** The most recent estimate on or before a date. */
export function valuationAsOf(
  valuations: readonly Valuation[],
  propertyId: string,
  asOf: IsoDate,
): Valuation | null {
  const candidates = valuations
    .filter((v) => v.propertyId === propertyId && v.date <= asOf)
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0] ?? null;
}

/**
 * A value estimate goes off. An appraisal from two years ago is not evidence
 * about today, and a screen that shows it without saying so invites a decision
 * made on a stale number.
 */
export function valuationAge(valuation: Valuation | null, asOf: IsoDate): {
  days: number;
  stale: boolean;
} | null {
  if (!valuation) return null;
  const days = Math.max(0, daysBetween(valuation.date, asOf));
  return { days, stale: days > 365 };
}

export interface PropertyEquity {
  propertyId: string;
  valueCents: Cents;
  debtBalanceCents: Cents;
  /** Value less debt, at property level and undivided. */
  equityCents: Cents;
  /** Debt as a percentage of value. Null where there is no value to divide by. */
  ltvPercent: number | null;
  /** Your effective share of the equity, before anyone is repaid capital. */
  shareOfEquityCents: Cents;
  sharePercent: number;
}

export function propertyEquity(input: {
  propertyId: string;
  valueCents: Cents;
  debtBalanceCents: Cents;
  sharePercent: number;
}): PropertyEquity {
  const equity = input.valueCents - input.debtBalanceCents;
  return {
    propertyId: input.propertyId,
    valueCents: input.valueCents,
    debtBalanceCents: input.debtBalanceCents,
    equityCents: equity,
    ltvPercent: input.valueCents > 0 ? (input.debtBalanceCents / input.valueCents) * 100 : null,
    shareOfEquityCents: roundCents((equity * input.sharePercent) / 100),
    sharePercent: input.sharePercent,
  };
}

// ── What a sale would actually pay out ───────────────────────────────────────

export interface CapitalClaim {
  entityId: string;
  name: string;
  /** Still owed back, from the capital account. */
  outstandingCents: Cents;
}

export interface EquityOwner {
  entityId: string;
  name: string;
  sharePercent: number;
}

export interface WaterfallRow {
  entityId: string;
  name: string;
  /** Capital handed back first. Not profit. */
  capitalReturnedCents: Cents;
  /** Share of whatever is left after everyone's capital is repaid. */
  profitShareCents: Cents;
  totalCents: Cents;
}

export interface SaleWaterfall {
  valueCents: Cents;
  sellingCostsCents: Cents;
  debtBalanceCents: Cents;
  /** After costs and debt, before capital is repaid. */
  netProceedsCents: Cents;
  capitalOwedCents: Cents;
  /** What is left to split once capital is repaid. Negative means a shortfall. */
  distributableCents: Cents;
  rows: WaterfallRow[];
  /** True where proceeds do not even cover the capital owed. */
  capitalShortfall: boolean;
}

/**
 * Proceeds of a sale, in the order they are actually paid.
 *
 *   value − selling costs − debt = net proceeds
 *   net proceeds − capital repaid = what gets split
 *
 * Where proceeds do not cover the capital owed, capital is repaid pro rata to
 * what each investor is owed and nobody sees profit. The alternative — showing
 * a positive profit split while an investor is still short — would be a lie
 * about a decision that matters.
 */
export function saleWaterfall(input: {
  valueCents: Cents;
  debtBalanceCents: Cents;
  sellingCostsPercent?: number;
  capital: readonly CapitalClaim[];
  owners: readonly EquityOwner[];
}): SaleWaterfall {
  const sellingCosts = roundCents((input.valueCents * (input.sellingCostsPercent ?? 0)) / 100);
  const netProceeds = input.valueCents - sellingCosts - input.debtBalanceCents;
  const capitalOwed = input.capital.reduce((sum, claim) => sum + claim.outstandingCents, 0);
  const distributable = netProceeds - capitalOwed;

  const byEntity = new Map<string, WaterfallRow>();
  const row = (entityId: string, name: string) => {
    const existing = byEntity.get(entityId);
    if (existing) return existing;
    const created: WaterfallRow = {
      entityId,
      name,
      capitalReturnedCents: 0,
      profitShareCents: 0,
      totalCents: 0,
    };
    byEntity.set(entityId, created);
    return created;
  };

  const shortfall = capitalOwed > 0 && netProceeds < capitalOwed;

  for (const claim of input.capital) {
    const target = row(claim.entityId, claim.name);
    target.capitalReturnedCents = shortfall
      ? roundCents((Math.max(0, netProceeds) * claim.outstandingCents) / capitalOwed)
      : claim.outstandingCents;
  }

  if (distributable > 0) {
    const totalShare = input.owners.reduce((sum, owner) => sum + owner.sharePercent, 0);
    if (totalShare > 0) {
      for (const owner of input.owners) {
        row(owner.entityId, owner.name).profitShareCents = roundCents(
          (distributable * owner.sharePercent) / totalShare,
        );
      }
    }
  }

  for (const target of byEntity.values()) {
    target.totalCents = target.capitalReturnedCents + target.profitShareCents;
  }

  return {
    valueCents: input.valueCents,
    sellingCostsCents: sellingCosts,
    debtBalanceCents: input.debtBalanceCents,
    netProceedsCents: netProceeds,
    capitalOwedCents: capitalOwed,
    distributableCents: distributable,
    rows: [...byEntity.values()].sort((a, b) => b.totalCents - a.totalCents),
    capitalShortfall: shortfall,
  };
}

export interface EquityTotals {
  valueCents: Cents;
  debtBalanceCents: Cents;
  equityCents: Cents;
  shareOfEquityCents: Cents;
  ltvPercent: number | null;
  /** Properties with no estimate at all — the totals are missing these. */
  unvaluedCount: number;
  staleCount: number;
}

export function totalEquity(
  rows: readonly (PropertyEquity & { valued: boolean; stale: boolean })[],
): EquityTotals {
  const valued = rows.filter((r) => r.valued);
  const value = valued.reduce((sum, r) => sum + r.valueCents, 0);
  // Debt counts across everything: a property with no estimate still owes.
  const debt = rows.reduce((sum, r) => sum + r.debtBalanceCents, 0);

  return {
    valueCents: value,
    debtBalanceCents: debt,
    equityCents: value - debt,
    shareOfEquityCents: valued.reduce((sum, r) => sum + r.shareOfEquityCents, 0),
    ltvPercent: value > 0 ? (debt / value) * 100 : null,
    unvaluedCount: rows.length - valued.length,
    staleCount: rows.filter((r) => r.stale).length,
  };
}
