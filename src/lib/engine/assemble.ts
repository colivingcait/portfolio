/**
 * Assembling a property-month rollup from its parts.
 *
 * Pure: bank totals, loan figures and (later) PadSplit figures in, one
 * PropertyRollup out. Materialising these is what makes the portfolio screen
 * a read rather than a recomputation (§11).
 */

import type { MonthKey } from './dates';
import type { PeriodTotals } from './bank';
import { isExpense, isIncome, type CategoryCatalog } from './categories';
import type { Cents } from './money';
import type { PropertyRollup } from './rollup';

/**
 * Income categories that are cash arriving rather than revenue earned.
 *
 * A PadSplit deposit is the remittance of revenue the platform already
 * recognised, and a PM disbursement is what survived the manager's netting.
 * Counting either as revenue would double-count once the PadSplit import
 * lands, and would overstate a PM month by the fee and the opex the manager
 * already deducted.
 */
export const REMITTANCE_CATEGORIES = ['padsplit_deposit', 'pm_disbursement'] as const;

const REMITTANCE_SET: ReadonlySet<string> = new Set(REMITTANCE_CATEGORIES);

export interface BankDerived {
  /** Earned at property level, from categorized deposits. Direct properties only. */
  revenueCents: Cents;
  /** Remittances: money arriving that was earned elsewhere in the chain. */
  depositReceivedCents: Cents;
  /** Operating costs paid from the property's own account, debt service excluded. */
  ownerPaidOpexCents: Cents;
  /** Debt service as it appears on the statement, for cross-checking the schedule. */
  categorizedDebtServiceCents: Cents;
  /** Change in tenant deposits held. A liability, never revenue. */
  depositsHeldDeltaCents: Cents;
}

/**
 * Split the bank period into the buckets a rollup needs.
 *
 * Debt service is pulled out of opex because the amortization schedule is
 * authoritative for it: the bank shows one number, the schedule explains it
 * as principal and interest (§8).
 */
export function deriveFromBank(totals: PeriodTotals, catalog?: CategoryCatalog): BankDerived {
  let revenue = 0;
  let deposits = 0;
  let opex = 0;
  let categorizedDebtService = 0;

  for (const [categoryKey, amountCents] of Object.entries(totals.byCategory)) {
    if (categoryKey === 'uncategorized') continue;

    if (isIncome(categoryKey, catalog)) {
      if (REMITTANCE_SET.has(categoryKey)) deposits += amountCents;
      else revenue += amountCents;
      continue;
    }

    if (isExpense(categoryKey, catalog)) {
      // Expenses arrive as negative amounts; opex is carried positive.
      if (categoryKey === 'debt_service') categorizedDebtService += -amountCents;
      else opex += -amountCents;
    }
  }

  return {
    revenueCents: revenue,
    depositReceivedCents: deposits,
    ownerPaidOpexCents: opex,
    categorizedDebtServiceCents: categorizedDebtService,
    depositsHeldDeltaCents: totals.depositsHeldDeltaCents,
  };
}

export interface AssembleInput {
  propertyId: string;
  month: MonthKey;
  entityId: string;
  bank: BankDerived;
  /** From the amortization schedules — authoritative over the statement. */
  debtServiceCents: Cents;
  debtBalanceCents: Cents;
  roomsTotal: number;
  /** From the PadSplit import, once it exists. */
  padsplit?: {
    hostEarningsCents: Cents;
    pmFeeCents: Cents;
    pmPaidOpexCents: Cents;
    roomsOccupied: number;
    occupancyRate: number | null;
    collectionRate: number | null;
    delinquencyCents: Cents;
    trueRoomRateCents: Cents | null;
  } | null;
}

/**
 * One property-month, at 100% and property level. The view multiplier is
 * applied at read time and never stored (§3).
 */
export function assemblePropertyRollup(input: AssembleInput): PropertyRollup {
  const padsplit = input.padsplit ?? null;

  // A PadSplit house earns what the platform says it earned; a direct property
  // earns what was categorized as income on its own statement.
  const revenueCents = padsplit ? padsplit.hostEarningsCents : input.bank.revenueCents;
  const pmFeeCents = padsplit ? padsplit.pmFeeCents : 0;
  const pmPaidOpexCents = padsplit ? padsplit.pmPaidOpexCents : 0;

  const operatingExpenseCents = input.bank.ownerPaidOpexCents + pmPaidOpexCents + pmFeeCents;
  const noiCents = revenueCents - operatingExpenseCents;

  // Net cash is what left the property's own account: money the PM never
  // remitted was never in it, so only owner-paid costs and debt service apply.
  const netCashCents =
    (padsplit ? input.bank.depositReceivedCents : revenueCents) -
    input.bank.ownerPaidOpexCents -
    input.debtServiceCents;

  return {
    propertyId: input.propertyId,
    month: input.month,
    entityId: input.entityId,

    revenueCents,
    hostEarningsCents: padsplit ? padsplit.hostEarningsCents : 0,
    pmFeeCents,
    ownerPaidOpexCents: input.bank.ownerPaidOpexCents,
    pmPaidOpexCents,
    operatingExpenseCents,
    noiCents,
    depositReceivedCents: input.bank.depositReceivedCents,
    debtServiceCents: input.debtServiceCents,
    debtBalanceCents: input.debtBalanceCents,
    netCashCents,

    roomsTotal: input.roomsTotal,
    roomsOccupied: padsplit?.roomsOccupied ?? 0,
    occupancyRate: padsplit?.occupancyRate ?? null,
    collectionRate: padsplit?.collectionRate ?? null,
    delinquencyCents: padsplit?.delinquencyCents ?? 0,
    trueRoomRateCents: padsplit?.trueRoomRateCents ?? null,
  };
}

/**
 * Does the debt service on the statement agree with the schedule?
 * A disagreement usually means a payment landed late or an extra principal
 * payment was not recorded — worth surfacing, not worth blocking on.
 */
export function debtServiceDisagreement(
  scheduleCents: Cents,
  categorizedCents: Cents,
): { agrees: boolean; differenceCents: Cents } | null {
  if (categorizedCents === 0) return null; // nothing categorized as debt service
  const difference = categorizedCents - scheduleCents;
  return { agrees: difference === 0, differenceCents: difference };
}
