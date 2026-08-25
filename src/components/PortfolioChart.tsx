'use client';

import { useMemo, useState } from 'react';
import { formatCents } from '@/lib/engine/money';
import {
  METRICS,
  RANGES,
  monthsInRange,
  shortMonth,
  type MetricUnit,
  type RangeKey,
} from '@/lib/engine/metrics-catalog';

/**
 * One chart, reconfigured, rather than a wall of charts.
 *
 * Every measure the operating data holds is on the same axes; you pick which
 * one and over what span. That is deliberate: a page of small charts with no
 * timeframe and no scale is a texture, not a report — you cannot ask it a
 * question. This you can.
 *
 * Colour follows the house and never the rank, so a house keeps its hue as you
 * change metric. Two of the four palette colours sit under 3:1 on white, so the
 * legend is always present and every value is available as text in the tooltip;
 * hue is never the only thing carrying identity.
 */

export const PORTFOLIO = '__portfolio';

export interface ChartHouse {
  name: string;
  color: string;
}

export interface PortfolioChartProps {
  months: string[];
  houses: ChartHouse[];
  /** metric key → house name → one value per month, aligned to `months`. */
  values: Record<string, Record<string, (number | null)[]>>;
  /** metric key → the portfolio figure per month, correctly weighted. */
  totals: Record<string, (number | null)[]>;
}

const W = 900;
const H = 300;
const PAD = { top: 16, right: 20, bottom: 34, left: 62 };

