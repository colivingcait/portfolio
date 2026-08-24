/**
 * Payouts: what leaves the business each month, and to whom.
 *
 * Two unrelated obligations land in the same month and are easy to conflate:
 *
 *   Lenders are owed INTEREST on money lent, at a rate, on a schedule, whether
 *   or not the property made anything.
 *
 *   Investors are owed a SHARE OF PROFIT — nothing if there was no profit —
 *   plus their capital back when the property is sold.
 *
 * A partner who puts in $120,000 for half the profits is the second kind. It
 * is not a loan: it accrues no interest, appears in no maturity ladder, and
 * its balance is reduced only by handing capital back, never by paying profit.
 */

import type { IsoDate, MonthKey } from './dates';
import { monthOf } from './dates';
import { roundCents, sumCents, type Cents } from './money';

// ── Owner distributions ──────────────────────────────────────────────────────

export interface OwnerShare {
  entityId: string;
  name: string;
  /** Whole-number percentage of distributable cash. */
  sharePercent: number;
}

export interface OwnerAllocation extends OwnerShare {
  amountCents: Cents;
}

/**
 * Split an amount across owners so the parts sum to the whole, exactly.
 *
 * Rounding each share independently loses or gains cents: three ways of a
 * penny is the obvious case, but 50/50 of an odd amount is the one that turns
 * up monthly. The remainder goes to the largest fractional parts, so the total
 * paid out always equals the total distributed.
 */
export function allocate(amountCents: Cents, owners: readonly OwnerShare[]): OwnerAllocation[] {
  if (owners.length === 0) return [];

  const totalPercent = owners.reduce((sum, o) => sum + o.sharePercent, 0);
  if (totalPercent === 0) return owners.map((o) => ({ ...o, amountCents: 0 }));

  const exact = owners.map((owner) => (amountCents * owner.sharePercent) / totalPercent);
  const floored = exact.map((value) => (value < 0 ? Math.ceil(value) : Math.floor(value)));
  let remainder = amountCents - floored.reduce((a, b) => a + b, 0);

  // Hand the leftover cents to whoever was rounded down hardest.
  const order = exact
    .map((value, index) => ({ index, fraction: Math.abs(value - floored[index]) }))
    .sort((a, b) => b.fraction - a.fraction);

  const amounts = [...floored];
  const step = remainder < 0 ? -1 : 1;
  for (let i = 0; remainder !== 0 && i < order.length * 2; i++) {
    amounts[order[i % order.length].index] += step;
    remainder -= step;
  }

  return owners.map((owner, index) => ({ ...owner, amountCents: amounts[index] }));
}

export interface DistributionPlan {
  month: MonthKey;
  propertyId: string;
  /** Net cash the property generated — the ceiling on what can be paid out. */
  netCashCents: Cents;
  /** What is actually being distributed, after any reserve held back. */
  distributableCents: Cents;
  reserveCents: Cents;
  allocations: OwnerAllocation[];
  /** Nothing to split, and nobody is owed anything for a loss-making month. */
  nothingToDistribute: boolean;
}

/**
 * What each owner is owed for a month.
 *
 * A negative month distributes nothing: a loss is not a call on the partners
 * unless the operating agreement says so, and this tool should not invent that.
 */
export function planDistribution(input: {
  month: MonthKey;
  propertyId: string;
  netCashCents: Cents;
  owners: readonly OwnerShare[];
  /** Held back rather than paid out. Defaults to nothing. */
  reserveCents?: Cents;
  /** Overrides net cash where the amount to pay is decided by hand. */
  overrideDistributableCents?: Cents | null;
}): DistributionPlan {
  const reserve = Math.max(0, input.reserveCents ?? 0);
  const fromCash = Math.max(0, input.netCashCents - reserve);
  const distributable =
    input.overrideDistributableCents !== null && input.overrideDistributableCents !== undefined
      ? Math.max(0, input.overrideDistributableCents)
      : fromCash;

  return {
    month: input.month,
    propertyId: input.propertyId,
    netCashCents: input.netCashCents,
    distributableCents: distributable,
    reserveCents: reserve,
    allocations: allocate(distributable, input.owners),
    nothingToDistribute: distributable === 0,
  };
}

// ── Capital accounts ─────────────────────────────────────────────────────────

export type CapitalEntryKind = 'contribution' | 'distribution' | 'return_of_capital';

