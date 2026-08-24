import { formatCents, formatPercent } from '@/lib/engine/money';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-6">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
        {subtitle ? <div className="mt-1 max-w-3xl text-[13px] text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-lg border border-line bg-surface">
      {title ? (
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[14px] font-medium">{title}</h2>
            {description ? <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * A caveat the spec insists the interface state out loud — an unverified
 * property table, a total that crosses entities, a chart that crosses a
 * management boundary. These are not decoration; a number without them is
 * misleading.
 */
export function Note({ tone = 'warn', children }: { tone?: 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  const toneClass =
    tone === 'bad'
      ? 'border-bad/40 bg-bad/10 text-bad'
      : tone === 'warn'
        ? 'border-warn/30 bg-warn/10 text-warn'
        : 'border-line bg-surface-2 text-muted';
  return <div className={`mb-4 rounded-md border px-3 py-2 text-[12px] leading-relaxed ${toneClass}`}>{children}</div>;
}

export function Money({ cents, muted = false }: { cents: number | null | undefined; muted?: boolean }) {
  if (cents === null || cents === undefined) return <span className="num text-muted">—</span>;
  const negative = cents < 0;
  return (
    <span className={`num ${negative ? 'text-bad' : muted ? 'text-muted' : ''}`}>{formatCents(cents)}</span>
  );
}

export function Pct({ value, digits = 1 }: { value: number | null; digits?: number }) {
  return <span className="num">{formatPercent(value, digits)}</span>;
}

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const toneClass = {
    muted: 'border-line text-muted',
    good: 'border-good/40 text-good',
    warn: 'border-warn/40 text-warn',
    bad: 'border-bad/40 text-bad',
    accent: 'border-accent/40 text-accent',
  }[tone];
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted">{children}</p>;
}

export function Th({ children, right = false }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`border-b border-line px-2 py-2 ${right ? 'text-right' : ''}`}>{children}</th>;
}

export function Td({ children, right = false, className = '' }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={`border-b border-line/60 px-2 py-2 ${right ? 'num' : ''} ${className}`}>{children}</td>
  );
}