export function PortfolioChart({ months, houses, values, totals }: PortfolioChartProps) {
  const [metricKey, setMetricKey] = useState(METRICS[0].key);
  const [range, setRange] = useState<RangeKey>(months.length > 12 ? '12m' : 'all');
  const [from, setFrom] = useState(months[0] ?? '');
  const [to, setTo] = useState(months[months.length - 1] ?? '');
  const [hidden, setHidden] = useState<Set<string>>(new Set([PORTFOLIO]));
  const [hover, setHover] = useState<number | null>(null);

  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];
  const shown = useMemo(() => monthsInRange(months, range, { from, to }), [months, range, from, to]);

  // Every series, in draw order: houses first, the portfolio total last so it
  // sits on top of them.
  const series = useMemo(() => {
    const slice = (all: (number | null)[] | undefined) =>
      shown.map((month) => all?.[months.indexOf(month)] ?? null);

    return [
      ...houses.map((house) => ({
        id: house.name,
        label: house.name,
        color: house.color,
        dashed: false,
        points: slice(values[metric.key]?.[house.name]),
      })),
      {
        id: PORTFOLIO,
        label: 'Portfolio',
        color: 'var(--color-text)',
        dashed: true,
        points: slice(totals[metric.key]),
      },
    ];
  }, [houses, values, totals, metric.key, shown, months]);

  const visible = series.filter((s) => !hidden.has(s.id));
  const plotted = visible.filter((s) => s.points.some((v) => v !== null));

  const toggle = (id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      // The guard: emptying the chart is never what someone meant to do.
      else if (series.length - next.size > 1) next.add(id);
      return next;
    });
  };

  const all = plotted.flatMap((s) => s.points).filter((v): v is number => v !== null);
  const scale = niceScale(
    // Money and counts read against zero; a rate does not, because the
    // interesting range of a collection rate is 80–110, not 0–110.
    metric.unit === 'percent' ? Math.min(...all) : Math.min(0, ...all),
    all.length ? Math.max(...all) : 1,
  );

  const x = (i: number) =>
    PAD.left + (shown.length <= 1 ? (W - PAD.left - PAD.right) / 2 : (i / (shown.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) =>
    PAD.top + (1 - (v - scale.min) / (scale.max - scale.min || 1)) * (H - PAD.top - PAD.bottom);

  const every = Math.max(1, Math.ceil(shown.length / 12));

  const pointerMonth = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * W;
    if (shown.length <= 1) return 0;
    const step = (W - PAD.left - PAD.right) / (shown.length - 1);
    const index = Math.round((at - PAD.left) / step);
    return Math.min(shown.length - 1, Math.max(0, index));
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetricKey(m.key)}
            aria-pressed={m.key === metric.key}
            className={`rounded px-2 py-1 text-[12px] transition-colors ${
              m.key === metric.key ? 'bg-text text-surface' : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={r.key === range}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                r.key === range ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {range === 'custom' ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <MonthPicker months={months} value={from} onChange={setFrom} label="From" />
            <span>to</span>
            <MonthPicker months={months} value={to} onChange={setTo} label="To" />
          </div>
        ) : null}

        <span className="ml-auto text-[11px] text-muted">
          {shown.length === 0
            ? 'no months in range'
            : shown.length === 1
              ? shortMonth(shown[0])
              : `${shortMonth(shown[0])} – ${shortMonth(shown[shown.length - 1])} · ${shown.length} months`}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => {
          const off = hidden.has(s.id);
          const last = !off && series.length - hidden.size === 1;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              aria-pressed={!off}
              title={last ? 'The last visible series stays on' : off ? `Show ${s.label}` : `Hide ${s.label}`}
              className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:bg-surface-2 ${
                off ? 'opacity-40' : ''
              } ${last ? 'cursor-default' : ''}`}
            >
              <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: off ? 'var(--color-muted)' : s.color }}
              />
              <span className={off ? 'text-muted line-through' : ''}>{s.label}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 || plotted.length === 0 ? (
        <p className="py-16 text-center text-[12px] text-muted">Nothing to plot over this range.</p>
      ) : (
        <div className="overflow-x-auto">
        <div className="relative" style={{ minWidth: 720 }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ height: 'auto' }}
            role="img"
            aria-label={`${metric.label} by property, ${shown.length} months`}
            onMouseMove={(e) => setHover(pointerMonth(e))}
            onMouseLeave={() => setHover(null)}
          >
            {scale.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={tick === 0 && scale.min < 0 ? 'var(--color-line)' : 'var(--color-grid)'}
                  strokeWidth={tick === 0 && scale.min < 0 ? 1.5 : 1}
                />
                <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">
                  {axisLabel(tick, metric.unit)}
                </text>
              </g>
            ))}

            {shown.map((month, i) =>
              i % every === 0 || i === shown.length - 1 ? (
                <text key={month} x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                  {shortMonth(month)}
                </text>
              ) : null,
            )}

            {hover !== null ? (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--color-grid)"
                strokeWidth={1.5}
              />
            ) : null}

            {plotted.map((s) => (
              <g key={s.id}>
                {runsOf(s.points).map((run, index) => (
                  <polyline
                    key={index}
                    points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.dashed ? 1.75 : 2}
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                {/* A run of one has no line to draw, so it needs a mark. */}
                {runsOf(s.points)
                  .filter((run) => run.length === 1)
                  .map((run) => (
                    <circle key={`solo-${run[0].i}`} cx={x(run[0].i)} cy={y(run[0].v)} r={3} fill={s.color} />
                  ))}
                {hover !== null && s.points[hover] !== null ? (
                  <circle
                    cx={x(hover)}
                    cy={y(s.points[hover] as number)}
                    r={4}
                    fill={s.color}
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            ))}
          </svg>

          {hover !== null ? (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-[168px] rounded-md border border-line bg-surface px-2.5 py-2 shadow-[0_4px_12px_rgba(16,24,40,0.12)]"
              style={{
                left: `${(x(hover) / W) * 100}%`,
                transform: `translateX(${x(hover) > W / 2 ? 'calc(-100% - 12px)' : '12px'})`,
              }}
            >
              <div className="mb-1 text-[11px] font-medium">{shortMonth(shown[hover])}</div>
              {plotted
                .map((s) => ({ ...s, value: s.points[hover] }))
                .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
                .map((s) => (
                  <div key={s.id} className="flex items-baseline justify-between gap-4 text-[11px] leading-relaxed">
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <span className="num">{s.value === null ? '—' : formatValue(s.value, metric.unit)}</span>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-muted">{metric.note}</p>
    </div>
  );
}

function MonthPicker({
  months,
  value,
  onChange,
  label,
}: {
  months: string[];
  value: string;
  onChange: (month: string) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px]"
    >
      {months.map((month) => (
        <option key={month} value={month}>
          {shortMonth(month)}
        </option>
      ))}
    </select>
  );
}

/** Unbroken stretches, so a month with no data is a gap and not a zero. */
function runsOf(points: (number | null)[]): { i: number; v: number }[][] {
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  points.forEach((value, i) => {
    if (value === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v: value });
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

/** Round tick values, so the axis reads 0 / 10k / 20k rather than 0 / 8,412. */
function niceScale(min: number, max: number, want = 4): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) max = min + Math.abs(min || 1);

  const raw = (max - min) / want;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;

  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = low; v <= high + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min: low, max: high, ticks };
}

/** Axis labels are short by necessity: $12k, not $12,431.09. */
function axisLabel(value: number, unit: MetricUnit): string {
  if (unit === 'percent') return `${Math.round(value)}%`;
  if (unit === 'count') return String(Math.round(value));

  const dollars = value / 100;
  const sign = dollars < 0 ? '-' : '';
  const size = Math.abs(dollars);
  if (size >= 1000) {
    const thousands = size / 1000;
    return `${sign}$${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  return `${sign}$${Math.round(size)}`;
}

/** Tooltips are exact: that is the point of reading one. */
function formatValue(value: number, unit: MetricUnit): string {
  if (unit === 'money') return formatCents(Math.round(value));
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  return String(Math.round(value));
}