export interface CapitalEntry {
  entityId: string;
  propertyId: string | null;
  kind: CapitalEntryKind;
  date: IsoDate;
  amountCents: Cents;
}

export interface CapitalPosition {
  entityId: string;
  contributedCents: Cents;
  /** Profit paid out. Does NOT reduce what is owed back. */
  profitDistributedCents: Cents;
  returnedCents: Cents;
  /** Still owed back on sale. */
  outstandingCents: Cents;
}

/**
 * Where each investor stands.
 *
 * Profit distributions deliberately do not reduce the outstanding balance: a
 * partner who put in $120,000 and has been paid $30,000 of profit is still
 * owed the full $120,000 when the property sells. Netting the two would quietly
 * write off the obligation.
 */
export function capitalPositions(
  entries: readonly CapitalEntry[],
  propertyId?: string | null,
): CapitalPosition[] {
  const scoped = propertyId ? entries.filter((e) => e.propertyId === propertyId) : entries;
  const byEntity = new Map<string, CapitalPosition>();

  for (const entry of scoped) {
    const position = byEntity.get(entry.entityId) ?? {
      entityId: entry.entityId,
      contributedCents: 0,
      profitDistributedCents: 0,
      returnedCents: 0,
      outstandingCents: 0,
    };

    if (entry.kind === 'contribution') position.contributedCents += entry.amountCents;
    else if (entry.kind === 'return_of_capital') position.returnedCents += entry.amountCents;
    else position.profitDistributedCents += entry.amountCents;

    position.outstandingCents = position.contributedCents - position.returnedCents;
    byEntity.set(entry.entityId, position);
  }

  return [...byEntity.values()];
}

// ── Debt payments due ────────────────────────────────────────────────────────

export interface DuePayment {
  loanId: string;
  lender: string;
  propertyId: string;
  propertyName: string;
  loanType: string;
  dueDate: IsoDate;
  interestCents: Cents;
  principalCents: Cents;
  escrowCents: Cents;
  totalCents: Cents;
  /** True where a payment has already been recorded for this period. */
  paid: boolean;
  paidAmountCents: Cents | null;
}

/**
 * Payments falling due in a month.
 *
 * A quarterly note appears in the three months it is due and in none of the
 * other nine, which is the point of carrying a frequency at all.
 */
export function paymentsDueIn(
  month: MonthKey,
  loans: readonly {
    loanId: string;
    lender: string;
    propertyId: string;
    propertyName: string;
    loanType: string;
    schedule: readonly {
      dueDate: IsoDate;
      interestCents: Cents;
      principalCents: Cents;
      escrowCents: Cents;
      paymentCents: Cents;
      actual: boolean;
    }[];
    actualPaymentDates?: readonly IsoDate[];
  }[],
): DuePayment[] {
  const due: DuePayment[] = [];

  for (const loan of loans) {
    for (const row of loan.schedule) {
      if (monthOf(row.dueDate) !== month) continue;
      const paidInMonth = (loan.actualPaymentDates ?? []).filter((d) => monthOf(d) === month);
      due.push({
        loanId: loan.loanId,
        lender: loan.lender,
        propertyId: loan.propertyId,
        propertyName: loan.propertyName,
        loanType: loan.loanType,
        dueDate: row.dueDate,
        interestCents: row.interestCents,
        principalCents: row.principalCents,
        escrowCents: row.escrowCents,
        totalCents: row.paymentCents + row.escrowCents,
        paid: row.actual || paidInMonth.length > 0,
        paidAmountCents: row.actual ? row.paymentCents + row.escrowCents : null,
      });
    }
  }

  return due.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export interface PayoutTotals {
  lendersCents: Cents;
  ownersCents: Cents;
  totalCents: Cents;
  unpaidLendersCents: Cents;
}

export function payoutTotals(due: readonly DuePayment[], allocations: readonly OwnerAllocation[]): PayoutTotals {
  const lenders = sumCents(due.map((d) => d.totalCents));
  const owners = sumCents(allocations.map((a) => a.amountCents));
  return {
    lendersCents: lenders,
    ownersCents: owners,
    totalCents: lenders + owners,
    unpaidLendersCents: sumCents(due.filter((d) => !d.paid).map((d) => d.totalCents)),
  };
}

/** Interest on a sum lent, for one period at a frequency. Shown as a check. */
export function interestOn(principalCents: Cents, annualRatePercent: number, perYear: number): Cents {
  return roundCents((principalCents * annualRatePercent) / 100 / perYear);
}
