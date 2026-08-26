'use client';

import { useState } from 'react';
import { splitPieceCents } from '@/lib/engine/money';

/**
 * One charge, more than one thing.
 *
 * This used to live inside the filed-row component, which meant a row you had
 * not categorized yet could not be split at all — and an unfiled Home Depot
 * run that is half supplies and half a capital improvement is exactly the row
 * you want to split, before you are forced to pick one wrong category for the
 * whole thing. Both row types use it now.
 */
export interface SplitPieceInput {
  categoryKey: string;
  amountCents: number;
}

function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function SplitEditor({
  amountCents,
  categories,
  openOn,
  pending,
  onSplit,
  onCancel,
}: {
  amountCents: number;
  categories: { key: string; label: string }[];
  /** The category the first piece starts on — whatever the row was heading for. */
  openOn?: string | null;
  pending: boolean;
  onSplit: (pieces: SplitPieceInput[]) => void;
  onCancel: () => void;
}) {
  const [pieces, setPieces] = useState<{ categoryKey: string; amount: string }[]>([
    { categoryKey: openOn ?? categories[0]?.key ?? '', amount: '' },
    { categoryKey: categories[0]?.key ?? '', amount: '' },
  ]);

  const total = pieces.reduce((sum, piece) => sum + (splitPieceCents(piece.amount, amountCents) ?? 0), 0);
  const remaining = amountCents - total;

  return (
    <div className="mt-2 rounded-md border border-line bg-surface-2/60 p-2">
      <div className="mb-1.5 text-[11px] text-muted">
        One charge, more than one thing. The pieces have to add up to {money(Math.abs(amountCents))} — the original
        line stays exactly as the bank has it so the statement still ties. Amounts as they read on the row;{' '}
        {amountCents < 0 ? 'they go out' : 'they come in'} like the charge did.
      </div>

      {pieces.map((piece, index) => (
        <div key={index} className="mb-1 flex flex-wrap items-center gap-2">
          <select
            aria-label={`Piece ${index + 1} category`}
            value={piece.categoryKey}
            onChange={(e) =>
              setPieces((current) => current.map((p, i) => (i === index ? { ...p, categoryKey: e.target.value } : p)))
            }
            className="text-[12px]"
          >
            {categories.map((c) => (
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
            placeholder={index === 0 ? (Math.abs(amountCents) / 100).toFixed(2) : '0.00'}
            onChange={(e) =>
              setPieces((current) => current.map((p, i) => (i === index ? { ...p, amount: e.target.value } : p)))
            }
            className="max-w-[110px] py-0.5 text-right text-[12px]"
          />
          {index === pieces.length - 1 && remaining !== 0 && piece.amount === '' ? (
            <button
              type="button"
              onClick={() =>
                setPieces((current) =>
                  current.map((p, i) =>
                    i === index ? { ...p, amount: (Math.abs(remaining) / 100).toFixed(2) } : p,
                  ),
                )
              }
              className="text-[11px] text-muted hover:text-accent"
              title="Put what is left on this piece"
            >
              rest
            </button>
          ) : null}
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
          onClick={() => setPieces((current) => [...current, { categoryKey: categories[0]?.key ?? '', amount: '' }])}
          className="text-[11px] text-muted hover:text-accent"
        >
          + another piece
        </button>
        <span className={`text-[11px] ${remaining === 0 ? 'text-good' : 'text-warn'}`}>
          {remaining === 0
            ? 'adds up'
            : `${money(Math.abs(remaining))} ${
                // "Left" and "over" are about magnitude, and the charge's own
                // sign decides which way the shortfall points.
                (amountCents < 0 ? remaining < 0 : remaining > 0) ? 'left to assign' : 'over'
              }`}
        </span>
        <button
          type="button"
          disabled={pending || remaining !== 0}
          onClick={() =>
            onSplit(
              pieces
                .map((piece) => ({
                  categoryKey: piece.categoryKey,
                  amountCents: splitPieceCents(piece.amount, amountCents) ?? 0,
                }))
                .filter((piece) => piece.amountCents !== 0),
            )
          }
          className="rounded border border-line px-2 py-0.5 text-[11px] hover:border-accent disabled:opacity-40"
        >
          Save split
        </button>
        <button type="button" onClick={onCancel} className="text-[11px] text-muted hover:text-text">
          cancel
        </button>
      </div>
    </div>
  );
}
