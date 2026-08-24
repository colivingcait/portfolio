/**
 * Loans (§8) — "Build this first."
 *
 * Depends on no import, no statement, no external account. Pure arithmetic
 * over the loan terms. Its real job is turning the single mortgage debit on a
 * bank statement into two P&L lines: the bank shows one number, the schedule
 * explains it.
 */

import { addMonths, covers, daysBetween, monthOf, type IsoDate, type MonthKey } from './dates';
import { roundCents, type Cents } from './money';

export type LoanStructure =
  | 'fully_amortizing'
  | 'interest_only'
  | 'interest_only_balloon'
  | 'custom';

export type PaymentFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

export function periodsPerYear(frequency: PaymentFrequency = 'monthly'): number {
  return PERIODS_PER_YEAR[frequency];
}

/** Months between one payment and the next. */
export function monthsPerPeriod(frequency: PaymentFrequency = 'monthly'): number {
  return 12 / PERIODS_PER_YEAR[frequency];
}

export interface LoanTerms {
  originalPrincipalCents: Cents;
  /** Whole-number annual rate: 7.25 means 7.25%. */
  annualRatePercent: number;
  startDate: IsoDate;
  firstPaymentDate: IsoDate;
  /** One of termMonths or maturityDate is required. */
  termMonths?: number | null;
  maturityDate?: IsoDate | null;
  /** Required for 'custom'; derived for 'fully_amortizing' when absent. */
  paymentAmountCents?: Cents | null;
  structure: LoanStructure;
  /** Monthly unless stated. A private note is often quarterly. */
  paymentFrequency?: PaymentFrequency;
  /** Defaults to the balance outstanding at maturity. */
  balloonAmountCents?: Cents | null;
  escrowIncluded?: boolean;
  escrowCents?: Cents | null;
}

export interface LoanPaymentRecord {
  date: IsoDate;
  totalCents: Cents;
  principalCents: Cents;
  interestCents: Cents;
  escrowCents: Cents;
  extraPrincipalCents: Cents;
  source: 'scheduled' | 'actual';
}

export interface ScheduleRow {
  period: number;
  dueDate: IsoDate;
  month: MonthKey;
  openingBalanceCents: Cents;
  /** Principal + interest. Escrow is carried separately; it is not debt service. */
  paymentCents: Cents;
  principalCents: Cents;
  interestCents: Cents;
  extraPrincipalCents: Cents;
  escrowCents: Cents;
  closingBalanceCents: Cents;
  /** True where an actual payment record replaced the scheduled figures. */
  actual: boolean;
  isBalloon: boolean;
}

const MAX_PERIODS = 600; // 50 years — a guard against a malformed custom loan.

export function termMonthsOf(terms: LoanTerms): number {
  if (terms.termMonths && terms.termMonths > 0) return terms.termMonths;
  if (terms.maturityDate) {
    const from = terms.firstPaymentDate;
    const months =
      (+terms.maturityDate.slice(0, 4) - +from.slice(0, 4)) * 12 +
      (+terms.maturityDate.slice(5, 7) - +from.slice(5, 7)) +
      1;
    return Math.max(1, months);
  }
  throw new Error('Loan needs either a term in months or a maturity date');
}

export function maturityDateOf(terms: LoanTerms): IsoDate {
  if (terms.maturityDate) return terms.maturityDate;
  return addMonths(terms.firstPaymentDate, termMonthsOf(terms) - 1);
}

/** How many payments the term contains at this frequency. */
export function paymentCountOf(terms: LoanTerms): number {
  const step = monthsPerPeriod(terms.paymentFrequency);
  return Math.max(1, Math.round(termMonthsOf(terms) / step));
}

export function daysToMaturity(terms: LoanTerms, asOf: IsoDate): number {
  return daysBetween(asOf, maturityDateOf(terms));
}

/**
 * Standard amortizing payment. Zero-rate loans divide principal evenly.
 * `periods` is the number of PAYMENTS, not months, and the rate is divided by
 * how many of them fall in a year.
 */
export function paymentPerPeriod(
  principalCents: Cents,
  annualRatePercent: number,
  periods: number,
  perYear = 12,
): Cents {
  if (periods <= 0) return principalCents;
  const r = annualRatePercent / 100 / perYear;
  if (r === 0) return roundCents(principalCents / periods);
  const factor = Math.pow(1 + r, periods);
  return roundCents((principalCents * r * factor) / (factor - 1));
}

