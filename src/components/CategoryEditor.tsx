'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { archiveCategory, restoreCategory, saveCategory } from '@/lib/categories-actions';
import { SCHEDULE_E_LINES } from '@/lib/engine/tax';

interface CustomRow {
  id: string;
  key: string;
  label: string;
  class: string;
  taxLine: string | null;
  taxTreatment: string;
  note: string | null;
  archived: boolean;
  overridesBuiltIn: boolean;
}

export function CategoryEditor({ rows }: { rows: CustomRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [klass, setKlass] = useState('expense');
  const [treatment, setTreatment] = useState('deductible');
  const [line, setLine] = useState('other');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  function reset() {
    setEditing(null);
    setLabel('');
    setKlass('expense');
    setTreatment('deductible');
    setLine('other');
    setNote('');
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveCategory({
        id: editing,
        label,
        class: klass,
        taxTreatment: treatment,
        taxLine: klass === 'expense' && treatment === 'deductible' ? line : null,
        note,
      });
      if (result.ok) {
        setMessage({ tone: 'good', text: `Saved. “${label}” is now in the picker.` });
        reset();
        router.refresh();
      } else {
        setMessage({ tone: 'bad', text: result.error ?? 'Could not save' });
      }
    });
  }

  return (
    <div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Name</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pest control" />
          <p className="mt-1 text-[11px] text-muted">What you will pick while categorizing. Keep it operational.</p>
        </div>

        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Kind</label>
          <select
            value={klass}
            onChange={(e) => {
              setKlass(e.target.value);
              setTreatment(e.target.value === 'income' ? 'income' : e.target.value === 'expense' ? 'deductible' : 'not_reportable');
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="not_income">Neither — money moving, not earned or spent</option>
          </select>
        </div>

        {klass === 'expense' ? (
          <>
            <div className="col-span-6 sm:col-span-2">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">At year end</label>
              <select value={treatment} onChange={(e) => setTreatment(e.target.value)}>
                <option value="deductible">Deducted</option>
                <option value="capitalizable">Depreciated</option>
              </select>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                Depreciated for anything with a life beyond this year.
              </p>
            </div>

            {treatment === 'deductible' ? (
              <div className="col-span-12 sm:col-span-3">
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Schedule E line</label>
                <select value={line} onChange={(e) => setLine(e.target.value)}>
                  {SCHEDULE_E_LINES.filter((l) => l.line !== 'depreciation').map((l) => (
                    <option key={l.line} value={l.line}>
                      {l.number} {l.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  Chosen once, here. It never appears while categorizing.
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="col-span-12">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — why this exists, or what belongs in it" />
        </div>

        <div className="col-span-12 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending || label.trim().length < 2}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-40"
          >
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add category'}
          </button>
          {editing ? (
            <button type="button" onClick={reset} className="text-[12px] text-muted hover:text-text">
              Cancel
            </button>
          ) : null}
          {message ? (
            <span className={`text-[12px] ${message.tone === 'good' ? 'text-good' : 'text-bad'}`}>{message.text}</span>
          ) : null}
        </div>
      </div>

      {rows.length > 0 ? (
        <table className="mt-5">
          <thead>
            <tr>
              <th className="border-b border-line px-2 py-1.5">Your categories</th>
              <th className="border-b border-line px-2 py-1.5">Kind</th>
              <th className="border-b border-line px-2 py-1.5">At year end</th>
              <th className="border-b border-line px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.archived ? 'opacity-50' : undefined}>
                <td className="border-b border-line/60 px-2 py-2">
                  {row.label}
                  {row.overridesBuiltIn ? (
                    <span className="ml-1.5 text-[11px] text-warn">replaces the built-in</span>
                  ) : null}
                  {row.archived ? <span className="ml-1.5 text-[11px] text-muted">hidden</span> : null}
                </td>
                <td className="border-b border-line/60 px-2 py-2 text-[12px] text-muted">{row.class.replace('_', ' ')}</td>
                <td className="border-b border-line/60 px-2 py-2 text-[12px] text-muted">
                  {row.taxTreatment.replace('_', ' ')}
                  {row.taxLine ? ` · ${SCHEDULE_E_LINES.find((l) => l.line === row.taxLine)?.label ?? row.taxLine}` : ''}
                </td>
                <td className="border-b border-line/60 px-2 py-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(row.id);
                        setLabel(row.label);
                        setKlass(row.class);
                        setTreatment(row.taxTreatment);
                        setLine(row.taxLine ?? 'other');
                        setNote(row.note ?? '');
                      }}
                      className="text-[12px] text-muted hover:text-accent"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(async () => {
                          const result = row.archived ? await restoreCategory(row.id) : await archiveCategory(row.id);
                          if (result.error) setMessage({ tone: 'good', text: result.error });
                          router.refresh();
                        })
                      }
                      className="text-[12px] text-muted hover:text-bad"
                    >
                      {row.archived ? 'Restore' : 'Hide'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
