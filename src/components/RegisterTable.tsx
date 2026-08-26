'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RegisterRow } from './RegisterRow';
import { ReviewRow } from './ReviewRow';
import { confirmMany, recategorizeMany } from '@/lib/books-actions';
import { Th } from './ui';
import type { RegisterRow as Row } from '@/lib/books-queries';

interface Props {
  rows: Row[];
  categories: { key: string; label: string }[];
}

export function RegisterTable({ rows, categories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState(categories[0]?.key ?? '');
  const [done, setDone] = useState<string | null>(null);

  function toggle(id: string, on: boolean) {
    setDone(null);
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const selectable = rows.filter((row) => !row.isSplit);
  const selectedUnconfirmed = rows.filter(
    (row) => selected.has(row.id) && !row.confirmed && row.categoryKey !== null && !row.isSplit,
  ).length;
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.id));

  return (
    <>
      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[12px]">
          <span>
            {selected.size} selected. Recategorize {selected.size === 1 ? 'it' : 'them all'} as
          </span>
          <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className="text-[12px]">
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await recategorizeMany([...selected], bulkCategory);
                setDone(result.ok ? `Changed ${result.changed}.` : (result.error ?? 'Could not save'));
                setSelected(new Set());
                router.refresh();
              })
            }
            className="rounded border border-line bg-surface px-2 py-0.5 hover:border-accent disabled:opacity-50"
          >
            {pending ? '…' : 'Apply'}
          </button>
          {/*
            Agreeing with what a rule already chose is the commoner action on a
            selection than changing it, and it is not the same action: it moves
            no money between categories, so it sits apart from Apply.
          */}
          {selectedUnconfirmed > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await confirmMany([...selected]);
                  setDone(result.ok ? `Confirmed ${result.changed}.` : (result.error ?? 'Could not save'));
                  setSelected(new Set());
                  router.refresh();
                })
              }
              className="rounded border border-line bg-surface px-2 py-0.5 hover:border-accent disabled:opacity-50"
            >
              Confirm {selectedUnconfirmed} as filed
            </button>
          ) : null}
          <button type="button" onClick={() => setSelected(new Set())} className="text-muted hover:text-text">
            clear
          </button>
          {done ? <span className="text-muted">{done}</span> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <Th>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
                />
              </Th>
              <Th>Date</Th>
              <Th>Property</Th>
              <Th>Description</Th>
              <Th right>Amount</Th>
              <Th>Category</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              /*
                An uncategorized row gets the tools for filing it — the payee
                fragment a rule would match on, how many other rows that catches,
                and whether to remember it. A filed one gets the tools for
                revising it. Same table, same data; the row shows what the row
                is for. They used to be two pages, and telling them apart meant
                knowing which of two screens a bank line was currently on.
              */
              row.categoryKey === null && !row.isSplit ? (
                <ReviewRow
                  key={row.id}
                  leading={
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.description}`}
                      checked={selected.has(row.id)}
                      onChange={(e) => toggle(row.id, e.target.checked)}
                    />
                  }
                  categories={categories}
                  id={row.id}
                  date={row.date}
                  propertyName={row.propertyName}
                  description={row.description}
                  amountCents={row.amountCents}
                  suggestion={row.suggestion ?? 'maintenance_repairs'}
                  reversalOf={row.reversalOf}
                />
              ) : (
                <RegisterRow
                  key={row.id}
                  categories={categories}
                  {...row}
                  selected={selected.has(row.id)}
                  onToggle={toggle}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
