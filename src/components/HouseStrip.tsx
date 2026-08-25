import { Sparkline } from './charts';
import { formatCents } from '@/lib/engine/money';

export interface Metric {
  label: string;
  /** Null where the month has no answer — a break in the line, not a zero. */
  points: { label: string; value: number | null }[];
  format: (value: number) => string;
  /** Shown large beside the label: the latest month with an answer. */
  latest: string;
  hint?: string;
  tone?: 'muted' | 'bad';
}

/**
 * One house, its metrics side by side, scrolled or swiped through.
 *
 * Six charts stacked vertically per house is a page nobody reaches the bottom
 * of; six across is a row nobody can read. Scroll-snap gives the whole set in
 * one band — swipe on a phone, trackpad or shift-scroll on a desktop — with
 * each card landing square. It needs no JavaScript, which means it works in
 * the server-rendered page like everything else here.
 */
export function HouseStrip({ name, color, metrics }: { name: string; color: string; metrics: Metric[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 border-b border-line pb-1.5">
        <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
        <span className="text-[13px] font-medium">{name}</span>
        <span className="ml-auto text-[11px] text-muted">swipe or scroll →</span>
      </div>

      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="w-[200px] shrink-0 snap-start rounded-md border border-line px-3 py-2.5"
          >
            <div className="text-[11px] uppercase tracking-wide text-muted">{metric.label}</div>
            <div className={`num mt-0.5 text-[16px] ${metric.tone === 'bad' ? 'text-bad' : ''}`}>{metric.latest}</div>
            <div className="mt-1.5">
              <Sparkline
                points={metric.points}
                color={color}
                width={176}
                height={34}
                format={metric.format}
              />
            </div>
            {metric.hint ? <div className="mt-1 text-[10px] leading-snug text-muted">{metric.hint}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The latest month that has an answer, formatted, or a dash. */
export function latestOf(points: { value: number | null }[], format: (v: number) => string): string {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const value = points[i].value;
    if (value !== null) return format(value);
  }
  return '—';
}

export const money = (v: number) => formatCents(v);
export const percent = (v: number) => `${v.toFixed(0)}%`;
export const count = (v: number) => String(Math.round(v));
