'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmTransaction } from '@/lib/import-actions';
import { CATEGORIES } from '@/lib/engine/categories';
import { formatCents } from '@/lib/engine/money';

interface Props {
  id: string;
  date: string;
  propertyName: string;
  description: string;
  amountCents: number;
  /** A credit is far more likely to be income; default the list accordingly. */
  suggestion: string;
}

export function ReviewRow({ id, date, propertyName, description, amountCents, suggestion }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [categoryKey, setCategoryKey] = useState(suggestion);
  const [createRule, setCreateRule] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTransaction(id, categoryKey, createRule);
      if (result.ok) router.refresh();
      else setError(result.error ?? 'Could not save');
    });
  }

  return (
    <tr className="hover:bg-surface-2/40">
      <td className="border-b border-line/60 px-2 py-2 num">{date}</td>
      <td className="border-b border-line/60 px-2 py-2 text-[12px] text-muted">{propertyName}</td>
      <td className="border-b border-line/60 px-2 py-2 text-[12px]">
        {description}
        {error ? <div className="mt-0.5 text-[11px] text-bad">{error}</div> : null}
      </td>
      <td className={`border-b border-line/60 px-2 py-2 num ${amountCents < 0 ? 'text-bad' : ''}`}>
        {formatCents(amountCents)}
      </td>
      <td className="border-b border-line/60 px-2 py-2">
        <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="text-[12px]">
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </td>
      <td className="border-b border-line/60 px-2 py-2">
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={createRule} onChange={(e) => setCreateRule(e.target.checked)} />
          Remember
        </label>
      </td>
      <td className="border-b border-line/60 px-2 py-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="rounded border border-line px-2 py-1 text-[12px] hover:border-accent disabled:opacity-40"
        >
          {pending ? '…' : 'Confirm'}
        </button>
      </td>
    </tr>
  );
}
