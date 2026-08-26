import {
  interestCoverage,
  interestCreditAt,
  maturityDateOf,
  type LoanPaymentRecord,
  type LoanTerms,
} from './amortization';
import { monthOf, type IsoDate, type MonthKey } from './dates';
import { sumCents, type Cents } from './money';

/**
 * What a lender is owed, and how far ahead you are.
 *
 * A private note is the case this exists for. The monthly schedule answers
 * "what falls due when"; it does not answer the two questions actually asked
 * of a private lender — what is the year's interest, and having sent them a
 * lump, what is left to pay. Those need accrual and cash held apart, which is
 * what this does.
 */
export interface InterestSummary {
  /** Interest the note charges over its whole term. */
  totalTermCents: Cents;
  /** Charged up to and including the month `asOf` falls in. */
  accruedToDateCents: Cents;
  /** Every interest payment made, however it was recorded. */
  paidCents: Cents;
  /** The part of it written as a lump ahead of a period. */
  advancesPaidCents: Cents;
  /**
   * Paid beyond everything charged so far: what you are ahead by. Never
   * negative — being behind is arrears, and that is `arrearsCents`.
   */
  creditCents: Cents;
  /** Charged, fallen due and still unpaid. */
  arrearsCents: Cents;
  /** Still to pay for periods after `asOf`. */
  remainingToMaturityCents: Cents;
  /** The last period settled in full with nothing missed before it. */
  paidThrough: IsoDate | null;
  maturityDate: IsoDate;
}

export function interestSummary(
  terms: LoanTerms,
  payments: readonly LoanPaymentRecord[],
  asOf: IsoDate,
): InterestSummary {
  const coverage = interestCoverage(terms, payments);
  const month = monthOf(asOf);

  const chargedSoFar = coverage.filter((row) => row.month <= month);
  const stillToCome = coverage.filter((row) => row.month > month);

  const interestPaid = payments.filter((p) => p.source === 'actual' || p.source === 'advance');

  // Fully settled periods, up to the first one that is not. A note can be
  // settled through March and again through July with June missed; the honest
  // answer is March.
  let paidThrough: IsoDate | null = null;
  for (const row of coverage) {
    if (row.accruedCents === 0) continue;
    if (row.outstandingCents > 0) break;
    paidThrough = row.dueDate;
  }

  return {
    totalTermCents: sumCents(coverage.map((row) => row.accruedCents)),
    accruedToDateCents: sumCents(chargedSoFar.map((row) => row.accruedCents)),
    paidCents: sumCents(interestPaid.map((p) => p.interestCents)),
    advancesPaidCents: sumCents(
      interestPaid.filter((p) => p.source === 'advance').map((p) => p.interestCents),
    ),
    creditCents: interestCreditAt(terms, payments, asOf),
    arrearsCents: sumCents(chargedSoFar.map((row) => row.outstandingCents)),
    remainingToMaturityCents: sumCents(stillToCome.map((row) => row.outstandingCents)),
    paidThrough,
    maturityDate: maturityDateOf(terms),
  };
}

export interface InterestYear {
  year: number;
  /** Owed from periods before this year, still unpaid at its start. */
  broughtForwardCents: Cents;
  /** What the note charges across the calendar year. */
  chargedCents: Cents;
  /** Interest cash paid during the year, whatever period it settled. */
  paidCents: Cents;
  /** Brought forward plus charged, less what the year's periods have settled. */
  stillOwedCents: Cents;
  /** Periods falling due in the year. */
  periods: number;
}

/**
 * A calendar year as a running account: owed coming in, charged, paid, owed
 * going out. That is the shape of the question a private lender is asked —
 * "what do we still owe you this year" — and a schedule cannot answer it,
 * because the answer depends on what has been paid and when.
 *
 * Calendar, not the note's own anniversary: interest is reported and deducted
 * on the calendar, and an anniversary year would give two different answers
 * depending on who was asking.
 */
export function interestYear(
  terms: LoanTerms,
  payments: readonly LoanPaymentRecord[],
  year: number,
): InterestYear {
  const prefix = String(year);
  const coverage = interestCoverage(terms, payments);
  const before = coverage.filter((row) => row.month < `${prefix}-01`);
  const inYear = coverage.filter((row) => row.month.startsWith(prefix));

  return {
    year,
    broughtForwardCents: sumCents(before.map((row) => row.outstandingCents)),
    chargedCents: sumCents(inYear.map((row) => row.accruedCents)),
    paidCents: sumCents(
      payments
        .filter((p) => (p.source === 'actual' || p.source === 'advance') && p.date.startsWith(prefix))
        .map((p) => p.interestCents),
    ),
    stillOwedCents:
      sumCents(before.map((row) => row.outstandingCents)) + sumCents(inYear.map((row) => row.outstandingCents)),
    periods: inYear.filter((row) => row.accruedCents > 0).length,
  };
}

/** Every calendar year the note touches, oldest first. */
export function interestYears(terms: LoanTerms, payments: readonly LoanPaymentRecord[]): number[] {
  const months = interestCoverage(terms, payments).map((row) => row.month);
  const years = new Set(months.map((month: MonthKey) => Number(month.slice(0, 4))));
  return [...years].sort((a, b) => a - b);
}
