import { describe, expect, it } from 'vitest';
import { debtServiceForMonth, interestCoverage, type LoanPaymentRecord, type LoanTerms } from '../amortization';
import { interestSummary, interestYear, interestYears } from '../interest';
import { cents } from '../money';

/**
 * A private note the way they actually come: $200,000 at 12%, interest only,
 * balloon at the end. $2,000 a month, $24,000 a year.
 */
const NOTE: LoanTerms = {
  originalPrincipalCents: cents(200_000),
  annualRatePercent: 12,
  startDate: '2026-01-01',
  firstPaymentDate: '2026-01-01',
  termMonths: 24,
  structure: 'interest_only_balloon',
  paymentFrequency: 'monthly',
};

const advance = (date: string, dollars: number): LoanPaymentRecord => ({
  date,
  totalCents: cents(dollars),
  principalCents: 0,
  interestCents: cents(dollars),
  escrowCents: 0,
  extraPrincipalCents: 0,
  source: 'advance',
});

const periodPayment = (date: string, dollars: number): LoanPaymentRecord => ({
  date,
  totalCents: cents(dollars),
  principalCents: 0,
  interestCents: cents(dollars),
  escrowCents: 0,
  extraPrincipalCents: 0,
  source: 'actual',
});

describe('interest paid ahead of when it falls due', () => {
  it('charges the note’s own interest whatever has been paid', () => {
    const year = interestYear(NOTE, [], 2026);
    expect(year.accruedCents).toBe(cents(24_000));
    expect(year.periods).toBe(12);
    expect(year.cashDueCents).toBe(cents(24_000));
  });

  it('spreads a lump across the periods it covers, rather than into one month', () => {
    // Six months of interest, written in March.
    const rows = interestCoverage(NOTE, [advance('2026-03-01', 12_000)]);
    const byMonth = new Map(rows.map((r) => [r.month, r]));

    expect(byMonth.get('2026-02')!.cashDueCents).toBe(cents(2_000)); // before the cheque
    for (const month of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
      expect(byMonth.get(month)!.cashDueCents, month).toBe(0);
      expect(byMonth.get(month)!.coveredCents, month).toBe(cents(2_000));
    }
    expect(byMonth.get('2026-09')!.cashDueCents).toBe(cents(2_000)); // credit exhausted
  });

  it('never counts the same money twice: the year’s accrual does not move', () => {
    const year = interestYear(NOTE, [advance('2026-03-01', 12_000)], 2026);
    expect(year.accruedCents).toBe(cents(24_000));
    expect(year.advancesPaidCents).toBe(cents(12_000));
    // Ten periods still to settle in cash: Jan, Feb, and Sep through Dec.
    expect(year.cashDueCents).toBe(cents(12_000));
  });

  it('takes the cash in the month the cheque was written, not when it is earned', () => {
    const payments = [advance('2026-03-01', 12_000)];
    expect(debtServiceForMonth(NOTE, '2026-03', payments)).toBe(cents(12_000));
    // Covered, so nothing more leaves the account for these.
    expect(debtServiceForMonth(NOTE, '2026-04', payments)).toBe(0);
    expect(debtServiceForMonth(NOTE, '2026-08', payments)).toBe(0);
    // Credit spent.
    expect(debtServiceForMonth(NOTE, '2026-09', payments)).toBe(cents(2_000));
  });

  it('leaves an unadvanced note exactly as it was', () => {
    expect(debtServiceForMonth(NOTE, '2026-04', [])).toBe(cents(2_000));
    expect(debtServiceForMonth(NOTE, '2026-04', [periodPayment('2026-04-01', 2_000)])).toBe(cents(2_000));
  });

  it('never buys down principal: prepaying interest is not a principal payment', () => {
    const rows = interestCoverage(NOTE, [advance('2026-03-01', 24_000)]);
    // Every period still charges the full interest on the full balance.
    expect(rows.every((row) => row.accruedCents === 0 || row.accruedCents === cents(2_000))).toBe(true);
  });

  it('says how far ahead the lender has been paid', () => {
    const summary = interestSummary(NOTE, [advance('2026-03-01', 12_000)], '2026-05-15');
    expect(summary.paidThrough).toBe('2026-08-01');
    expect(summary.creditCents).toBe(cents(6_000)); // June, July, August still held
    expect(summary.advancesPaidCents).toBe(cents(12_000));
    expect(summary.arrearsCents).toBe(cents(4_000)); // January and February went unpaid
  });

  it('counts arrears settled by ordinary payments as settled', () => {
    const summary = interestSummary(
      NOTE,
      [periodPayment('2026-01-01', 2_000), periodPayment('2026-02-01', 2_000), advance('2026-03-01', 12_000)],
      '2026-05-15',
    );
    expect(summary.arrearsCents).toBe(0);
  });

  it('reports what is left to pay over the rest of the term', () => {
    const bare = interestSummary(NOTE, [], '2026-06-30');
    // Six months gone of twenty-four, at $2,000.
    expect(bare.totalTermCents).toBe(cents(48_000));
    expect(bare.accruedToDateCents).toBe(cents(12_000));
    expect(bare.remainingToMaturityCents).toBe(cents(36_000));

    const advanced = interestSummary(NOTE, [advance('2026-06-01', 20_000)], '2026-06-30');
    // The advance covers June onward, so ten of the remaining eighteen periods.
    expect(advanced.remainingToMaturityCents).toBe(cents(18_000));
  });

  it('keeps an advance written after the last period as cash that still left', () => {
    const summary = interestSummary(NOTE, [advance('2028-06-01', 5_000)], '2028-07-01');
    expect(summary.advancesPaidCents).toBe(cents(5_000));
    expect(debtServiceForMonth(NOTE, '2028-06', [advance('2028-06-01', 5_000)])).toBe(cents(5_000));
  });

  it('handles a quarterly note, which private ones often are', () => {
    const quarterly: LoanTerms = { ...NOTE, paymentFrequency: 'quarterly' };
    const year = interestYear(quarterly, [], 2026);
    expect(year.periods).toBe(4);
    expect(year.accruedCents).toBe(cents(24_000)); // four periods of $6,000
  });

  it('lists every calendar year the note touches', () => {
    expect(interestYears(NOTE, [])).toEqual([2026, 2027]);
  });
});
