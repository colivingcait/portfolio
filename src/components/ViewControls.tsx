'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PERIODS, type PeriodKey } from '@/lib/engine/period';
import { shortMonth } from '@/lib/engine/metrics-catalog';

/**
 * One bar, on every screen: what stretch of time, and which houses.
 *
 * Both live in the URL rather than in component state, so a view is a link —
 * it survives a reload, it can be sent to an accountant, and the server can
 * render the right numbers first time instead of shipping a month of data and
 * filtering it in the browser.
 */
export interface ViewControlsProps {
  period: PeriodKey;
  from: string;
  to: string;
  /** Every month there is data for, for the custom pickers. */
  monthOptions: string[];
  properties: { id: string; name: string }[];
  propertyId: string | null;
  /** What the period resolved to, said plainly beside the picker. */
  summary: string;
}

export function ViewControls({
  period,
  from,
  to,
  monthOptions,
  properties,
  propertyId,
  summary,
}: ViewControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    router.push(`${pathname}?${query.toString()}`);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
      <label className="flex items-center gap-1.5 text-[11px] text-muted">
        <span>Period</span>
        <select
          aria-label="Period"
          value={period}
          onChange={(e) => go({ period: e.target.value })}
          className="w-auto rounded border border-line bg-surface px-1.5 py-1 text-[12px] text-text"
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key} title={p.hint}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {period === 'custom' ? (
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <select
            aria-label="From"
            value={from}
            onChange={(e) => go({ from: e.target.value })}
            className="w-auto rounded border border-line bg-surface px-1.5 py-1 text-[12px] text-text"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{shortMonth(m)}</option>
            ))}
          </select>
          to
          <select
            aria-label="To"
            value={to}
            onChange={(e) => go({ to: e.target.value })}
            className="w-auto rounded border border-line bg-surface px-1.5 py-1 text-[12px] text-text"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>{shortMonth(m)}</option>
            ))}
          </select>
        </span>
      ) : null}

      <label className="flex items-center gap-1.5 text-[11px] text-muted">
        <span>Property</span>
        <select
          aria-label="Property"
          value={propertyId ?? 'all'}
          onChange={(e) => go({ property: e.target.value === 'all' ? null : e.target.value })}
          className="w-auto max-w-[220px] rounded border border-line bg-surface px-1.5 py-1 text-[12px] text-text"
        >
          <option value="all">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <span className="ml-auto text-[11px] text-muted">{summary}</span>
    </div>
  );
}