/** Monthly case, kept for callers that mean months. */
export function monthlyPayment(
  principalCents: Cents,
  annualRatePercent: number,
  termMonths: number,
): Cents {
  return paymentPerPeriod(principalCents, annualRatePercent, termMonths, 12);
}

function scheduledPaymentFor(terms: LoanTerms): Cents {
  if (terms.paymentAmountCents && terms.paymentAmountCents > 0) return terms.paymentAmountCents;
  const perYear = periodsPerYear(terms.paymentFrequency);
  switch (terms.structure) {
    case 'fully_amortizing':
      return paymentPerPeriod(
        terms.originalPrincipalCents,
        terms.annualRatePercent,
        paymentCountOf(terms),
        perYear,
      );
    case 'interest_only':
    case 'interest_only_balloon':
      return periodInterest(terms.originalPrincipalCents, terms.annualRatePercent, perYear);
    case 'custom':
      throw new Error('A custom-structure loan needs an explicit payment amount');
  }
}

/** Interest for one payment period at this frequency. */
export function periodInterest(balanceCents: Cents, annualRatePercent: number, perYear = 12): Cents {
  return roundCents((balanceCents * annualRatePercent) / 100 / perYear);
}

/**
 * The full schedule, with any actual payments substituted in.
 *
 * An actual payment replaces the scheduled row for its month, and the running
 * balance carries forward from it — so extra principal genuinely shortens the
 * loan rather than being cosmetic.
 */
export function buildSchedule(
  terms: LoanTerms,
  payments: readonly LoanPaymentRecord[] = [],
): ScheduleRow[] {
  const periods = paymentCountOf(terms);
  const step = monthsPerPeriod(terms.paymentFrequency);
  const perYear = periodsPerYear(terms.paymentFrequency);
  const scheduledPayment = scheduledPaymentFor(terms);
  const escrow = terms.escrowIncluded ? (terms.escrowCents ?? 0) : 0;
  const actualByMonth = new Map<MonthKey, LoanPaymentRecord>();
  for (const p of payments) {
    if (p.source === 'actual') actualByMonth.set(monthOf(p.date), p);
  }

  const rows: ScheduleRow[] = [];
  let balance = terms.originalPrincipalCents;

  for (let period = 1; period <= Math.min(periods, MAX_PERIODS) && balance > 0; period++) {
    const dueDate = addMonths(terms.firstPaymentDate, (period - 1) * step);
    const month = monthOf(dueDate);
    const actual = actualByMonth.get(month);
    const isFinal = period === periods;
    const opening = balance;

    let interest: Cents;
    let principal: Cents;
    let extra: Cents;
    let escrowPaid: Cents;
    let payment: Cents;

    if (actual) {
      interest = actual.interestCents;
      principal = actual.principalCents;
      extra = actual.extraPrincipalCents;
      escrowPaid = actual.escrowCents;
      payment = actual.totalCents - escrowPaid;
    } else {
      interest = periodInterest(opening, terms.annualRatePercent, perYear);
      escrowPaid = escrow;
      extra = 0;

      if (terms.structure === 'interest_only' || terms.structure === 'interest_only_balloon') {
        // Principal is never amortized. Whatever is outstanding at maturity is
        // the balloon, and it stays on the books as a balance rather than
        // being quietly "paid" by the schedule.
        principal = 0;
        payment = interest;
      } else {
        payment = scheduledPayment;
        principal = payment - interest;
        // A fully amortizing loan settles exactly on its final period. A
        // custom one may not — anything left over is a balloon, not an error.
        const settles = terms.structure === 'fully_amortizing' && isFinal;
        if (settles || principal > opening) {
          principal = opening;
          payment = principal + interest;
        }
        // A payment that does not cover interest would grow the balance; that
        // is negative amortization, not a rounding artifact. Let it stand and
        // surface it rather than silently clamping.
      }
    }

    const closing = opening - principal - extra;
    rows.push({
      period,
      dueDate,
      month,
      openingBalanceCents: opening,
      paymentCents: payment,
      principalCents: principal,
      interestCents: interest,
      extraPrincipalCents: extra,
      escrowCents: escrowPaid,
      closingBalanceCents: closing,
      actual: Boolean(actual),
      isBalloon: false,
    });

    balance = closing;
    if (balance <= 0) break;
  }

  // Anything still outstanding at maturity is the balloon.
  const last = rows[rows.length - 1];
  if (last && last.closingBalanceCents > 0) {
    last.isBalloon = true;
  }

  return rows;
}

