import { describe, expect, it } from 'vitest';
import {
  effectiveShare,
  effectiveShares,
  findCycles,
  findTotalsWarnings,
  wouldCreateCycle,
  type OwnershipInterest,
} from '../ownership';

const ME = 'person:me';
const LUSTRA = 'entity:lustra';
const PARTNER = 'person:partner';
const HOUSE = 'property:candace';

function interest(over: Partial<OwnershipInterest> & Pick<OwnershipInterest, 'id' | 'ownerId' | 'ownedId' | 'ownedType' | 'percent'>): OwnershipInterest {
  return {
    startDate: '2020-01-01',
    endDate: null,
    basis: 'equity',
    ...over,
  };
}

describe('effective share (§3)', () => {
  it('multiplies through a nested holding: 50% of a property held by an entity you hold 50% of is 25%', () => {
    const interests = [
      interest({ id: '1', ownerId: LUSTRA, ownedId: HOUSE, ownedType: 'property', percent: 50 }),
      interest({ id: '2', ownerId: ME, ownedId: LUSTRA, ownedType: 'entity', percent: 50 }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01').percent).toBe(25);
  });

  it('sums across every path: 25% through the entity plus 10% held directly is 35%', () => {
    const interests = [
      interest({ id: '1', ownerId: LUSTRA, ownedId: HOUSE, ownedType: 'property', percent: 50 }),
      interest({ id: '2', ownerId: ME, ownedId: LUSTRA, ownedType: 'entity', percent: 50 }),
      interest({ id: '3', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 10 }),
    ];
    const share = effectiveShare(interests, ME, HOUSE, '2026-08-01');
    expect(share.percent).toBe(35);
    expect(share.paths).toHaveLength(2);
  });

  it('generalizes to any depth', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: 'entity:a', ownedType: 'entity', percent: 50 }),
      interest({ id: '2', ownerId: 'entity:a', ownedId: 'entity:b', ownedType: 'entity', percent: 50 }),
      interest({ id: '3', ownerId: 'entity:b', ownedId: 'entity:c', ownedType: 'entity', percent: 40 }),
      interest({ id: '4', ownerId: 'entity:c', ownedId: HOUSE, ownedType: 'property', percent: 100 }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01').percent).toBeCloseTo(10, 10);
  });

  it('respects dates, so a partner buying out is a new record and history stays intact', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 50, startDate: '2024-01-01', endDate: '2026-06-30' }),
      interest({ id: '2', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 100, startDate: '2026-07-01' }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-05-31').percent).toBe(50);
    expect(effectiveShare(interests, ME, HOUSE, '2026-07-01').percent).toBe(100);
  });

  it('returns zero for a property you do not reach', () => {
    const interests = [
      interest({ id: '1', ownerId: PARTNER, ownedId: HOUSE, ownedType: 'property', percent: 100 }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01').percent).toBe(0);
  });

  it('maps every property a viewer reaches', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: LUSTRA, ownedType: 'entity', percent: 100 }),
      interest({ id: '2', ownerId: LUSTRA, ownedId: HOUSE, ownedType: 'property', percent: 100 }),
      interest({ id: '3', ownerId: LUSTRA, ownedId: 'property:raven', ownedType: 'property', percent: 50 }),
      interest({ id: '4', ownerId: PARTNER, ownedId: 'property:other', ownedType: 'property', percent: 100 }),
    ];
    const shares = effectiveShares(interests, ME, '2026-08-01');
    expect(shares.get(HOUSE)?.percent).toBe(100);
    expect(shares.get('property:raven')?.percent).toBe(50);
    expect(shares.has('property:other')).toBe(false);
  });
});

describe('equity versus distributions (§3)', () => {
  it('follows equity when no distribution split is recorded', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 50 }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01', 'distribution').percent).toBe(50);
  });

  it('lets a distribution percentage override equity for cash', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 50, distributionPercent: 70 }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01', 'equity').percent).toBe(50);
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01', 'distribution').percent).toBe(70);
  });

  it('lets a separate distribution record override the equity record', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 50 }),
      interest({ id: '2', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 80, basis: 'distribution' }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01', 'equity').percent).toBe(50);
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01', 'distribution').percent).toBe(80);
  });
});

describe('validation (§3)', () => {
  it('warns rather than blocks when interests do not total 100% on a date', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 60 }),
    ];
    const warnings = findTotalsWarnings(interests, '2026-08-01');
    expect(warnings).toEqual([{ ownedId: HOUSE, ownedType: 'property', totalPercent: 60 }]);
  });

  it('does not warn when they total 100%, including thirds', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 33.333 }),
      interest({ id: '2', ownerId: PARTNER, ownedId: HOUSE, ownedType: 'property', percent: 33.333 }),
      interest({ id: '3', ownerId: 'person:third', ownedId: HOUSE, ownedType: 'property', percent: 33.334 }),
    ];
    expect(findTotalsWarnings(interests, '2026-08-01')).toEqual([]);
  });

  it('ignores interests that have ended', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: HOUSE, ownedType: 'property', percent: 100, endDate: '2025-12-31' }),
      interest({ id: '2', ownerId: PARTNER, ownedId: HOUSE, ownedType: 'property', percent: 100, startDate: '2026-01-01' }),
    ];
    expect(findTotalsWarnings(interests, '2026-08-01')).toEqual([]);
  });

  it('rejects cycles outright', () => {
    const interests = [
      interest({ id: '1', ownerId: 'entity:a', ownedId: 'entity:b', ownedType: 'entity', percent: 50 }),
      interest({ id: '2', ownerId: 'entity:b', ownedId: 'entity:a', ownedType: 'entity', percent: 50 }),
    ];
    expect(findCycles(interests).length).toBeGreaterThan(0);
  });

  it('detects a cycle before it is written', () => {
    const existing = [
      interest({ id: '1', ownerId: 'entity:a', ownedId: 'entity:b', ownedType: 'entity', percent: 50 }),
    ];
    expect(wouldCreateCycle(existing, { ownerId: 'entity:b', ownedId: 'entity:a', ownedType: 'entity' })).toBe(true);
    expect(wouldCreateCycle(existing, { ownerId: 'entity:a', ownedId: 'entity:a', ownedType: 'entity' })).toBe(true);
    expect(wouldCreateCycle(existing, { ownerId: 'entity:b', ownedId: 'entity:c', ownedType: 'entity' })).toBe(false);
  });

  it('does not hang on a cycle when traversing', () => {
    const interests = [
      interest({ id: '1', ownerId: ME, ownedId: 'entity:a', ownedType: 'entity', percent: 100 }),
      interest({ id: '2', ownerId: 'entity:a', ownedId: 'entity:b', ownedType: 'entity', percent: 100 }),
      interest({ id: '3', ownerId: 'entity:b', ownedId: 'entity:a', ownedType: 'entity', percent: 100 }),
      interest({ id: '4', ownerId: 'entity:b', ownedId: HOUSE, ownedType: 'property', percent: 100 }),
    ];
    expect(effectiveShare(interests, ME, HOUSE, '2026-08-01').percent).toBe(100);
  });
});
