import {
  buildSchedule,
  interestCoverage,
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
  /** Every advance written, whatever it covers. */
  advancesPaidCents: Cents;
  /** Period payments made, which settle their own period. */
  periodInterestPaidCents: Cents;
  /**
   * Advance credit not yet consumed: what you are ahead by. Never negative —
   * being behind is arrears, and that is what `arrearsCents` is for.
   */
  creditCents: Cents;
  /** Accrued, not covered, and past due. */
  arrearsCents: Cents;
  /** Cash still to pay between `asOf` and maturity. */
  remainingToMaturityCents: Cents;
  /** The last period an advance has fully covered, or null if none. */
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

  const upToNow = coverage.filter((row) => row.month <= month);
  const ahead = coverage.filter((row) => row.month > month);

  const advancesPaidCents = sumCents(coverage.map((row) => row.advancePaidCents));
  const periodInterestPaidCents = sumCents(
    payments.filter((p) => p.source === 'actual').map((p) => p.interestCents),
  );

  // Credit left over at the end of the last period that has come round.
  const last = upToNow[upToNow.length - 1];
  const creditCents = last ? last.creditAfterCents : 0;

  // Arrears is what has fallen due, was not covered by a credit, and was not
  // met by a period payment either.
  const dueSoFar = sumCents(upToNow.map((row) => row.cashDueCents));
  const arrearsCents = Math.max(0, dueSoFar - periodInterestPaidCents);

  const fullyCovered = coverage.filter((row) => row.accruedCents > 0 && row.cashDueCents === 0);
  const paidThrough = fullyCovered.length ? fullyCovered[fullyCovered.length - 1].dueDate : null;

  return {
    totalTermCents: sumCents(buildSchedule(terms, payments).map((row) => row.interestCents)),
    accruedToDateCents: sumCents(upToNow.map((row) => row.accruedCents)),
    advancesPaidCents,
    periodInterestPaidCents,
    creditCents,
    arrearsCents,
    remainingToMaturityCents: sumCents(ahead.map((row) => row.cashDueCents)),
    paidThrough,
    maturityDate: maturityDateOf(terms),
  };
}

export interface InterestYear {
  year: number;
  /** What the note charges across the calendar year. */
  accruedCents: Cents;
  /** Advances written during the year, whatever period they cover. */
  advancesPaidCents: Cents;
  /** Period payments made during the year. */
  periodPaidCents: Cents;
  /** Still to pay in cash for the year's periods. */
  cashDueCents: Cents;
  /** Months of the year the note is on the books for. */
  periods: number;
}

/**
 * A calendar year, which is the year a lender and an accountant both mean.
 *
 * Not the note's own anniversary year: interest is reported and deducted on
 * the calendar, and a private note that started in April would otherwise give
 * two different "annual interest" figures depending on who was asking.
 */
export function interestYear(
  terms: LoanTerms,
  payments: readonly LoanPaymentRecord[],
  year: number,
): InterestYear {
  const prefix = String(year);
  const coverage = interestCoverage(terms, payments).filter((row) => row.month.startsWith(prefix));

  const inYear = (date: IsoDate) => date.startsWith(prefix);

  return {
    year,
    accruedCents: sumCents(coverage.map((row) => row.accruedCents)),
    advancesPaidCents: sumCents(coverage.map((row) => row.advancePaidCents)),
    periodPaidCents: sumCents(
      payments.filter((p) => p.source === 'actual' && inYear(p.date)).map((p) => p.interestCents),
    ),
    cashDueCents: sumCents(coverage.map((row) => row.cashDueCents)),
    periods: coverage.filter((row) => row.accruedCents > 0).length,
  };
}

/** Every calendar year the note touches, oldest first. */
export function interestYears(terms: LoanTerms, payments: readonly LoanPaymentRecord[]): number[] {
  const months = interestCoverage(terms, payments).map((row) => row.month);
  const years = new Set(months.map((month: MonthKey) => Number(month.slice(0, 4))));
  return [...years].sort((a, b) => a - b);
}