/** Balance outstanding at a date, honouring actual payments made by then. */
export function balanceAtDate(
  terms: LoanTerms,
  asOf: IsoDate,
  payments: readonly LoanPaymentRecord[] = [],
): Cents {
  if (asOf < terms.startDate) return 0;
  const rows = buildSchedule(terms, payments);
  let balance = terms.originalPrincipalCents;
  for (const row of rows) {
    if (row.dueDate > asOf) break;
    balance = row.closingBalanceCents;
  }
  return balance;
}

/** Balloon due at maturity, if any. */
export function balloonAtMaturity(
  terms: LoanTerms,
  payments: readonly LoanPaymentRecord[] = [],
): Cents {
  if (terms.balloonAmountCents && terms.balloonAmountCents > 0) return terms.balloonAmountCents;
  const rows = buildSchedule(terms, payments);
  const last = rows[rows.length - 1];
  return last ? Math.max(0, last.closingBalanceCents) : 0;
}

/**
 * Payoff = outstanding balance plus interest accrued since the last payment.
 * Simple daily accrual on a 365-day year; a lender's quote may differ by
 * their day-count convention, so this is an estimate and is labelled as one.
 */
export function payoffAmount(
  terms: LoanTerms,
  asOf: IsoDate,
  payments: readonly LoanPaymentRecord[] = [],
): { balanceCents: Cents; accruedInterestCents: Cents; payoffCents: Cents } {
  const balance = balanceAtDate(terms, asOf, payments);
  const rows = buildSchedule(terms, payments);
  const lastPaid = [...rows].reverse().find((r) => r.dueDate <= asOf);
  const since = lastPaid ? lastPaid.dueDate : terms.startDate;
  const days = Math.max(0, daysBetween(since, asOf));
  const accrued = roundCents((balance * terms.annualRatePercent * days) / 100 / 365);
  return { balanceCents: balance, accruedInterestCents: accrued, payoffCents: balance + accrued };
}

/**
 * The principal/interest split for one month — the line that decomposes a
 * single bank debit into two P&L entries with no categorization required.
 */
export function splitForMonth(
  terms: LoanTerms,
  month: MonthKey,
  payments: readonly LoanPaymentRecord[] = [],
): { principalCents: Cents; interestCents: Cents; escrowCents: Cents; totalCents: Cents } | null {
  const row = buildSchedule(terms, payments).find((r) => r.month === month);
  if (!row) return null;
  return {
    principalCents: row.principalCents + row.extraPrincipalCents,
    interestCents: row.interestCents,
    escrowCents: row.escrowCents,
    totalCents: row.paymentCents + row.escrowCents,
  };
}

/** Debt service for a month: principal + interest, escrow excluded. */
export function debtServiceForMonth(
  terms: LoanTerms,
  month: MonthKey,
  payments: readonly LoanPaymentRecord[] = [],
): Cents {
  const split = splitForMonth(terms, month, payments);
  return split ? split.principalCents + split.interestCents : 0;
}

export interface MaturityLadderEntry<T> {
  loan: T;
  maturityDate: IsoDate;
  daysRemaining: number;
  balanceCents: Cents;
  balloonCents: Cents;
  /** Balance × your effective share — an economic figure. */
  proRataBalanceCents: Cents;
  /**
   * The whole balance where you have personally guaranteed the note.
   * A guarantee does not pro-rate: a lender comes after the full amount
   * regardless of a 25% interest (§3, "the debt caveat").
   */
  guaranteedExposureCents: Cents;
}

/**
 * The maturity ladder (§8) — "the highest-value screen in the application."
 * Private notes mature; that is the risk that actually bites.
 */
export function buildMaturityLadder<T extends { terms: LoanTerms; payments?: LoanPaymentRecord[]; guarantor: boolean; sharePercent: number }>(
  loans: readonly T[],
  asOf: IsoDate,
): MaturityLadderEntry<T>[] {
  return loans
    .map((loan) => {
      const balance = balanceAtDate(loan.terms, asOf, loan.payments ?? []);
      return {
        loan,
        maturityDate: maturityDateOf(loan.terms),
        daysRemaining: daysToMaturity(loan.terms, asOf),
        balanceCents: balance,
        balloonCents: balloonAtMaturity(loan.terms, loan.payments ?? []),
        proRataBalanceCents: roundCents((balance * loan.sharePercent) / 100),
        guaranteedExposureCents: loan.guarantor ? balance : 0,
      };
    })
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
}

/** Re-exported for callers that filter loans by an active window. */
export { covers };
