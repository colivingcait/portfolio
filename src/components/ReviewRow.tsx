'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmTransaction, suggestRule, type RuleScope, type RuleSuggestion } from '@/lib/import-actions';
import { formatCents } from '@/lib/engine/money';

interface Props {
  categories: { key: string; label: string }[];
  id: string;
  date: string;
  propertyName: string;
  description: string;
  amountCents: number;
  suggestion: string;
}

export function ReviewRow({ categories, id, date, propertyName, description, amountCents, suggestion }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [categoryKey, setCategoryKey] = useState(suggestion);
  const [createRule, setCreateRule] = useState(true);
  // Account-scoped by default: widening a rule is a click, but a rule that has
  // already miscategorized another property's statement is a mess to undo.
  const [scope, setScope] = useState<RuleScope>('account');
  const [rule, setRule] = useState<RuleSuggestion | null>(null);
  const [match, setMatch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // What a rule would latch onto, worked out before it is written.
  useEffect(() => {
    let cancelled = false;
    suggestRule(id).then((result) => {
      if (cancelled || !result) return;
      setRule(result);
      setMatch(result.match);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function recount(next: string) {
    setMatch(next);
    suggestRule(id, next).then((result) => result && setRule(result));
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTransaction(id, categoryKey, createRule, match, scope);
      if (result.ok) {
        setDone(
          result.alsoCategorized
            ? `Also categorized ${result.alsoCategorized} more`
            : 'Saved',
        );
        router.refresh();
      } else {
        setError(result.error ?? 'Could not save');
      }
    });
  }

  return (
    <tr className="align-top hover:bg-surface-2/40">
      <td className="border-b border-line/60 px-2 py-2 num">{date}</td>
      <td className="border-b border-line/60 px-2 py-2 text-[12px] text-muted">{propertyName}</td>
      <td className="border-b border-line/60 px-2 py-2">
        <div className="text-[12px] leading-snug">{description}</div>

        {createRule ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted">Match on</span>
            <input
              type="text"
              aria-label="Rule match text"
              value={match}
              onChange={(e) => recount(e.target.value)}
              className="max-w-[220px] py-0.5 text-[12px]"
            />
            <select
              aria-label="Rule scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as RuleScope)}
              className="py-0.5 text-[11px]"
            >
              <option value="account">on this account</option>
              <option value="all">on every property</option>
            </select>
            {rule ? (
              <span className="text-[11px] text-muted">
                {(scope === 'all' ? rule.alsoMatchesEverywhere : rule.alsoMatches) > 0 ? (
                  <span className="text-good">
                    catches {scope === 'all' ? rule.alsoMatchesEverywhere : rule.alsoMatches} more
                  </span>
                ) : (
                  'this row only'
                )}
                {scope === 'account' && rule.alsoMatchesEverywhere > rule.alsoMatches ? (
                  <span className="text-warn">
                    {' '}
                    · {rule.alsoMatchesEverywhere - rule.alsoMatches} more on other properties
                  </span>
                ) : null}
                {rule.confidence !== 'high' ? <span className="text-warn"> · check this one</span> : null}
              </span>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="mt-0.5 text-[11px] text-bad">{error}</div> : null}
        {done ? <div className="mt-0.5 text-[11px] text-good">{done}</div> : null}
      </td>
      <td className={`border-b border-line/60 px-2 py-2 num ${amountCents < 0 ? 'text-bad' : ''}`}>
        {formatCents(amountCents)}
      </td>
      <td className="border-b border-line/60 px-2 py-2">
        <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="text-[12px]">
          {categories.map((c) => (
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
