'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmTransaction, suggestRule, type RuleScope, type RuleSuggestion } from '@/lib/import-actions';
import type { Suggestion } from '@/lib/engine/suggest';
import { formatCents } from '@/lib/engine/money';
import { splitTransaction } from '@/lib/books-actions';
import { SplitEditor } from './SplitEditor';

interface Props {
  /**
   * The first cell, so this row lines up with the register's other rows. The
   * register supplies its bulk-select checkbox; nothing else needs it.
   */
  leading?: React.ReactNode;
  categories: { key: string; label: string }[];
  id: string;
  date: string;
  propertyName: string;
  description: string;
  amountCents: number;
  /**
   * What the picker opens on, and why. Null only where nothing has been worked
   * out — the register always sends one.
   */
  suggestion: Suggestion | null;
  /** Set where this row looks like it cancels another one, or is cancelled by it. */
  reversalOf?: {
    description: string;
    date: string;
    amount: string;
    /** Null where the other half has not been categorized yet either. */
    categoryLabel: string | null;
  } | null;
}

export function ReviewRow({
  leading = null,
  categories,
  id,
  date,
  propertyName,
  description,
  amountCents,
  suggestion,
  reversalOf = null,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const opensOn = suggestion?.categoryKey ?? (amountCents > 0 ? 'rental_income' : 'maintenance_repairs');
  const [categoryKey, setCategoryKey] = useState(opensOn);
  // Once it has been changed by hand the reasoning is stale — it explains a
  // guess that is no longer on screen, so it goes rather than misleads.
  const untouched = categoryKey === opensOn;
  // A reversal is a one-off, and a rule written from one would catch the next
  // ordinary charge from the same payee too.
  const [createRule, setCreateRule] = useState(reversalOf === null);
  // Account-scoped by default: widening a rule is a click, but a rule that has
  // already miscategorized another property's statement is a mess to undo.
  const [scope, setScope] = useState<RuleScope>('account');
  const [rule, setRule] = useState<RuleSuggestion | null>(null);
  const [match, setMatch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);

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
      <td className="border-b border-line/60 px-2 py-2">{leading}</td>
      <td className="border-b border-line/60 px-2 py-2 num">{date}</td>
      <td className="border-b border-line/60 px-2 py-2 text-[12px] text-muted">{propertyName}</td>
      <td className="border-b border-line/60 px-2 py-2">
        <div className="text-[12px] leading-snug">{description}</div>

        {reversalOf ? (
          <div className="mt-1 text-[11px] leading-snug text-warn">
            Looks like it cancels {reversalOf.amount} on {reversalOf.date} — {reversalOf.description}.{' '}
            {reversalOf.categoryLabel ? (
              <>
                Put it under <strong>{reversalOf.categoryLabel}</strong> as well and the two net to nothing. Categorized
                as income instead, the year gains a cost never borne and income never earned.
              </>
            ) : (
              <>Give both the same category and their opposite signs cancel.</>
            )}
          </div>
        ) : null}

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

        {splitOpen ? (
          <SplitEditor
            amountCents={amountCents}
            categories={categories}
            openOn={categoryKey}
            pending={pending}
            onCancel={() => setSplitOpen(false)}
            onSplit={(pieces) => {
              setError(null);
              startTransition(async () => {
                const result = await splitTransaction(id, pieces);
                if (result.ok) {
                  setSplitOpen(false);
                  setDone('Split');
                  router.refresh();
                } else {
                  setError(result.error ?? 'Could not save');
                }
              });
            }}
          />
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
        {/*
          Why the picker opened where it did. A guess with its reasoning showing
          can be disagreed with in a glance; one without is indistinguishable
          from the app having decided something.
        */}
        {suggestion && untouched && suggestion.source !== 'direction' ? (
          <div
            className={`mt-0.5 text-[10px] leading-snug ${
              suggestion.confidence === 'high' ? 'text-good' : 'text-muted'
            }`}
          >
            {suggestion.reason}
          </div>
        ) : null}
      </td>
      <td className="border-b border-line/60 px-2 py-2">
        <span className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={createRule} onChange={(e) => setCreateRule(e.target.checked)} />
            Remember
          </label>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded border border-line px-2 py-1 text-[12px] hover:border-accent disabled:opacity-40"
          >
            {pending ? '…' : 'Confirm'}
          </button>
          {/*
            Split belonged only to filed rows, which had it backwards: the row
            you most want to split is the one you have not filed, because
            filing it means picking one wrong category for the whole charge
            first.
          */}
          <button
            type="button"
            onClick={() => setSplitOpen((open) => !open)}
            className="text-[11px] text-muted hover:text-accent"
          >
            Split
          </button>
        </span>
      </td>
    </tr>
  );
}
