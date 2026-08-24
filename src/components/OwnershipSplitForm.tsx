'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createEntityInline, saveOwnershipSplit, type SplitRow } from '@/lib/ownership-actions';
import type { SelectOption } from '@/lib/forms';

interface Props {
  entities: SelectOption[];
  properties: SelectOption[];
}

interface DraftRow {
  ownerId: string;
  percent: string;
  distributionPercent: string;
  startDate: string;
  endDate: string;
}

const blankRow = (startDate: string): DraftRow => ({
  ownerId: '',
  percent: '',
  distributionPercent: '',
  startDate,
  endDate: '',
});

/** Sentinel option: picking it opens the inline creator rather than selecting. */
const NEW_ENTITY = '__new__';

export function OwnershipSplitForm({ entities, properties }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [entityOptions, setEntityOptions] = useState<SelectOption[]>(entities);
  /** Which row is currently creating an entity, and for which select. */
  const [creatingFor, setCreatingFor] = useState<{ row: number | 'owned' } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState<'person' | 'company'>('person');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [ownedType, setOwnedType] = useState<'property' | 'entity'>('property');
  const [ownedId, setOwnedId] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([blankRow(''), blankRow('')]);
  const [result, setResult] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string; rowIndex?: number } | null>(null);

  const owned = ownedType === 'property' ? properties : entityOptions;

  // Everything in one thing should come to 100%. Showing the running total as
  // it is typed is the difference between catching a 5% gap now and finding it
  // in a report later.
  const total = rows.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
  const totalTone = total === 0 ? 'muted' : Math.abs(total - 100) < 0.005 ? 'good' : 'warn';

  function update(index: number, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** The first row's start date is the natural default for the rest. */
  function updateFirstDate(startDate: string) {
    setRows((current) =>
      current.map((row, i) => (i === 0 || row.startDate === current[0].startDate ? { ...row, startDate } : row)),
    );
  }

  function openCreator(target: number | 'owned') {
    setDraftName('');
    setDraftKind('person');
    setDraftError(null);
    setCreatingFor({ row: target });
  }

  function createEntity() {
    setDraftError(null);
    startTransition(async () => {
      const response = await createEntityInline({ name: draftName, kind: draftKind });
      if (!response.ok || !response.id) {
        setDraftError(response.error ?? 'Could not create');
        return;
      }
      const option = { value: response.id, label: response.label ?? draftName };
      setEntityOptions((current) =>
        current.some((o) => o.value === option.value)
          ? current
          : [...current, option].sort((a, b) => a.label.localeCompare(b.label)),
      );

      // Select it where it was asked for, so the row is finished, not restarted.
      const target = creatingFor?.row;
      if (target === 'owned') setOwnedId(option.value);
      else if (typeof target === 'number') update(target, { ownerId: option.value });

      setCreatingFor(null);
      if (response.reused) {
        setResult({ tone: 'warn', text: `“${option.label}” already existed, so that one was selected rather than a second copy created.` });
      }
      router.refresh();
    });
  }

  function save() {
    setResult(null);
    const payload: SplitRow[] = rows
      .filter((row) => row.ownerId !== '' || row.percent !== '')
      .map((row) => ({
        ownerId: row.ownerId,
        percent: Number(row.percent),
        distributionPercent: row.distributionPercent === '' ? null : Number(row.distributionPercent),
        startDate: row.startDate,
        endDate: row.endDate === '' ? null : row.endDate,
      }));

    startTransition(async () => {
      const response = await saveOwnershipSplit({ ownedType, ownedId, rows: payload });
      if (response.ok) {
        setResult({
          tone: response.warning ? 'warn' : 'good',
          text: response.warning ?? `Saved ${response.created} ${response.created === 1 ? 'interest' : 'interests'}.`,
        });
        setRows([blankRow(''), blankRow('')]);
        setOwnedId('');
        router.refresh();
      } else {
        setResult({ tone: 'bad', text: response.error ?? 'Could not save', rowIndex: response.rowIndex });
      }
    });
  }

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 sm:col-span-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Owners of a</label>
          <select
            value={ownedType}
            onChange={(e) => {
              setOwnedType(e.target.value as 'property' | 'entity');
              setOwnedId('');
            }}
          >
            <option value="property">Property</option>
            <option value="entity">Entity</option>
          </select>
        </div>
        <div className="col-span-12 sm:col-span-5">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">
            {ownedType === 'property' ? 'Property' : 'Entity'}
          </label>
          <select
            value={ownedId}
            onChange={(e) => (e.target.value === NEW_ENTITY ? openCreator('owned') : setOwnedId(e.target.value))}
          >
            <option value="">Pick one…</option>
            {owned.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {ownedType === 'entity' ? <option value={NEW_ENTITY}>+ New entity…</option> : null}
          </select>
        </div>
        <div className="col-span-12 sm:col-span-4 flex items-end">
          <p className="text-[11px] leading-snug text-muted">
            Add every owner at once. Nested holdings work the same way — record who owns the LLC here too, and the
            effective share multiplies through.
          </p>
        </div>
      </div>

      {creatingFor ? (
        <div className="rounded-md border border-accent/40 bg-accent/5 px-3 py-3">
          <div className="grid grid-cols-12 items-end gap-3">
            <div className="col-span-12 sm:col-span-5">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">New entity name</label>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); createEntity(); }
                  if (e.key === 'Escape') setCreatingFor(null);
                }}
                placeholder="Partner’s name, or the LLC"
              />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Kind</label>
              <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as 'person' | 'company')}>
                <option value="person">Person</option>
                <option value="company">Company</option>
              </select>
            </div>
            <div className="col-span-6 sm:col-span-4 flex items-center gap-2">
              <button
                type="button"
                onClick={createEntity}
                disabled={pending || draftName.trim() === ''}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-40"
              >
                {pending ? 'Creating…' : 'Create & select'}
              </button>
              <button
                type="button"
                onClick={() => setCreatingFor(null)}
                className="text-[12px] text-muted hover:text-text"
              >
                Cancel
              </button>
            </div>
          </div>
          {draftError ? <p className="mt-2 text-[12px] text-bad">{draftError}</p> : null}
          <p className="mt-2 text-[11px] text-muted">
            Added to the entity list and selected here. Anything else it needs — tax ID, notes, or marking it as you —
            can be filled in later under Settings → Entities.
          </p>
        </div>
      ) : null}

      <table>
        <thead>
          <tr>
            <th className="border-b border-line px-2 py-1.5">Owner</th>
            <th className="border-b border-line px-2 py-1.5 text-right">Percent</th>
            <th className="border-b border-line px-2 py-1.5 text-right">Distribution %</th>
            <th className="border-b border-line px-2 py-1.5">Start</th>
            <th className="border-b border-line px-2 py-1.5">End</th>
            <th className="border-b border-line px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={result?.rowIndex === index ? 'bg-bad/5' : undefined}>
              <td className="border-b border-line/60 px-2 py-1.5">
                <select
                  value={row.ownerId}
                  onChange={(e) =>
                    e.target.value === NEW_ENTITY ? openCreator(index) : update(index, { ownerId: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {entityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  <option value={NEW_ENTITY}>+ New entity…</option>
                </select>
              </td>
              <td className="border-b border-line/60 px-2 py-1.5">
                <input
                  value={row.percent}
                  onChange={(e) => update(index, { percent: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  className="text-right"
                />
              </td>
              <td className="border-b border-line/60 px-2 py-1.5">
                <input
                  value={row.distributionPercent}
                  onChange={(e) => update(index, { distributionPercent: e.target.value })}
                  inputMode="decimal"
                  placeholder="—"
                  className="text-right"
                />
              </td>
              <td className="border-b border-line/60 px-2 py-1.5">
                <input
                  type="date"
                  value={row.startDate}
                  onChange={(e) => (index === 0 ? updateFirstDate(e.target.value) : update(index, { startDate: e.target.value }))}
                />
              </td>
              <td className="border-b border-line/60 px-2 py-1.5">
                <input type="date" value={row.endDate} onChange={(e) => update(index, { endDate: e.target.value })} />
              </td>
              <td className="border-b border-line/60 px-2 py-1.5">
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    className="text-[12px] text-muted hover:text-bad"
                  >
                    Remove
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="px-2 py-2 text-[12px]">
              <button
                type="button"
                onClick={() => setRows((current) => [...current, blankRow(current[0]?.startDate ?? '')])}
                className="text-muted hover:text-accent"
              >
                + Add owner
              </button>
            </td>
            <td className="px-2 py-2">
              <span
                className={`num text-[13px] ${totalTone === 'good' ? 'text-good' : totalTone === 'warn' ? 'text-warn' : 'text-muted'}`}
              >
                {total.toFixed(total % 1 === 0 ? 0 : 3)}%
              </span>
            </td>
            <td colSpan={4} className="px-2 py-2 text-[11px] text-muted">
              {totalTone === 'warn' ? 'Does not total 100% — allowed, but worth a look.' : null}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !ownedId}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save interests'}
        </button>
        {result ? (
          <span
            className={`text-[12px] ${result.tone === 'good' ? 'text-good' : result.tone === 'warn' ? 'text-warn' : 'text-bad'}`}
          >
            {result.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
