import { describe, expect, it } from 'vitest';
import { PERIODS, isPeriodKey, monthOptions, resolvePeriod } from '../period';

// Eight months of data, sitting in an unfinished August.
const AVAILABLE = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const NOW = '2026-08';

const months = (key: Parameters<typeof resolvePeriod>[0], custom?: { from?: string; to?: string }) =>
  resolvePeriod(key, NOW, AVAILABLE, custom).months;

describe('the periods every screen can be pointed at', () => {
  it('defaults to the last finished month, not the one in progress', () => {
    expect(months('last_month')).toEqual(['2026-07']);
    expect(PERIODS[0].key).toBe('last_month');
  });

  it('gives month to date exactly the month in progress', () => {
    expect(months('mtd')).toEqual(['2026-08']);
  });

  it('ends a rolling window at the last finished month', () => {
    // Not August: a three-month figure that silently included a part-month
    // would read as a fall every time it was opened mid-month.
    expect(months('l3m')).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(months('l12m')).toEqual(AVAILABLE.slice(0, 7));
  });

  it('runs quarter to date from the quarter’s first month', () => {
    expect(months('qtd')).toEqual(['2026-07', '2026-08']);
  });

  it('takes the whole previous quarter, complete', () => {
    expect(months('last_quarter')).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('runs year to date from January through the month in progress', () => {
    expect(months('ytd')).toEqual(AVAILABLE);
  });

  it('takes everything there is for all time', () => {
    expect(months('all')).toEqual(AVAILABLE);
  });

  it('never invents a month the data does not have', () => {
    // A rolling year of a two-month portfolio is two months.
    expect(resolvePeriod('l12m', NOW, ['2026-06', '2026-07']).months).toEqual(['2026-06', '2026-07']);
    expect(resolvePeriod('all', NOW, []).months).toEqual([]);
  });

  it('bounds a custom period inclusively, and tolerates it picked backwards', () => {
    expect(months('custom', { from: '2026-03', to: '2026-05' })).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(months('custom', { from: '2026-05', to: '2026-03' })).toEqual(['2026-03', '2026-04', '2026-05']);
  });

  it('flags the months that have not finished, so a total can say so', () => {
    expect(resolvePeriod('ytd', NOW, AVAILABLE).openMonths).toEqual(['2026-08']);
    expect(resolvePeriod('last_quarter', NOW, AVAILABLE).openMonths).toEqual([]);
    expect(resolvePeriod('l3m', NOW, AVAILABLE).openMonths).toEqual([]);
  });

  it('crosses a year boundary without arithmetic getting creative', () => {
    const jan = '2027-01';
    const across = ['2026-10', '2026-11', '2026-12', '2027-01'];
    expect(resolvePeriod('last_month', jan, across).months).toEqual(['2026-12']);
    expect(resolvePeriod('last_quarter', jan, across).months).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(resolvePeriod('ytd', jan, across).months).toEqual(['2027-01']);
  });

  it('keeps the bounds asked for even where no data reaches them', () => {
    const period = resolvePeriod('l12m', NOW, ['2026-07']);
    expect(period.from).toBe('2025-08');
    expect(period.to).toBe('2026-07');
    expect(period.months).toEqual(['2026-07']);
  });

  it('recognises its own keys and nothing else', () => {
    expect(isPeriodKey('ytd')).toBe(true);
    expect(isPeriodKey('last_fortnight')).toBe(false);
    expect(isPeriodKey(undefined)).toBe(false);
  });

  it('offers every month between the ends, gaps included', () => {
    expect(monthOptions(['2026-01', '2026-04'])).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(monthOptions([])).toEqual([]);
  });
});
