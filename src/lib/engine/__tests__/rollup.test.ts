import { describe, expect, it } from 'vitest';
import {
  applyShare,
  buildView,
  isNonProratable,
  isProratable,
  totalRollups,
  type PropertyRollup,
} from '../rollup';
import { cents } from '../money';

function rollup(over: Partial<PropertyRollup> = {}): PropertyRollup {
  return {
    propertyId: 'property:candace',
    month: '2026-08',
    entityId: 'entity:lustra',
    revenueCents: cents(8_000),
    platformFeesCents: 0,
    expectedDepositCents: 0,
    depositVarianceCents: 0,
    hostEarningsCents: cents(8_000),
    pmFeeCents: cents(1_050),
    ownerPaidOpexCents: cents(1_200),
    pmPaidOpexCents: cents(750),
    operatingExpenseCents: cents(3_000),
    noiCents: cents(5_000),
    depositReceivedCents: cents(6_200),
    debtServiceCents: cents(2_000),
    debtBalanceCents: cents(200_000),
    netCashCents: cents(3_000),
    roomsTotal: 8,
    roomsOccupied: 6,
    occupancyRate: 75,
    collectionRate: 96.4,
    delinquencyCents: cents(400),
    trueRoomRateCents: cents(700),
    ...over,
  };
}

describe('what pro-rates and what does not (§3)', () => {
  it('scales money by the effective share', () => {
    const viewed = applyShare(rollup(), 25);
    expect(viewed.revenueCents).toBe(cents(2_000));
    expect(viewed.noiCents).toBe(cents(1_250));
    expect(viewed.netCashCents).toBe(cents(750));
    expect(viewed.debtBalanceCents).toBe(cents(50_000));
  });

  it('leaves occupancy, collection rate, delinquency and true room rate untouched', () => {
    // Twenty-five percent of an occupancy rate is meaningless, and a view that
    // silently multiplies it corrupts every operational judgment made from it.
    const viewed = applyShare(rollup(), 25);
    expect(viewed.occupancyRate).toBe(75);
    expect(viewed.collectionRate).toBe(96.4);
    expect(viewed.delinquencyCents).toBe(cents(400));
    expect(viewed.trueRoomRateCents).toBe(cents(700));
    expect(viewed.roomsTotal).toBe(8);
    expect(viewed.roomsOccupied).toBe(6);
  });

  it('flags a row whose operational figures are undivided while its money is not', () => {
    expect(applyShare(rollup(), 25).operationalFiguresAreUndivided).toBe(true);
    expect(applyShare(rollup(), 100).operationalFiguresAreUndivided).toBe(false);
  });

  it('classifies each metric one way or the other, never both', () => {
    expect(isProratable('netCashCents')).toBe(true);
    expect(isNonProratable('netCashCents')).toBe(false);
    expect(isNonProratable('occupancyRate')).toBe(true);
    expect(isProratable('occupancyRate')).toBe(false);
  });
});

describe('totals', () => {
  it('recomputes occupancy from room counts rather than averaging rates', () => {
    const rows = [
      applyShare(rollup({ propertyId: 'a', roomsTotal: 8, roomsOccupied: 8, occupancyRate: 100 }), 100),
      applyShare(rollup({ propertyId: 'b', roomsTotal: 6, roomsOccupied: 3, occupancyRate: 50 }), 100),
    ];
    const totals = totalRollups(rows);
    expect(totals.roomsTotal).toBe(14);
    expect(totals.occupancyRate).toBeCloseTo((11 / 14) * 100, 10);
  });

  it('states when a consolidated total crosses entities', () => {
    const sameEntity = totalRollups([applyShare(rollup(), 100)]);
    expect(sameEntity.crossesEntities).toBe(false);

    const crossing = totalRollups([
      applyShare(rollup({ propertyId: 'a', entityId: 'entity:lustra' }), 100),
      applyShare(rollup({ propertyId: 'b', entityId: 'person:me' }), 100),
    ]);
    expect(crossing.crossesEntities).toBe(true);
    expect(crossing.entityIds).toEqual(['entity:lustra', 'person:me']);
  });
});

describe('one engine, five views (§3)', () => {
  const rollups = [
    rollup({ propertyId: 'a', entityId: 'entity:lustra' }),
    rollup({ propertyId: 'b', entityId: 'person:me' }),
  ];
  const shares = new Map([
    ['a', 25],
    ['b', 100],
  ]);

  it('shows every property at 100% in the portfolio view', () => {
    const { rows, totals } = buildView({ rollups, shares, view: { kind: 'portfolio' } });
    expect(rows.map((r) => r.sharePercent)).toEqual([100, 100]);
    expect(totals.revenueCents).toBe(cents(16_000));
  });

  it('applies effective percentages in the my-share view', () => {
    const { rows, totals } = buildView({ rollups, shares, view: { kind: 'my_share', viewerEntityId: 'person:me' } });
    expect(rows.map((r) => r.sharePercent)).toEqual([25, 100]);
    expect(totals.revenueCents).toBe(cents(2_000) + cents(8_000));
    // Occupancy still describes the houses, not the slice.
    expect(totals.roomsTotal).toBe(16);
  });

  it('shows one property undivided in the property view', () => {
    const { rows } = buildView({ rollups, shares, view: { kind: 'property', propertyId: 'a' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sharePercent).toBe(100);
    expect(rows[0].revenueCents).toBe(cents(8_000));
  });

  it('gives a partner only what they hold with you', () => {
    const partnerShares = new Map([['a', 50]]);
    const { rows } = buildView({ rollups, shares: partnerShares, view: { kind: 'partner', viewerEntityId: 'person:partner' } });
    expect(rows.map((r) => r.propertyId)).toEqual(['a']);
    expect(rows[0].revenueCents).toBe(cents(4_000));
  });
});
