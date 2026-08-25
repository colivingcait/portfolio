'use client';

import { useState, useTransition } from 'react';
import { recomputeStoredFigures } from '@/lib/rollups-actions';

/**
 * The dashboard reads stored monthly figures rather than recomputing them on
 * every view. That is right for a page joining bank, platform and debt, but it
 * means a change to how a figure is derived leaves the stored ones showing the
 * old definition. This rebuilds them from what has already been imported —
 * nothing is re-read from a file, and nothing you have categorised is touched.
 */
export function RecomputeButton() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await recomputeStoredFigures();
            setDone(`Rebuilt ${result.months} property-months across ${result.properties} properties.`);
          })
        }
        className="rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? 'Rebuilding…' : 'Rebuild stored figures'}
      </button>
      {done ? <span className="text-[11px] text-muted">{done}</span> : null}
    </div>
  );
}
