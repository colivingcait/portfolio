import { describe, expect, it } from 'vitest';
import {
  DIRECTIONAL_PAIRS,
  category,
  expectedDirection,
  mergeCatalog,
  oppositeCategory,
} from '../categories';

describe('categories that come in signed pairs', () => {
  it('pairs an owner draw with an owner contribution both ways', () => {
    expect(oppositeCategory('owner_draw')).toEqual({ key: 'owner_contribution', direction: 'credit' });
    expect(oppositeCategory('owner_contribution')).toEqual({ key: 'owner_draw', direction: 'debit' });
  });

  it('knows which way money moves for each half', () => {
    expect(expectedDirection('owner_draw')).toBe('debit');
    expect(expectedDirection('owner_contribution')).toBe('credit');
    expect(expectedDirection('electric')).toBeNull();
  });

  it('has no opposite for a category that only moves one way', () => {
    expect(oppositeCategory('electric')).toBeNull();
  });

  it('names only categories that actually exist', () => {
    for (const pair of DIRECTIONAL_PAIRS) {
      expect(category(pair.debit), pair.debit).toBeTruthy();
      expect(category(pair.credit), pair.credit).toBeTruthy();
    }
  });
});

describe('the merged catalog', () => {
  it('keeps a custom category alongside the built-ins', () => {
    const merged = mergeCatalog([
      { key: 'pool_service', label: 'Pool service', class: 'expense', taxTreatment: 'deductible', taxLine: 'cleaning_maintenance' },
    ]);
    expect(category('pool_service', merged)?.label).toBe('Pool service');
    expect(category('electric', merged)?.label).toBe('Electric');
  });
});
