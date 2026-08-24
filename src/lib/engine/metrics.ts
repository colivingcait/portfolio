/**
 * Return metrics.
 *
 * Each of these compresses a year of arithmetic into one number, which is
 * their value and their danger: a cap rate computed from four imported months
 * looks exactly like one computed from twelve. Every function here reports
 * what it was given, so a caller can say when a figure is not yet meaningful.
 */

import { daysBetween, type IsoDate } from './dates';
import type { Cents } from './money';

export interface CapRate {
  /** Annualised NOI over value, as a percentage. */
  percent: number | null;
  annualisedNoiCents: Cents;
  monthsObserved: number;
  /** True where fewer than twelve months fed it. */
  annualised: boolean;
}

/**
 * Cap rate: NOI ÷ value. Debt is deliberately absent — it measures the
 * property, not the financing.
 */
export function capRate(input: {
  noiCents: Cents;
  monthsObserved: number;
  valueCents: Cents;
}): CapRate {
  const months = Math.max(0, input.monthsObserved);
  const annualised = months > 0 && months < 12 ? Math.round((input.noiCents * 12) / months) : input.noiCents;
  return {
    percent: input.valueCents > 0 && months > 0 ? (annualised / input.valueCents) * 100 : null,
    annualisedNoiCents: annualised,
    monthsObserved: months,
    annualised: months > 0 && months < 12,
  };
}

/**
 * Debt service coverage: NOI ÷ debt service. Below 1.0 the property does not
 * cover its own loan payments, which is the number a lender asks for first.
 */
export function dscr(input: { noiCents: Cents; debtServiceCents: Cents }): number | null {
  if (input.debtServiceCents <= 0) return null;
  return input.noiCents / input.debtServiceCents;
}

export interface CashOnCash {
  percent: number | null;
  annualisedCashFlowCents: Cents;
  cashInvestedCents: Cents;
  monthsObserved: number;
  annualised: boolean;
}

/**
 * Cash-on-cash: cash flow after debt service ÷ cash actually put in.
 *
 * The denominator is the part that gets fudged. It is the money that left your
 * pocket — deposit, closing costs, rehab — not the purchase price.
 */
export function cashOnCash(input: {
  netCashCents: Cents;
  monthsObserved: number;
  cashInvestedCents: Cents;
}): CashOnCash {
  const months = Math.max(0, input.monthsObserved);
  const annualised = months > 0 && months < 12 ? Math.round((input.netCashCents * 12) / months) : input.netCashCents;
  return {
    percent: input.cashInvestedCents > 0 && months > 0 ? (annualised / input.cashInvestedCents) * 100 : null,
    annualisedCashFlowCents: annualised,
    cashInvestedCents: input.cashInvestedCents,
    monthsObserved: months,
    annualised: months > 0 && months < 12,
  };
}

/** Operating expenses as a share of revenue. */
export function expenseRatio(input: { revenueCents: Cents; operatingExpenseCents: Cents }): number | null {
  if (input.revenueCents <= 0) return null;
  return (input.operatingExpenseCents / input.revenueCents) * 100;
}

/** Total returned versus total put in, cash and equity together. */
export function equityMultiple(input: {
  distributionsCents: Cents;
  currentEquityCents: Cents;
  cashInvestedCents: Cents;
}): number | null {
  if (input.cashInvestedCents <= 0) return null;
  return (input.distributionsCents + input.currentEquityCents) / input.cashInvestedCents;
}

// ── IRR ──────────────────────────────────────────────────────────────────────

export interface CashFlow {
  date: IsoDate;
  amountCents: Cents;
}

/**
 * Internal rate of return over irregularly spaced flows — XIRR.
 *
 * Solved by bisection rather than Newton's method: slower, and it cannot fly
 * off to a nonsense root on a series that changes sign more than once, which
 * a property's flows routinely do.
 */
export function xirr(flows: readonly CashFlow[], options: { guessLow?: number; guessHigh?: number } = {}): number | null {
  if (flows.length < 2) return null;

  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted[0].date;

  const hasPositive = sorted.some((f) => f.amountCents > 0);
  const hasNegative = sorted.some((f) => f.amountCents < 0);
  // Without money going both ways there is no rate of return to find.
  if (!hasPositive || !hasNegative) return null;

  const npv = (rate: number): number =>
    sorted.reduce((sum, flow) => {
      const years = daysBetween(start, flow.date) / 365;
      return sum + flow.amountCents / Math.pow(1 + rate, years);
    }, 0);

  let low = options.guessLow ?? -0.9999;
  let high = options.guessHigh ?? 10;

  let npvLow = npv(low);
  let npvHigh = npv(high);
  if (Number.isNaN(npvLow) || Number.isNaN(npvHigh)) return null;
  if (npvLow * npvHigh > 0) return null; // no sign change in range: no root to find

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const npvMid = npv(mid);
    if (Math.abs(npvMid) < 1 || high - low < 1e-9) return mid * 100;
    if (npvLow * npvMid < 0) {
      high = mid;
      npvHigh = npvMid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }

  return ((low + high) / 2) * 100;
}

export interface IrrResult {
  percent: number | null;
  flows: CashFlow[];
  /** Months of actual history behind it. */
  monthsObserved: number;
  /**
   * True where the final flow is an estimated value rather than a sale. An IRR
   * ending in an estimate is a projection, not a result.
   */
  usesEstimatedExit: boolean;
  reason?: string;
}

/**
 * IRR for a property: money in at acquisition, cash flow monthly, and what it
 * would be worth if sold today.
 */
export function propertyIrr(input: {
  cashInvestedCents: Cents;
  acquiredOn: IsoDate | null;
  monthlyNetCash: readonly { month: string; netCashCents: Cents }[];
  exitValueCents: Cents;
  exitDate: IsoDate;
  exitIsSale?: boolean;
}): IrrResult {
  const flows: CashFlow[] = [];

  if (!input.acquiredOn || input.cashInvestedCents <= 0) {
    return {
      percent: null,
      flows: [],
      monthsObserved: input.monthlyNetCash.length,
      usesEstimatedExit: !input.exitIsSale,
      reason: !input.acquiredOn
        ? 'No acquisition date recorded, so there is no point to measure from.'
        : 'No cash invested recorded, so there is nothing to compute a return on.',
    };
  }

  flows.push({ date: input.acquiredOn, amountCents: -input.cashInvestedCents });
  for (const month of input.monthlyNetCash) {
    if (month.netCashCents !== 0) flows.push({ date: `${month.month}-28`, amountCents: month.netCashCents });
  }
  if (input.exitValueCents !== 0) flows.push({ date: input.exitDate, amountCents: input.exitValueCents });

  const percent = xirr(flows);
  return {
    percent,
    flows,
    monthsObserved: input.monthlyNetCash.length,
    usesEstimatedExit: !input.exitIsSale,
    reason:
      percent === null
        ? 'The flows never change sign, so there is no rate of return to solve for.'
        : undefined,
  };
}
