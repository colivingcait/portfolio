'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveOwnershipSplit, type SplitRow } from '@/lib/ownership-actions';
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

export function OwnershipSplitForm({ entities, properties }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ownedType, setOwnedType] = useState<'property' | 'entity'>('property');
  const [ownedId, setOwnedId] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([blankRow(''), blankRow('')]);
  const [result, setResult] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string; rowIndex?: number } | null>(null);

  const owned = ownedType === 'property' ? properties : entities;

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
          <select value={ownedId} onChange={(e) => setOwnedId(e.target.value)}>
            <option value="">Pick one…</option>
            {owned.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-12 sm:col-span-4 flex items-end">
          <p className="text-[11px] leading-snug text-muted">
            Add every owner at once. Nested holdings work the same way — record who owns the LLC here too, and the
            effective share multiplies through.
          </p>
        </div>
      </div>

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
                <select value={row.ownerId} onChange={(e) => update(index, { ownerId: e.target.value })}>
                  <option value="">—</option>
                  {entities.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
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
