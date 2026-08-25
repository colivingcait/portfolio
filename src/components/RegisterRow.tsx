'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recategorize, setMemo, splitTransaction, unsplitTransaction } from '@/lib/books-actions';
import { formatCents } from '@/lib/engine/money';

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

/** Cents from typed dollars, tolerant of $ and commas. */
function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function RegisterRow(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memoText, setMemoText] = useState(props.memo ?? '');
  const [memoOpen, setMemoOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [pieces, setPieces] = useState<{ categoryKey: string; amount: string }[]>([
    { categoryKey: props.categoryKey ?? props.categories[0]?.key ?? '', amount: '' },
    { categoryKey: props.categories[0]?.key ?? '', amount: '' },
  ]);

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

  const piecesTotal = pieces.reduce((sum, piece) => sum + (parseDollars(piece.amount) ?? 0), 0);
  const remaining = props.amountCents - piecesTotal;

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
            <div className="mt-2 rounded-md border border-line bg-surface-2/60 p-2">
              <div className="mb-1.5 text-[11px] text-muted">
                One charge, more than one thing. The pieces have to add up to {formatCents(props.amountCents)} — the
                original line stays exactly as the bank has it so the statement still ties.
              </div>
              {pieces.map((piece, index) => (
                <div key={index} className="mb-1 flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Piece ${index + 1} category`}
                    value={piece.categoryKey}
                    onChange={(e) =>
                      setPieces((current) =>
                        current.map((p, i) => (i === index ? { ...p, categoryKey: e.target.value } : p)),
                      )
                    }
                    className="text-[12px]"
                  >
                    {props.categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    aria-label={`Piece ${index + 1} amount`}
                    inputMode="decimal"
                    value={piece.amount}
                    placeholder={index === 0 ? (props.amountCents / 100).toFixed(2) : '0.00'}
                    onChange={(e) =>
                      setPieces((current) => current.map((p, i) => (i === index ? { ...p, amount: e.target.value } : p)))
                    }
                    className="max-w-[110px] py-0.5 text-right text-[12px]"
                  />
                  {pieces.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => setPieces((current) => current.filter((_, i) => i !== index))}
                      className="text-[11px] text-muted hover:text-bad"
                    >
                      remove
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPieces((current) => [...current, { categoryKey: props.categories[0]?.key ?? '', amount: '' }])}
                  className="text-[11px] text-muted hover:text-accent"
                >
                  + another piece
                </button>
                <span className={`text-[11px] ${remaining === 0 ? 'text-good' : 'text-warn'}`}>
                  {remaining === 0 ? 'adds up' : `${formatCents(Math.abs(remaining))} ${remaining > 0 ? 'left to assign' : 'over'}`}
                </span>
                <button
                  type="button"
                  disabled={pending || remaining !== 0}
                  onClick={() =>
                    run(async () => {
                      const result = await splitTransaction(
                        props.id,
                        pieces
                          .map((piece) => ({ categoryKey: piece.categoryKey, amountCents: parseDollars(piece.amount) ?? 0 }))
                          .filter((piece) => piece.amountCents !== 0),
                      );
                      if (result.ok) setSplitOpen(false);
                      return result;
                    })
                  }
                  className="rounded border border-line px-2 py-0.5 text-[11px] hover:border-accent disabled:opacity-40"
                >
                  Split
                </button>
                <button type="button" onClick={() => setSplitOpen(false)} className="text-[11px] text-muted hover:text-text">
                  cancel
                </button>
              </div>
            </div>
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
          )}
        </td>
        <td className="border-b border-line/60 px-2 py-2">
          <div className="flex items-center gap-2.5 text-[11px] text-muted">
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
