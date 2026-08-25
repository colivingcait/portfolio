'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { repairRules } from '@/lib/rules-actions';

interface Props {
  /** Omit to mend every rule that catches nothing. */
  ruleId?: string;
  label?: string;
  preview?: string;
}

export function RepairRulesButton({ ruleId, label = 'Repair', preview }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const outcome = await repairRules(ruleId);
            setResult(
              outcome.repaired === 0
                ? 'Nothing to repair.'
                : `Repaired ${outcome.repaired} rule${outcome.repaired === 1 ? '' : 's'}` +
                    (outcome.categorized > 0 ? `, categorizing ${outcome.categorized} transactions.` : '.'),
            );
            router.refresh();
          })
        }
        className="rounded border border-line px-2 py-0.5 text-[11px] hover:border-accent disabled:opacity-50"
        title={preview ? `Change the match to “${preview}”` : undefined}
      >
        {pending ? '…' : label}
      </button>
      {result ? <span className="text-[11px] text-muted">{result}</span> : null}
    </span>
  );
}
