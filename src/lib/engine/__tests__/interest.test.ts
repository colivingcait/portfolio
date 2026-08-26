import { describe, expect, it } from 'vitest';
import {
  debtServiceForMonth,
  interestCoverage,
  interestCreditAt,
  type LoanPaymentRecord,
  type LoanTerms,
} from '../amortization';
import { interestSummary, interestYear, interestYears } from '../interest';
import { cents } from '../money';

/**
 * The note this was written against: $80,000 at 10%, interest only, $666.67 a
 * month. Nine months of it went unpaid and then a $5,000 cheque was sent.
 */
const NOTE: LoanTerms = {
  originalPrincipalCents: cents(80_000),
  annualRatePercent: 10,
  startDate: '2025-11-01',
  firstPaymentDate: '2025-12-01',
  termMonths: 36,
  structure: 'interest_only_balloon',
  paymentFrequency: 'monthly',
};

const MONTHLY = cents(666.67);

const payment = (date: string, dollars: number, source: 'actual' | 'advance'): LoanPaymentRecord => ({
  date,
  totalCents: cents(dollars),
  principalCents: 0,
  interestCents: cents(dollars),
  escrowCents: 0,
  extraPrincipalCents: 0,
  source,
});

const lump = (date: string, dollars: number) => payment(date, dollars, 'advance');

describe('a private note settled irregularly', () => {
  it('charges the note’s rate on the balance, whatever was paid', () => {
    const rows = interestCoverage(NOTE, []);
    expect(rows[0].accruedCents).toBe(MONTHLY);
    expect(interestYear(NOTE, [], 2026).chargedCents).toBe(MONTHLY * 12);
  });

  it('does not let a short payment quietly reduce what was charged', () => {
    // $500 against $666.67 leaves $166.67 owed, not a $500 charge.
    const rows = interestCoverage(NOTE, [payment('2025-12-01', 500, 'actual')]);
    expect(rows[0].accruedCents).toBe(MONTHLY);
    expect(rows[0].outstandingCents).toBe(MONTHLY - cents(500));
  });

  describe('nine months unpaid, then $5,000', () => {
    // Dec 2025 through Aug 2026 is nine periods: $6,000.03 charged.
    const payments = [lump('2026-08-24', 5_000)];
    const asOf = '2026-08-25';

    it('settles the oldest periods first, not the ones still to come', () => {
      const rows = interestCoverage(NOTE, payments);
      const settled = rows.filter((row) => row.outstandingCents === 0 && row.accruedCents > 0);
      // $5,000 covers seven whole months and part of the eighth.
      expect(settled.map((row) => row.month)).toEqual([
        '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      ]);
      // Nothing in the future has been touched.
      expect(rows.find((row) => row.month === '2026-09')!.outstandingCents).toBe(MONTHLY);
    });

    it('leaves the right arrears rather than claiming the note is paid ahead', () => {
      const summary = interestSummary(NOTE, payments, asOf);
      expect(summary.arrearsCents).toBe(MONTHLY * 9 - cents(5_000));
      expect(summary.creditCents).toBe(0);
      expect(summary.paidThrough).toBe('2026-06-01');
    });

    it('answers what is still owed for the year', () => {
      const year = interestYear(NOTE, payments, 2026);
      expect(year.chargedCents).toBe(MONTHLY * 12);
      expect(year.paidCents).toBe(cents(5_000));
      // One month carried in from 2025, twelve charged, $5,000 paid.
      expect(year.broughtForwardCents).toBe(0); // the lump settled December first
      expect(year.stillOwedCents).toBe(MONTHLY * 13 - cents(5_000));
    });

    it('takes the cash in the month the cheque was written', () => {
      expect(debtServiceForMonth(NOTE, '2026-08', payments)).toBe(cents(5_000) + MONTHLY);
      // Settled by that cheque, so nothing more left the account for them.
      expect(debtServiceForMonth(NOTE, '2026-03', payments)).toBe(0);
      // Still owed, so still forecast.
      expect(debtServiceForMonth(NOTE, '2026-09', payments)).toBe(MONTHLY);
    });
  });

  describe('paid up, then a lump ahead', () => {
    const upToDate = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
      .map((month) => payment(`${month}-01`, 666.67, 'actual'));

    it('turns the surplus into credit against periods still to come', () => {
      const payments = [...upToDate, lump('2026-08-24', 2_000)];
      const summary = interestSummary(NOTE, payments, '2026-08-25');
      expect(summary.arrearsCents).toBe(0);
      expect(summary.creditCents).toBe(cents(2_000));
      expect(summary.paidThrough).toBe('2026-10-01'); // two more months covered
    });

    it('stops those months costing anything again', () => {
      const payments = [...upToDate, lump('2026-08-24', 2_000)];
      expect(debtServiceForMonth(NOTE, '2026-09', payments)).toBe(0);
      expect(debtServiceForMonth(NOTE, '2026-10', payments)).toBe(0);
      // $2,000 is a cent short of three months at $666.67, and the cent is
      // not swept under the rug — the third month is nearly, not fully, met.
      expect(debtServiceForMonth(NOTE, '2026-11', payments)).toBe(1);
      expect(debtServiceForMonth(NOTE, '2026-12', payments)).toBe(MONTHLY);
    });
  });

  it('lets a later payment absorb a month that was skipped', () => {
    // June was missed and July was paid. Money is fungible and settles the
    // oldest period first, so the note is square through June and it is July
    // that stands outstanding — not the other way round.
    const payments = [
      ...['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map((m) =>
        payment(`${m}-01`, 666.67, 'actual'),
      ),
      payment('2026-07-01', 666.67, 'actual'),
    ];
    const summary = interestSummary(NOTE, payments, '2026-08-01');
    expect(summary.paidThrough).toBe('2026-06-01');
    expect(summary.arrearsCents).toBe(MONTHLY * 2); // July and August
  });

  it('never buys down principal', () => {
    const rows = interestCoverage(NOTE, [lump('2026-01-01', 20_000)]);
    expect(rows.every((row) => row.accruedCents === 0 || row.accruedCents === MONTHLY)).toBe(true);
  });

  it('leaves a note with no advances exactly as it was', () => {
    expect(debtServiceForMonth(NOTE, '2026-04', [])).toBe(MONTHLY);
    expect(interestCreditAt(NOTE, [], '2026-04-01')).toBe(0);
  });

  it('handles a quarterly note, which private ones often are', () => {
    const quarterly: LoanTerms = { ...NOTE, paymentFrequency: 'quarterly' };
    const year = interestYear(quarterly, [], 2026);
    expect(year.periods).toBe(4);
    expect(year.chargedCents).toBe(cents(2_000) * 4);
  });

  it('lists every calendar year the note touches', () => {
    expect(interestYears(NOTE, [])).toEqual([2025, 2026, 2027, 2028]);
  });
});
