import { formatCents } from '@/lib/engine/money';

/**
 * Charts as server-rendered inline SVG.
 *
 * No charting library and no client component: these are static pictures of
 * numbers the server already has, and shipping a runtime to draw eight line
 * segments would cost more than it returns. Hover text rides on the SVG's own
 * <title>, which every browser renders without a line of JavaScript.
 *
 * Colour follows the entity, never its rank, so a property keeps the same hue
 * on every chart. Two series always carry a legend and direct labels — hue is
 * never the only thing telling them apart, which matters both for colour
 * blindness and because two of the four sit under 3:1 on white.
 */

export const SERIES = ['var(--color-series-1)', 'var(--color-series-2)', 'var(--color-series-3)', 'var(--color-series-4)'];
export const RAMP = ['var(--color-ramp-1)', 'var(--color-ramp-2)', 'var(--color-ramp-3)', 'var(--color-ramp-4)'];

/** The colour for one entity, stable across every chart on the site. */
export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

export interface Point {
  label: string;
  value: number | null;
}

/**
 * One series, small, inline in a table row.
 *
 * No axes and no legend by design: a sparkline answers "which way and how
 * steady", and the number beside it answers "how much". Gaps are breaks in the
 * line rather than zeroes — a month with no data is not a month of nothing.
 */
export function Sparkline({
  points,
  width = 132,
  height = 28,
  color = 'var(--color-series-1)',
  format = (v: number) => String(Math.round(v)),
}: {
  points: Point[];
  width?: number;
  height?: number;
  color?: string;
  format?: (value: number) => string;
}) {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return <span className="text-[11px] text-muted">no data</span>;

  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  // Breaks rather than a bridge across a gap.
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v: p.value });
    }
  });
  if (run.length) runs.push(run);

  const last = points.reduce<{ i: number; v: number } | null>(
    (found, p, i) => (p.value === null ? found : { i, v: p.value }),
    null,
  );

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${points.length} periods`}>
      {runs.map((segment, index) => (
        <polyline
          key={index}
          points={segment.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {points.map((p, i) =>
        p.value === null ? null : (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={5} fill="transparent">
            <title>{`${p.label}: ${format(p.value)}`}</title>
          </circle>
        ),
      )}
      {last ? (
        <circle cx={x(last.i)} cy={y(last.v)} r={3} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
      ) : null}
    </svg>
  );
}

export interface Series {
  label: string;
  color: string;
  points: Point[];
}

/**
 * Several series over the same periods, with the last value labelled directly.
 *
 * One y-axis, always. Two measures of different scale get two charts rather
 * than a second axis — a dual-axis chart lets the author choose which line
 * looks higher, which is not a property a chart should have.
 */
export function LineChart({
  series,
  labels,
  height = 180,
  format = (v: number) => String(Math.round(v)),
  suffix = '',
  zeroBased = true,
}: {
  series: Series[];
  labels: string[];
  height?: number;
  format?: (value: number) => string;
  suffix?: string;
  zeroBased?: boolean;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v !== null);
  if (all.length === 0) return <p className="py-6 text-center text-[12px] text-muted">Nothing to plot yet.</p>;

  const width = 760;
  const left = 44;
  const right = 74; // room for the direct end label
  const top = 10;
  const bottom = 26;

  const rawMax = Math.max(...all);
  const rawMin = zeroBased ? Math.min(0, ...all) : Math.min(...all);
  const max = rawMax === rawMin ? rawMax + 1 : rawMax;
  const min = rawMin;
  const x = (i: number) => left + (i / Math.max(1, labels.length - 1)) * (width - left - right);
  const y = (v: number) => top + (1 - (v - min) / (max - min)) * (height - top - bottom);

  const ticks = [min, min + (max - min) / 2, max];

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--color-grid)" strokeWidth={1} />
            <text x={left - 8} y={y(tick) + 4} textAnchor="end" fontSize={10} fill="var(--color-muted)">
              {format(tick)}
              {suffix}
            </text>
          </g>
        ))}

        {labels.map((label, i) =>
          i % Math.ceil(labels.length / 8) === 0 || i === labels.length - 1 ? (
            <text key={label} x={x(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
              {label.length > 5 ? label.slice(2) : label}
            </text>
          ) : null,
        )}

        {series.map((s) => {
          const runs: { i: number; v: number }[][] = [];
          let run: { i: number; v: number }[] = [];
          s.points.forEach((p, i) => {
            if (p.value === null) {
              if (run.length) runs.push(run);
              run = [];
            } else run.push({ i, v: p.value });
          });
          if (run.length) runs.push(run);
          const last = runs.at(-1)?.at(-1) ?? null;

          return (
            <g key={s.label}>
              {runs.map((segment, index) => (
                <polyline
                  key={index}
                  points={segment.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {s.points.map((p, i) =>
                p.value === null ? null : (
                  <circle key={i} cx={x(i)} cy={y(p.value)} r={7} fill="transparent">
                    <title>{`${s.label} · ${p.label}: ${format(p.value)}${suffix}`}</title>
                  </circle>
                ),
              )}
              {last ? (
                <>
                  <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
                  <text x={x(last.i) + 8} y={y(last.v) + 3.5} fontSize={10} fill="var(--color-muted)">
                    {format(last.v)}
                    {suffix}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Identity spelled out, so hue is never the only thing carrying it. */
export function Legend({ series }: { series: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * One bar, split into its parts, with a 2px gap in the surface colour between
 * segments so touching fills stay separable without a border.
 */
export function StackedBar({
  segments,
  height = 16,
}: {
  segments: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) return <div className="text-[11px] text-muted">Nothing to show.</div>;

  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded" style={{ height }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${formatCents(s.value)} (${((s.value / total) * 100).toFixed(0)}%)`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            className="first:rounded-l last:rounded-r"
          />
        ))}
    </div>
  );
}
