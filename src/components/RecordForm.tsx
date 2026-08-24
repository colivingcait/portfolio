'use client';

import { useState, useTransition } from 'react';
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

export function RecordForm({ modelKey, fields, id = null, initial = {}, submitLabel, onSaved }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveRecord(modelKey, id, formData);
      if (result.ok) {
        router.refresh();
        onSaved?.();
        if (!id) (document.getElementById(`form-${modelKey}`) as HTMLFormElement | null)?.reset();
      } else {
        setError({ message: result.error ?? 'Could not save', field: result.field });
      }
    });
  }

  return (
    <form id={`form-${modelKey}`} action={onSubmit} className="grid grid-cols-12 gap-3">
      {fields.map((field) => {
        const value = initial[field.name];
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
                defaultValue={typeof value === 'string' ? value : ''}
                className={invalid ? 'border-bad!' : undefined}
              >
                {!field.required || field.emptyLabel ? (
                  <option value="">{field.emptyLabel ?? '—'}</option>
                ) : null}
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
                defaultValue={typeof value === 'string' ? value : ''}
              />
            ) : field.type === 'checkbox' ? (
              <div className="pt-1.5">
                <input id={field.name} name={field.name} type="checkbox" defaultChecked={value === true} />
              </div>
            ) : (
              <input
                id={field.name}
                name={field.name}
                type={field.type === 'date' ? 'date' : 'text'}
                inputMode={field.type === 'money' || field.type === 'number' || field.type === 'percent' ? 'decimal' : undefined}
                placeholder={field.placeholder}
                defaultValue={typeof value === 'string' ? value : ''}
                className={invalid ? 'border-bad!' : undefined}
              />
            )}

            {field.help ? <p className="mt-1 text-[11px] leading-snug text-muted">{field.help}</p> : null}
          </div>
        );
      })}

      <div className="col-span-12 flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {pending ? 'Saving…' : (submitLabel ?? (id ? 'Save' : 'Add'))}
        </button>
        {error ? <span className="text-[12px] text-bad">{error.message}</span> : null}
      </div>
    </form>
  );
}
