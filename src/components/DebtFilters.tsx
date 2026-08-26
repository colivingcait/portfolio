'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DEBT_HORIZONS, DEBT_KINDS, DEBT_VIEWS, type DebtHorizon, type DebtKind, type DebtView } from '@/lib/engine/payouts';

/**
 * How far ahead, and which lenders.
 *
 * Two separate questions and so two separate rows of buttons rather than one
 * combined menu: the span you are planning over has nothing to do with who you
 * owe, and pairing them would make nine options out of two choices.
 */
export function DebtFilters({ horizon, kind, view }: { horizon: DebtHorizon; kind: DebtKind; view: DebtView }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) query.set(key, value);
    router.push(`${pathname}?${query.toString()}`);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
      <span className="flex items-center gap-1">
        <span className="mr-1 text-[11px] text-muted">Lenders</span>
        {DEBT_KINDS.map((option) => (
          <button
            key={option.key}
            type="button"
            title={option.hint}
            aria-pressed={option.key === kind}
            onClick={() => go({ kind: option.key })}
            className={`rounded px-2 py-1 text-[12px] transition-colors ${
              option.key === kind ? 'bg-text text-surface' : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {option.label}
          </button>
        ))}
      </span>

      <span className="flex items-center gap-1">
        <span className="mr-1 text-[11px] text-muted">Owed</span>
        {DEBT_VIEWS.map((option) => (
          <button
            key={option.key}
            type="button"
            title={option.hint}
            aria-pressed={option.key === view}
            onClick={() => go({ view: option.key })}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              option.key === view ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
            }`}
          >
            {option.label}
          </button>
        ))}
      </span>

      <span className="flex items-center gap-1">
        <span className="mr-1 text-[11px] text-muted">Showing</span>
        {DEBT_HORIZONS.map((option) => (
          <button
            key={option.key}
            type="button"
            title={option.hint}
            aria-pressed={option.key === horizon}
            onClick={() => go({ horizon: option.key })}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              option.key === horizon ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
            }`}
          >
            {option.label}
          </button>
        ))}
      </span>
    </div>
  );
}
