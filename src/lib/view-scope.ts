import 'server-only';
import { prisma } from './db';
import { currentMonth } from './queries';
import { shortMonth } from './engine/metrics-catalog';
import {
  DEFAULT_PERIOD,
  isPeriodKey,
  monthOptions,
  resolvePeriod,
  type PeriodKey,
  type ResolvedPeriod,
} from './engine/period';

/**
 * What the period and property controls resolve to, for whichever screen.
 *
 * Both pages read the same four search params and get back the same shape, so
 * a link carries from one to the other and the two never disagree about what
 * "last quarter" covers — even though the overview applies it to payout months
 * and operations to earnings months.
 */
export interface ViewScope {
  period: ResolvedPeriod;
  periodKey: PeriodKey;
  from: string;
  to: string;
  monthOptions: string[];
  properties: { id: string; name: string }[];
  propertyId: string | null;
  propertyName: string | null;
  /** The range in words, for the corner of the control bar. */
  summary: string;
}

export interface ScopeParams {
  period?: string;
  from?: string;
  to?: string;
  property?: string;
}

export async function resolveScope(params: ScopeParams, available: readonly string[]): Promise<ViewScope> {
  const properties = await prisma.property.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const periodKey: PeriodKey = isPeriodKey(params.period) ? params.period : DEFAULT_PERIOD;
  const options = monthOptions(available);
  const fallback = options[options.length - 1] ?? currentMonth();
  const from = params.from && options.includes(params.from) ? params.from : (options[0] ?? fallback);
  const to = params.to && options.includes(params.to) ? params.to : fallback;

  const period = resolvePeriod(periodKey, currentMonth(), available, { from, to });
  const propertyId = params.property && properties.some((p) => p.id === params.property) ? params.property : null;

  return {
    period,
    periodKey,
    from,
    to,
    monthOptions: options,
    properties,
    propertyId,
    propertyName: properties.find((p) => p.id === propertyId)?.name ?? null,
    summary: summarize(period),
  };
}

function summarize(period: ResolvedPeriod): string {
  if (period.months.length === 0) return 'no data in this period';

  const first = period.months[0];
  const last = period.months[period.months.length - 1];
  const range =
    first === last ? shortMonth(first) : `${shortMonth(first)} – ${shortMonth(last)} · ${period.months.length} months`;

  // Said plainly rather than left to be discovered: a month that has not ended
  // is not a low month, it is an unfinished one.
  if (period.openMonths.length > 0) {
    return `${range} · ${shortMonth(period.openMonths[0])} still in progress`;
  }
  return range;
}
