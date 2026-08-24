/**
 * How money moves (§5) and the PM fee (§9).
 *
 * One identity per (revenue source × management mode). The engine picks the
 * identity from the management period covering the earnings month; no branch
 * anywhere else in the codebase needs to know which era a month belongs to.
 */

import type { MonthKey } from './dates';
import type { ManagementPeriod } from './management';
import { managementForMonth } from './management';
import { pctOf, type Cents } from './money';

export type RevenueSource = 'padsplit' | 'direct';
export type UnitStructure = 'rooms' | 'units';

export const DEFAULT_PM_FEE_PERCENT = 10.5;

export type TieStatus = 'tied' | 'does_not_tie' | 'awaiting_pm_statement';

/**
 * PM fee (§9) — derived, never entered. 0.105 × gross_collected, per house per
 * month, and only for months covered by a PM-managed period.
 *
 * The basis is COLLECTED, not billed: delinquency reduces the fee and an
 * arrears catch-up month inflates it above 10.5% of that month's billings.
 */
export function pmFee(
  input: { grossCollectedCents: Cents; hostEarningsCents: Cents; netBilledCents: Cents },
  period: Pick<ManagementPeriod, 'mode' | 'feePercent' | 'feeBasis'> | null,
): Cents {
  if (!period || period.mode !== 'pm') return 0;
  const percent = period.feePercent ?? DEFAULT_PM_FEE_PERCENT;
  switch (period.feeBasis ?? 'gross_collected') {
    case 'host_earnings':
      return pctOf(input.hostEarningsCents, percent);
    case 'net_billed':
      return pctOf(input.netBilledCents, percent);
    case 'gross_collected':
    default:
      return pctOf(input.grossCollectedCents, percent);
  }
}

/**
 * The fee as a share of host earnings — the number that actually lands.
 * 10.5% of gross collected is roughly 12% of host earnings, because the fee is
 * charged on money PadSplit takes a cut of before you see it (§9).
 */
export function feeAsShareOfHostEarnings(feeCents: Cents, hostEarningsCents: Cents): number | null {
  if (hostEarningsCents === 0) return null;
  return (feeCents / hostEarningsCents) * 100;
}

export interface SelfManagedPadSplitResult {
  expectedDepositCents: Cents;
  actualDepositCents: Cents | null;
  differenceCents: Cents;
  status: TieStatus;
}

/**
 * Self-managed, PadSplit (§5): deposit_to_house = host_earnings.
 *
 * A free validation across the entire backfill — for any pre-August month,
 * host earnings and the actual deposit should match per house. Where they
 * don't, something is missing or misfiled.
 */
export function reconcileSelfManagedPadSplit(input: {
  hostEarningsCents: Cents;
  actualDepositCents: Cents | null;
  toleranceCents?: Cents;
}): SelfManagedPadSplitResult {
  const tolerance = input.toleranceCents ?? 0;
  if (input.actualDepositCents === null) {
    return {
      expectedDepositCents: input.hostEarningsCents,
      actualDepositCents: null,
      differenceCents: 0,
      status: 'does_not_tie',
    };
  }
  const difference = input.actualDepositCents - input.hostEarningsCents;
  return {
    expectedDepositCents: input.hostEarningsCents,
    actualDepositCents: input.actualDepositCents,
    differenceCents: difference,
    status: Math.abs(difference) <= tolerance ? 'tied' : 'does_not_tie',
  };
}

export interface PmPadSplitResult {
  hostEarningsCents: Cents;
  pmFeeCents: Cents;
  expectedDepositCents: Cents;
  actualDepositCents: Cents | null;
  /**
   * host_earnings − pm_fee − deposit. Posted as a single line, "PM opex
   * (underived)", until the PM statement importer exists — at which point it
   * is replaced by itemized detail without the identity changing.
   */
  pmPaidOpexUnderivedCents: Cents;
  status: TieStatus;
}

/**
 * PM-managed, PadSplit (§5), reduced form:
 *   deposit_to_house = host_earnings − pm_fee − pm_paid_opex
 *   pm_fee           = 0.105 × gross_collected
 *
 * With no PM statement yet, compute expected = host_earnings − fee, compare to
 * the deposit that landed, and post the difference as underived PM opex.
 */
