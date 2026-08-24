import { describe, expect, it } from 'vitest';
import { capRate, cashOnCash, dscr, equityMultiple, expenseRatio, propertyIrr, xirr } from '../metrics';
import { cents } from '../money';

describe('cap rate', () => {
  it('is NOI over value', () => {
    const rate = capRate({ noiCents: cents(36_000), monthsObserved: 12, valueCents: cents(400_000) });
    expect(rate.percent).toBeCloseTo(9, 6);
    expect(rate.annualised).toBe(false);
  });

  it('annualises a part year and says that it did', () => {
    // Four months of 3,000 is 12,000 observed, 36,000 annualised.
    const rate = capRate({ noiCents: cents(12_000), monthsObserved: 4, valueCents: cents(400_000) });
    expect(rate.annualisedNoiCents).toBe(cents(36_000));
    expect(rate.annualised).toBe(true);
    expect(rate.percent).toBeCloseTo(9, 6);
  });

  it('has nothing to report without a value', () => {
    expect(capRate({ noiCents: cents(36_000), monthsObserved: 12, valueCents: 0 }).percent).toBeNull();
  });
});

describe('debt service coverage', () => {
  it('is above one when the property covers its loan', () => {
    expect(dscr({ noiCents: cents(36_000), debtServiceCents: cents(24_000) })).toBeCloseTo(1.5, 6);
  });

  it('is below one when it does not', () => {
    expect(dscr({ noiCents: cents(20_000), debtServiceCents: cents(24_000) })!).toBeLessThan(1);
  });

  it('is undefined where there is no debt', () => {
    expect(dscr({ noiCents: cents(36_000), debtServiceCents: 0 })).toBeNull();
  });
});

describe('cash on cash', () => {
  it('divides cash flow by cash actually put in', () => {
    const result = cashOnCash({ netCashCents: cents(9_000), monthsObserved: 12, cashInvestedCents: cents(120_000) });
    expect(result.percent).toBeCloseTo(7.5, 6);
  });

  it('reports nothing rather than guessing when the cash invested is unknown', () => {
    expect(cashOnCash({ netCashCents: cents(9_000), monthsObserved: 12, cashInvestedCents: 0 }).percent).toBeNull();
  });
});

describe('other ratios', () => {
  it('measures expenses against revenue', () => {
    expect(expenseRatio({ revenueCents: cents(100_000), operatingExpenseCents: cents(42_000) })).toBeCloseTo(42, 6);
  });

  it('measures everything back against everything in', () => {
    expect(
      equityMultiple({ distributionsCents: cents(30_000), currentEquityCents: cents(150_000), cashInvestedCents: cents(120_000) }),
    ).toBeCloseTo(1.5, 6);
  });
});

describe('IRR', () => {
  it('solves a simple doubling over a year at about 100%', () => {
    const rate = xirr([
      { date: '2025-01-01', amountCents: cents(-100_000) },
      { date: '2026-01-01', amountCents: cents(200_000) },
    ]);
    expect(rate).toBeCloseTo(100, 0);
  });

  it('returns nothing where money only ever goes one way', () => {
    expect(
      xirr([
        { date: '2025-01-01', amountCents: cents(-100_000) },
        { date: '2026-01-01', amountCents: cents(-50_000) },
      ]),
    ).toBeNull();
  });

  it('handles a property: money in, cash flow, then a sale', () => {
    const rate = xirr([
      { date: '2025-01-01', amountCents: cents(-120_000) },
      { date: '2025-06-30', amountCents: cents(6_000) },
      { date: '2025-12-31', amountCents: cents(6_000) },
      { date: '2026-06-30', amountCents: cents(150_000) },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(20);
    expect(rate!).toBeLessThan(45);
  });

  it('says why it cannot compute one rather than returning a number', () => {
    const result = propertyIrr({
      cashInvestedCents: cents(120_000),
      acquiredOn: null,
      monthlyNetCash: [],
      exitValueCents: cents(180_000),
      exitDate: '2026-08-24',
    });
    expect(result.percent).toBeNull();
    expect(result.reason).toContain('acquisition date');
  });

  it('flags an IRR that ends in an estimate rather than a sale', () => {
    const result = propertyIrr({
      cashInvestedCents: cents(120_000),
      acquiredOn: '2025-01-01',
      monthlyNetCash: [
        { month: '2025-06', netCashCents: cents(3_000) },
        { month: '2025-12', netCashCents: cents(3_000) },
      ],
      exitValueCents: cents(160_000),
      exitDate: '2026-08-24',
    });
    expect(result.percent).not.toBeNull();
    expect(result.usesEstimatedExit).toBe(true);
  });
});
