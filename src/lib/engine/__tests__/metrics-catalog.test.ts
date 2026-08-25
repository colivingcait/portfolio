import { describe, expect, it } from 'vitest';
import { METRICS, RANGES, monthsInRange, shortMonth } from '../metrics-catalog';

const MONTHS = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];

describe('monthsInRange', () => {
  it('takes the last N months for a fixed span', () => {
    expect(monthsInRange(MONTHS, '3m')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthsInRange(MONTHS, '6m')).toEqual(MONTHS.slice(1));
  });

  it('does not invent months when the span is longer than the data', () => {
    expect(monthsInRange(MONTHS, '12m')).toEqual(MONTHS);
    expect(monthsInRange(['2026-03'], '12m')).toEqual(['2026-03']);
  });

  it('reads YTD off the latest month, not off today', () => {
    // The books can be months behind; a year-to-date that jumps to the current
    // calendar year would come back empty for no visible reason.
    expect(monthsInRange(MONTHS, 'ytd')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('returns everything for all', () => {
    expect(monthsInRange(MONTHS, 'all')).toEqual(MONTHS);
  });

  it('bounds a custom range inclusively', () => {
    expect(monthsInRange(MONTHS, 'custom', { from: '2025-11', to: '2026-01' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('tolerates a custom range picked backwards', () => {
    expect(monthsInRange(MONTHS, 'custom', { from: '2026-01', to: '2025-11' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('leaves an unset end of a custom range open', () => {
    expect(monthsInRange(MONTHS, 'custom', { from: '2026-02' })).toEqual(['2026-02', '2026-03']);
    expect(monthsInRange(MONTHS, 'custom', { to: '2025-10' })).toEqual(['2025-09', '2025-10']);
  });

  it('never throws on no data', () => {
    for (const range of RANGES) expect(monthsInRange([], range.key)).toEqual([]);
  });

  it('only ever returns months that exist', () => {
    const sparse = ['2025-09', '2026-03'];
    expect(monthsInRange(sparse, 'custom', { from: '2025-09', to: '2026-03' })).toEqual(sparse);
  });
});

describe('shortMonth', () => {
  it('shortens a month key to something an axis can hold', () => {
    expect(shortMonth('2026-01')).toBe('Jan 26');
    expect(shortMonth('2025-12')).toBe('Dec 25');
  });
});

describe('METRICS', () => {
  it('has a unique key per metric', () => {
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
  });

  it('explains every metric, because a figure nobody can define is a figure nobody should act on', () => {
    for (const metric of METRICS) expect(metric.note.length).toBeGreaterThan(20);
  });
});
