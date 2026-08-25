import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  DIRECTIONAL_PAIRS,
  affectsPnl,
  category,
  expectedDirection,
  isCapitalizable,
  isExpense,
  mergeCatalog,
  oppositeCategory,
  taxLineFor,
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
      expect(category(pair.debit, CATEGORIES), pair.debit).toBeTruthy();
      expect(category(pair.credit, CATEGORIES), pair.credit).toBeTruthy();
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

describe('a category someone added themselves', () => {
  // The bug this pins: a rule for a new Phone category came back
  // "Unknown category: phone" while the picker was offering it. The lookup had
  // an optional catalog that fell back to the built-ins, and one caller — the
  // one behind the confirm-and-remember button — had forgotten to pass it.
  const withPhone = mergeCatalog([
    { key: 'phone', label: 'Phone', class: 'expense', taxTreatment: 'deductible', taxLine: 'utilities' },
  ]);

  it('is not in the built-ins, which is the whole point', () => {
    expect(category('phone', CATEGORIES)).toBeNull();
  });

  it('is found in the merged catalog', () => {
    expect(category('phone', withPhone)?.label).toBe('Phone');
  });

  it('behaves exactly like one shipped in code, including at year end', () => {
    expect(isExpense('phone', withPhone)).toBe(true);
    expect(affectsPnl('phone', withPhone)).toBe(true);
    expect(taxLineFor('phone', withPhone)).toBe('utilities');
    expect(isCapitalizable('phone', withPhone)).toBe(false);
  });
});