export function reconcilePmPadSplitReduced(input: {
  hostEarningsCents: Cents;
  grossCollectedCents: Cents;
  netBilledCents?: Cents;
  actualDepositCents: Cents | null;
  period: Pick<ManagementPeriod, 'mode' | 'feePercent' | 'feeBasis'> | null;
  itemizedPmOpexCents?: Cents | null;
}): PmPadSplitResult {
  const fee = pmFee(
    {
      grossCollectedCents: input.grossCollectedCents,
      hostEarningsCents: input.hostEarningsCents,
      netBilledCents: input.netBilledCents ?? 0,
    },
    input.period,
  );
  const expected = input.hostEarningsCents - fee;

  if (input.actualDepositCents === null) {
    return {
      hostEarningsCents: input.hostEarningsCents,
      pmFeeCents: fee,
      expectedDepositCents: expected,
      actualDepositCents: null,
      pmPaidOpexUnderivedCents: 0,
      status: 'awaiting_pm_statement',
    };
  }

  const underived = expected - input.actualDepositCents;

  // Once itemized PM opex exists, the identity is unchanged — the residual
  // simply has to agree with the itemization.
  if (input.itemizedPmOpexCents !== null && input.itemizedPmOpexCents !== undefined) {
    const residual = underived - input.itemizedPmOpexCents;
    return {
      hostEarningsCents: input.hostEarningsCents,
      pmFeeCents: fee,
      expectedDepositCents: expected,
      actualDepositCents: input.actualDepositCents,
      pmPaidOpexUnderivedCents: residual,
      status: residual === 0 ? 'tied' : 'does_not_tie',
    };
  }

  return {
    hostEarningsCents: input.hostEarningsCents,
    pmFeeCents: fee,
    expectedDepositCents: expected,
    actualDepositCents: input.actualDepositCents,
    pmPaidOpexUnderivedCents: underived,
    // The reduced form always "ties" by construction — the residual absorbs
    // the difference. It is only a real tie once itemized detail agrees.
    status: 'awaiting_pm_statement',
  };
}

/**
 * Derived fee versus the fee the PM actually charged (§9).
 * Fee errors are quiet, and the check is free.
 */
export function checkChargedFee(
  derivedCents: Cents,
  chargedCents: Cents | null,
  toleranceCents = 0,
): { agrees: boolean; differenceCents: Cents } | null {
  if (chargedCents === null) return null;
  const difference = chargedCents - derivedCents;
  return { agrees: Math.abs(difference) <= toleranceCents, differenceCents: difference };
}

/**
 * Direct, self-managed (the duplex, §5):
 *   net_cash = Σ categorized income − Σ categorized expense − debt service
 */
export function reconcileDirect(input: {
  incomeCents: Cents;
  expenseCents: Cents;
  debtServiceCents: Cents;
}): { netCashCents: Cents } {
  return { netCashCents: input.incomeCents - input.expenseCents - input.debtServiceCents };
}

export interface MonthReconciliation {
  month: MonthKey;
  propertyId: string;
  revenueSource: RevenueSource;
  mode: 'self' | 'pm' | null;
  transitionMonth: boolean;
  pmFeeCents: Cents;
  expectedDepositCents: Cents;
  actualDepositCents: Cents | null;
  differenceCents: Cents;
  pmPaidOpexUnderivedCents: Cents;
  status: TieStatus;
}

/**
 * The single entry point: give it a property-month and it applies whichever
 * identity the management period calls for.
 */
export function reconcileMonth(input: {
  propertyId: string;
  month: MonthKey;
  revenueSource: RevenueSource;
  periods: readonly ManagementPeriod[];
  hostEarningsCents: Cents;
  grossCollectedCents: Cents;
  netBilledCents?: Cents;
  actualDepositCents: Cents | null;
  itemizedPmOpexCents?: Cents | null;
  /** Direct properties only. */
  incomeCents?: Cents;
  expenseCents?: Cents;
  debtServiceCents?: Cents;
}): MonthReconciliation {
  const management = managementForMonth(input.periods, input.propertyId, input.month);
  const mode = management.effective?.mode ?? null;

  if (input.revenueSource === 'direct') {
    // No platform and no manager: rent lands in the property's account and is
    // categorized on import. Nothing to tie against a remittance.
    const income = input.incomeCents ?? 0;
    return {
      month: input.month,
      propertyId: input.propertyId,
      revenueSource: 'direct',
      mode,
      transitionMonth: management.transition,
      pmFeeCents: 0,
      expectedDepositCents: income,
      actualDepositCents: income,
      differenceCents: 0,
      pmPaidOpexUnderivedCents: 0,
      status: 'tied',
    };
  }

  if (mode === 'pm') {
    const r = reconcilePmPadSplitReduced({
      hostEarningsCents: input.hostEarningsCents,
      grossCollectedCents: input.grossCollectedCents,
      netBilledCents: input.netBilledCents,
      actualDepositCents: input.actualDepositCents,
      period: management.effective,
      itemizedPmOpexCents: input.itemizedPmOpexCents ?? null,
    });
    return {
      month: input.month,
      propertyId: input.propertyId,
      revenueSource: 'padsplit',
      mode,
      transitionMonth: management.transition,
      pmFeeCents: r.pmFeeCents,
      expectedDepositCents: r.expectedDepositCents,
      actualDepositCents: r.actualDepositCents,
      differenceCents: (r.actualDepositCents ?? 0) - r.expectedDepositCents,
      pmPaidOpexUnderivedCents: r.pmPaidOpexUnderivedCents,
      status: r.status,
    };
  }

  const r = reconcileSelfManagedPadSplit({
    hostEarningsCents: input.hostEarningsCents,
    actualDepositCents: input.actualDepositCents,
  });
  return {
    month: input.month,
    propertyId: input.propertyId,
    revenueSource: 'padsplit',
    mode,
    transitionMonth: management.transition,
    pmFeeCents: 0,
    expectedDepositCents: r.expectedDepositCents,
    actualDepositCents: r.actualDepositCents,
    differenceCents: r.differenceCents,
    pmPaidOpexUnderivedCents: 0,
    status: r.status,
  };
}
