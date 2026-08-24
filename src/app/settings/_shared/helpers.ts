import type { Field, SelectOption } from '@/lib/forms';
import { MODELS, type ModelKey } from '@/lib/models';

/** Fill a model's select fields with options loaded from the database. */
export function withOptions(modelKey: ModelKey, options: Record<string, SelectOption[]>): Field[] {
  return MODELS[modelKey].fields.map((field) =>
    options[field.name] ? { ...field, options: options[field.name] } : field,
  );
}

export function dateInput(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}
