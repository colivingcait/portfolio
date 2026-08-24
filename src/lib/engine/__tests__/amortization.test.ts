import { describe, expect, it } from 'vitest';
import {
  balanceAtDate,
  balloonAtMaturity,
  buildMaturityLadder,
  buildSchedule,
  daysToMaturity,
  debtServiceForMonth,
  maturityDateOf,
  monthlyPayment,
  payoffAmount,
  splitForMonth,
  type LoanTerms,
} from '../amortization';
import { cents } from '../money';

const thirtyYear: LoanTerms = {
  originalPrincipalCents: cents(100_000),
  annualRatePercent: 6,
  startDate: '2026-01-01',
  firstPaymentDate: '2026-02-01',
  termMonths: 360,
  structure: 'fully_amortizing',
};

describe('amortizing loans', () => {
  it('computes the standard monthly payment', () => {
    // $100,000 at 6% over 360 months is the textbook $599.55.
    expect(monthlyPayment(cents(100_000), 6, 360)).toBe(cents(599.55));
  });

  it('divides principal evenly at a zero rate', () => {
    expect(monthlyPayment(cents(120_000), 0, 120)).toBe(cents(1_000));
  });

  it('builds a schedule that pays the loan off exactly', () => {
    const rows = buildSchedule(thirtyYear);
    expect(rows).toHaveLength(360);
    expect(rows[rows.length - 1].closingBalanceCents).toBe(0);
    expect(rows[0].interestCents).toBe(cents(500)); // 100,000 × 6% ÷ 12
    expect(rows[0].principalCents).toBe(cents(99.55));
  });

  it('splits a single bank debit into principal and interest', () => {
    const split = splitForMonth(thirtyYear, '2026-02');
    expect(split).toEqual({
      principalCents: cents(99.55),
      interestCents: cents(500),
      escrowCents: 0,
      totalCents: cents(599.55),
    });
  });

  it('carries escrow separately from debt service', () => {
    const withEscrow: LoanTerms = { ...thirtyYear, escrowIncluded: true, escrowCents: cents(250) };
    const split = splitForMonth(withEscrow, '2026-02')!;
    expect(split.escrowCents).toBe(cents(250));
    expect(split.totalCents).toBe(cents(849.55));
    expect(debtServiceForMonth(withEscrow, '2026-02')).toBe(cents(599.55));
  });

  it('reports the balance at any date', () => {
    expect(balanceAtDate(thirtyYear, '2026-01-15')).toBe(cents(100_000));
    expect(balanceAtDate(thirtyYear, '2026-02-01')).toBe(cents(99_900.45));
    expect(balanceAtDate(thirtyYear, '2056-01-01')).toBe(0);
  });

  it('lets extra principal genuinely shorten the loan', () => {
    const rows = buildSchedule(thirtyYear, [
      {
        date: '2026-02-01',
        totalCents: cents(10_599.55),
        principalCents: cents(99.55),
        interestCents: cents(500),
        escrowCents: 0,
        extraPrincipalCents: cents(10_000),
        source: 'actual',
      },
    ]);
    expect(rows[0].closingBalanceCents).toBe(cents(89_900.45));
    // Less interest next month, because the balance is genuinely lower.
    expect(rows[1].interestCents).toBe(cents(449.5));
    expect(rows.length).toBeLessThan(360);
  });
});

describe('interest-only and balloons (§8)', () => {
  const io: LoanTerms = {
    originalPrincipalCents: cents(250_000),
    annualRatePercent: 12,
    startDate: '2025-09-01',
    firstPaymentDate: '2025-10-01',
    termMonths: 24,
    structure: 'interest_only_balloon',
  };

  it('pays interest only and leaves the principal outstanding', () => {
    const rows = buildSchedule(io);
    expect(rows[0].interestCents).toBe(cents(2_500));
    expect(rows[0].principalCents).toBe(0);
    expect(rows[0].closingBalanceCents).toBe(cents(250_000));
    expect(balanceAtDate(io, '2027-01-01')).toBe(cents(250_000));
  });

  it('reports the balloon due at maturity', () => {
    expect(balloonAtMaturity(io)).toBe(cents(250_000));
    expect(maturityDateOf(io)).toBe('2027-09-01');
  });

  it('honours an explicitly stated balloon amount', () => {
    expect(balloonAtMaturity({ ...io, balloonAmountCents: cents(240_000) })).toBe(cents(240_000));
  });

  it('counts days to maturity', () => {
    expect(daysToMaturity(io, '2026-08-24')).toBe(373);
  });

  it('derives the term from a maturity date when no term is given', () => {
    const terms: LoanTerms = {
      originalPrincipalCents: cents(100_000),
      annualRatePercent: 9,
      startDate: '2026-01-01',
      firstPaymentDate: '2026-02-01',
      maturityDate: '2027-01-01',
      structure: 'interest_only',
    };
    expect(buildSchedule(terms)).toHaveLength(12);
  });
});

describe('payoff', () => {
  it('adds interest accrued since the last payment', () => {
    const quote = payoffAmount(thirtyYear, '2026-02-16');
    expect(quote.balanceCents).toBe(cents(99_900.45));
    expect(quote.accruedInterestCents).toBeGreaterThan(0);
    expect(quote.payoffCents).toBe(quote.balanceCents + quote.accruedInterestCents);
  });
});

describe('maturity ladder (§8) — the highest-value screen', () => {
  const soon: LoanTerms = {
    originalPrincipalCents: cents(180_000),
    annualRatePercent: 11,
    startDate: '2025-01-01',
    firstPaymentDate: '2025-02-01',
    termMonths: 18,
    structure: 'interest_only_balloon',
  };

  it('sorts by maturity date', () => {
    const ladder = buildMaturityLadder(
      [
        { terms: thirtyYear, guarantor: false, sharePercent: 100 },
        { terms: soon, guarantor: true, sharePercent: 25 },
      ],
      '2026-08-24',
    );
    expect(ladder[0].maturityDate).toBe('2026-07-01');
    expect(ladder[1].maturityDate).toBe('2056-01-01');
  });

  it('shows guaranteed exposure at full balance alongside the pro-rata share', () => {
    // The debt caveat (§3): a guarantee does not pro-rate. A lender comes
    // after the whole balance regardless of a 25% interest.
    const [entry] = buildMaturityLadder([{ terms: soon, guarantor: true, sharePercent: 25 }], '2026-01-01');
    expect(entry.balanceCents).toBe(cents(180_000));
    expect(entry.proRataBalanceCents).toBe(cents(45_000));
    expect(entry.guaranteedExposureCents).toBe(cents(180_000));
  });

  it('reports no guaranteed exposure where the note is not guaranteed', () => {
    const [entry] = buildMaturityLadder([{ terms: soon, guarantor: false, sharePercent: 25 }], '2026-01-01');
    expect(entry.guaranteedExposureCents).toBe(0);
    expect(entry.proRataBalanceCents).toBe(cents(45_000));
  });
});
