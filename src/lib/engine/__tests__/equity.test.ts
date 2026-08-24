import { describe, expect, it } from 'vitest';
import {
  propertyEquity,
  saleWaterfall,
  totalEquity,
  valuationAge,
  valuationAsOf,
  type Valuation,
} from '../equity';
import { cents } from '../money';

const RAVEN = 'property:raven';
const ME = 'entity:me';
const INVESTOR = 'entity:investor';

const valuations: Valuation[] = [
  { id: '1', propertyId: RAVEN, date: '2025-04-01', valueCents: cents(300_000), source: 'purchase' },
  { id: '2', propertyId: RAVEN, date: '2026-03-15', valueCents: cents(365_000), source: 'appraisal' },
  { id: '3', propertyId: 'property:other', date: '2026-01-01', valueCents: cents(200_000), source: 'avm' },
];

describe('reading a value as of a date', () => {
  it('takes the most recent estimate on or before the date', () => {
    expect(valuationAsOf(valuations, RAVEN, '2026-08-24')?.valueCents).toBe(cents(365_000));
  });

  it('does not use an estimate from the future', () => {
    // Looking at March 2026 should not see an appraisal dated later that month.
    expect(valuationAsOf(valuations, RAVEN, '2026-03-01')?.valueCents).toBe(cents(300_000));
  });

  it('returns nothing for a property that has never been valued', () => {
    expect(valuationAsOf(valuations, 'property:unvalued', '2026-08-24')).toBeNull();
  });

  it('flags an estimate more than a year old as stale', () => {
    const fresh = valuationAge(valuations[1], '2026-08-24');
    expect(fresh?.stale).toBe(false);
    const old = valuationAge(valuations[0], '2026-08-24');
    expect(old?.stale).toBe(true);
    expect(old?.days).toBe(510);
  });
});

describe('equity at property level', () => {
  it('is value less debt, with LTV', () => {
    const equity = propertyEquity({
      propertyId: RAVEN,
      valueCents: cents(365_000),
      debtBalanceCents: cents(180_000),
      sharePercent: 50,
    });
    expect(equity.equityCents).toBe(cents(185_000));
    expect(equity.ltvPercent).toBeCloseTo(49.3, 1);
    expect(equity.shareOfEquityCents).toBe(cents(92_500));
  });

  it('reports negative equity rather than hiding it', () => {
    const equity = propertyEquity({
      propertyId: RAVEN,
      valueCents: cents(150_000),
      debtBalanceCents: cents(180_000),
      sharePercent: 100,
    });
    expect(equity.equityCents).toBe(cents(-30_000));
    expect(equity.ltvPercent).toBe(120);
  });

  it('has no LTV to report where there is no value estimate', () => {
    expect(propertyEquity({ propertyId: RAVEN, valueCents: 0, debtBalanceCents: cents(180_000), sharePercent: 100 }).ltvPercent).toBeNull();
  });
});

describe('what a sale actually pays out', () => {
  const owners = [
    { entityId: ME, name: 'Owner', sharePercent: 50 },
    { entityId: INVESTOR, name: 'Investor', sharePercent: 50 },
  ];
  const capital = [{ entityId: INVESTOR, name: 'Investor', outstandingCents: cents(120_000) }];

  it('repays capital before splitting anything', () => {
    // 365,000 − 180,000 = 185,000 net; the investor's 120,000 comes out first,
    // leaving 65,000 to halve.
    const result = saleWaterfall({
      valueCents: cents(365_000),
      debtBalanceCents: cents(180_000),
      capital,
      owners,
    });
    expect(result.netProceedsCents).toBe(cents(185_000));
    expect(result.distributableCents).toBe(cents(65_000));

    const investor = result.rows.find((r) => r.entityId === INVESTOR)!;
    const me = result.rows.find((r) => r.entityId === ME)!;
    expect(investor.capitalReturnedCents).toBe(cents(120_000));
    expect(investor.profitShareCents).toBe(cents(32_500));
    expect(investor.totalCents).toBe(cents(152_500));
    expect(me.capitalReturnedCents).toBe(0);
    expect(me.totalCents).toBe(cents(32_500));
  });

  it('shows that half the equity is not what you walk away with', () => {
    // Half of 185,000 equity looks like 92,500. After the investor is repaid
    // it is 32,500 — the difference is money owed to someone else.
    const result = saleWaterfall({
      valueCents: cents(365_000),
      debtBalanceCents: cents(180_000),
      capital,
      owners,
    });
    expect(result.rows.find((r) => r.entityId === ME)!.totalCents).toBeLessThan(cents(92_500));
  });

  it('takes selling costs off the top', () => {
    const result = saleWaterfall({
      valueCents: cents(365_000),
      debtBalanceCents: cents(180_000),
      sellingCostsPercent: 8,
      capital,
      owners,
    });
    expect(result.sellingCostsCents).toBe(cents(29_200));
    expect(result.netProceedsCents).toBe(cents(155_800));
    expect(result.distributableCents).toBe(cents(35_800));
  });

  it('repays capital pro rata and pays no profit when proceeds fall short', () => {
    const result = saleWaterfall({
      valueCents: cents(250_000),
      debtBalanceCents: cents(180_000),
      capital: [
        { entityId: INVESTOR, name: 'Investor', outstandingCents: cents(120_000) },
        { entityId: 'entity:third', name: 'Third', outstandingCents: cents(40_000) },
      ],
      owners,
    });
    expect(result.capitalShortfall).toBe(true);
    expect(result.netProceedsCents).toBe(cents(70_000));
    // 70,000 split 120:40 — three quarters and one quarter.
    expect(result.rows.find((r) => r.entityId === INVESTOR)!.capitalReturnedCents).toBe(cents(52_500));
    expect(result.rows.find((r) => r.entityId === 'entity:third')!.capitalReturnedCents).toBe(cents(17_500));
    expect(result.rows.every((r) => r.profitShareCents === 0)).toBe(true);
  });

  it('splits everything as profit where nobody put capital in', () => {
    const result = saleWaterfall({
      valueCents: cents(365_000),
      debtBalanceCents: cents(180_000),
      capital: [],
      owners,
    });
    expect(result.rows.every((r) => r.capitalReturnedCents === 0)).toBe(true);
    expect(result.rows.map((r) => r.profitShareCents)).toEqual([cents(92_500), cents(92_500)]);
  });
});

describe('portfolio totals', () => {
  it('counts debt on unvalued properties but does not invent a value for them', () => {
    const totals = totalEquity([
      { ...propertyEquity({ propertyId: 'a', valueCents: cents(365_000), debtBalanceCents: cents(180_000), sharePercent: 50 }), valued: true, stale: false },
      { ...propertyEquity({ propertyId: 'b', valueCents: 0, debtBalanceCents: cents(90_000), sharePercent: 100 }), valued: false, stale: false },
    ]);
    expect(totals.valueCents).toBe(cents(365_000));
    expect(totals.debtBalanceCents).toBe(cents(270_000));
    expect(totals.unvaluedCount).toBe(1);
  });

  it('counts how many estimates have gone stale', () => {
    const totals = totalEquity([
      { ...propertyEquity({ propertyId: 'a', valueCents: cents(100_000), debtBalanceCents: 0, sharePercent: 100 }), valued: true, stale: true },
      { ...propertyEquity({ propertyId: 'b', valueCents: cents(100_000), debtBalanceCents: 0, sharePercent: 100 }), valued: true, stale: false },
    ]);
    expect(totals.staleCount).toBe(1);
  });
});
