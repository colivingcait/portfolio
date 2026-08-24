'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveRecord } from '@/lib/actions';
import type { ModelKey } from '@/lib/models';
import type { Field } from '@/lib/forms';

interface Props {
  modelKey: ModelKey;
  fields: Field[];
  id?: string | null;
  initial?: Record<string, string | boolean | null>;
  submitLabel?: string;
  onSaved?: () => void;
}

const SPAN: Record<number, string> = {
  1: 'col-span-12 sm:col-span-1',
  2: 'col-span-12 sm:col-span-2',
  3: 'col-span-12 sm:col-span-3',
  4: 'col-span-12 sm:col-span-4',
  5: 'col-span-12 sm:col-span-5',
  6: 'col-span-12 sm:col-span-6',
  8: 'col-span-12 sm:col-span-8',
  9: 'col-span-12 sm:col-span-9',
  12: 'col-span-12',
};

type Values = Record<string, string | boolean>;

function initialValues(
  fields: Field[],
  initial: Record<string, string | boolean | null>,
  useDefaults: boolean,
): Values {
  const values: Values = {};
  for (const field of fields) {
    const value = initial[field.name];
    const fallback = useDefaults ? field.defaultValue : undefined;

    if (field.type === 'checkbox') {
      values[field.name] = value === true || (value === undefined && fallback === true);
    } else if (typeof value === 'string' && value !== '') {
      values[field.name] = value;
    } else {
      values[field.name] = typeof fallback === 'string' ? fallback : '';
    }
  }
  return values;
}

export function RecordForm({ modelKey, fields, id = null, initial = {}, submitLabel, onSaved }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Values>(() => initialValues(fields, initial, id === null));
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // The fields are controlled rather than left to the DOM. A form with an
  // action resets itself once the action returns — including when it returned
  // an error — which would throw away everything typed over one bad field.
  useEffect(() => {
    if (!error?.field) return;
    const element = containerRef.current?.querySelector<HTMLElement>(`[name="${error.field}"]`);
    element?.focus();
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [error]);

  function set(name: string, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }));
    setSaved(false);
    // Clear the error on the field being corrected, but keep the message for
    // any other field so the summary does not flicker away mid-edit.
    setError((current) => (current?.field === name ? null : current));
  }

  function submit() {
    setError(null);
    setSaved(false);

    const formData = new FormData();
    for (const field of fields) {
      const value = values[field.name];
      if (field.type === 'checkbox') {
        if (value === true) formData.set(field.name, 'on');
      } else {
        formData.set(field.name, String(value ?? ''));
      }
    }

    startTransition(async () => {
      const result = await saveRecord(modelKey, id, formData);
      if (result.ok) {
        setSaved(true);
        router.refresh();
        onSaved?.();
        // Clear only after a successful create, so the next record starts
        // fresh. An edit keeps what is on screen, since that is now the truth.
        if (!id) setValues(initialValues(fields, {}, true));
      } else {
        setError({ message: result.error ?? 'Could not save', field: result.field });
      }
    });
  }

  return (
    <div ref={containerRef} className="grid grid-cols-12 gap-3">
      {fields.map((field) => {
        const value = values[field.name];
        const invalid = error?.field === field.name;

        return (
          <div key={field.name} className={SPAN[field.span ?? 4] ?? SPAN[4]}>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor={field.name}>
              {field.label}
              {field.required ? <span className="text-bad"> *</span> : null}
            </label>

            {field.type === 'select' ? (
              <select
                id={field.name}
                name={field.name}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => set(field.name, e.target.value)}
                className={invalid ? 'border-bad!' : undefined}
              >
                {/* A field with a default is never blank, so offering blank
                    above the default just reads as a second empty choice. */}
                {field.defaultValue !== undefined && !field.emptyLabel ? null : (
                  <option value="">{field.emptyLabel ?? '—'}</option>
                )}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                id={field.name}
                name={field.name}
                rows={2}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => set(field.name, e.target.value)}
              />
            ) : field.type === 'checkbox' ? (
              <div className="pt-1.5">
                <input
                  id={field.name}
                  name={field.name}
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) => set(field.name, e.target.checked)}
                />
              </div>
            ) : (
              <input
                id={field.name}
                name={field.name}
                type={field.type === 'date' ? 'date' : 'text'}
                inputMode={
                  field.type === 'money' || field.type === 'number' || field.type === 'percent' ? 'decimal' : undefined
                }
                placeholder={field.placeholder}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => set(field.name, e.target.value)}
                className={invalid ? 'border-bad!' : undefined}
              />
            )}

            {invalid ? (
              <p className="mt-1 text-[11px] leading-snug text-bad">{error.message}</p>
            ) : field.help ? (
              <p className="mt-1 text-[11px] leading-snug text-muted">{field.help}</p>
            ) : null}
          </div>
        );
      })}

      <div className="col-span-12 flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {pending ? 'Saving…' : (submitLabel ?? (id ? 'Save' : 'Add'))}
        </button>

        {/* A field-level error is shown under its field; anything else here. */}
        {error && !error.field ? <span className="text-[12px] text-bad">{error.message}</span> : null}
        {error?.field ? <span className="text-[12px] text-bad">Check the highlighted field.</span> : null}
        {saved ? <span className="text-[12px] text-good">Saved.</span> : null}
      </div>
    </div>
  );
}
