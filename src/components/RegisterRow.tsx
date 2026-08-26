'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmCategory, recategorize, setMemo, splitTransaction, unsplitTransaction } from '@/lib/books-actions';
import { formatCents } from '@/lib/engine/money';
import { SplitEditor } from './SplitEditor';

interface Split {
  id: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  amountCents: number;
  memo: string | null;
}

interface Props {
  categories: { key: string; label: string }[];
  id: string;
  date: string;
  propertyName: string;
  accountLabel: string;
  description: string;
  memo: string | null;
  amountCents: number;
  categoryKey: string | null;
  confirmed: boolean;
  isSplit: boolean;
  splits: Split[];
  selected: boolean;
  onToggle: (id: string, selected: boolean) => void;
}

export function RegisterRow(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memoText, setMemoText] = useState(props.memo ?? '');
  const [memoOpen, setMemoOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error ?? 'Could not save');
      }
    });
  }

  const needsConfirming = !props.confirmed && props.categoryKey !== null && !props.isSplit;

  return (
    <>
      <tr className="align-top hover:bg-surface-2/40">
        <td className="border-b border-line/60 px-2 py-2">
          <input
            type="checkbox"
            aria-label={`Select ${props.description}`}
            checked={props.selected}
            disabled={props.isSplit}
            onChange={(e) => props.onToggle(props.id, e.target.checked)}
          />
        </td>
        <td className="border-b border-line/60 px-2 py-2 num">{props.date}</td>
        <td className="border-b border-line/60 px-2 py-2 text-[12px] text-muted">
          {props.propertyName}
          <div className="text-[11px] opacity-70">{props.accountLabel}</div>
        </td>
        <td className="border-b border-line/60 px-2 py-2">
          <div className="text-[12px] leading-snug">{props.description}</div>
          {props.memo && !memoOpen ? <div className="mt-0.5 text-[11px] text-muted italic">{props.memo}</div> : null}

          {memoOpen ? (
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                aria-label="Memo"
                value={memoText}
                placeholder="What was this for?"
                onChange={(e) => setMemoText(e.target.value)}
                className="max-w-[260px] py-0.5 text-[12px]"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await setMemo(props.id, memoText);
                    if (result.ok) setMemoOpen(false);
                    return result;
                  })
                }
                className="rounded border border-line px-2 py-0.5 text-[11px] hover:border-accent"
              >
                Save
              </button>
            </div>
          ) : null}

          {splitOpen ? (
            <SplitEditor
              amountCents={props.amountCents}
              categories={props.categories}
              openOn={props.categoryKey}
              pending={pending}
              onCancel={() => setSplitOpen(false)}
              onSplit={(pieces) =>
                run(async () => {
                  const result = await splitTransaction(props.id, pieces);
                  if (result.ok) setSplitOpen(false);
                  return result;
                })
              }
            />
          ) : null}

          {error ? <div className="mt-0.5 text-[11px] text-bad">{error}</div> : null}
          {saved && !error ? <div className="mt-0.5 text-[11px] text-good">Saved</div> : null}
        </td>
        <td className={`border-b border-line/60 px-2 py-2 num ${props.amountCents < 0 ? 'text-bad' : ''}`}>
          {formatCents(props.amountCents)}
        </td>
        <td className="border-b border-line/60 px-2 py-2">
          {props.isSplit ? (
            <span className="text-[12px] text-muted">Split into {props.splits.length}</span>
          ) : (
            <>
              <select
                aria-label="Category"
                value={props.categoryKey ?? ''}
                disabled={pending}
                onChange={(e) => run(() => recategorize(props.id, e.target.value))}
                className="text-[12px]"
              >
                <option value="">— uncategorized —</option>
                {props.categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              {/*
                A rule filed this one at import and nobody has looked. It counts
                in every report either way, so the marker is not a warning — it
                is the difference between a category a machine chose and one a
                person agreed with. Changing the category confirms it too.
              */}
              {needsConfirming ? (
                <div className="mt-0.5 text-[10px] text-warn">filed by rule · not checked</div>
              ) : null}
            </>
          )}
        </td>
        <td className="border-b border-line/60 px-2 py-2">
          <div className="flex items-center gap-2.5 text-[11px] text-muted">
            {needsConfirming ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => confirmCategory(props.id))}
                className="rounded border border-line px-2 py-0.5 text-[11px] text-text hover:border-accent disabled:opacity-40"
              >
                Confirm
              </button>
            ) : null}
            <button type="button" onClick={() => setMemoOpen((open) => !open)} className="hover:text-accent">
              {props.memo ? 'Edit note' : 'Note'}
            </button>
            {props.isSplit ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => unsplitTransaction(props.id))}
                className="hover:text-bad"
              >
                Undo split
              </button>
            ) : (
              <button type="button" onClick={() => setSplitOpen((open) => !open)} className="hover:text-accent">
                Split
              </button>
            )}
          </div>
        </td>
      </tr>

      {props.splits.map((split) => (
        <tr key={split.id} className="bg-surface-2/30">
          <td className="border-b border-line/60" />
          <td className="border-b border-line/60" />
          <td className="border-b border-line/60" />
          <td className="border-b border-line/60 px-2 py-1 pl-6 text-[11px] text-muted">
            ↳ {split.categoryLabel ?? 'uncategorized'}
            {split.memo ? <span className="italic"> · {split.memo}</span> : null}
          </td>
          <td className={`border-b border-line/60 px-2 py-1 num text-[12px] ${split.amountCents < 0 ? 'text-bad' : ''}`}>
            {formatCents(split.amountCents)}
          </td>
          <td className="border-b border-line/60" />
          <td className="border-b border-line/60" />
        </tr>
      ))}
    </>
  );
}
