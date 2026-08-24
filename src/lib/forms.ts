/**
 * Field specs shared by the form renderer and the server actions, so a field
 * is declared once and parsed the same way on both sides.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'percent'
  | 'date'
  | 'select'
  | 'checkbox';

export interface SelectOption {
  value: string;
  label: string;
}

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  options?: SelectOption[];
  /** Select fields only: allow an empty choice with this label. */
  emptyLabel?: string;
  placeholder?: string;
  /** Layout hint: how many of the 12 columns this field takes. */
  span?: number;
}

export class FieldError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'FieldError';
  }
}

/** '$1,234.56' / '1234.56' / '(45.00)' → integer cents. */
export function parseMoney(raw: string): number {
  const negative = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[$,()\s]/g, '');
  if (cleaned === '') return 0;
  const value = Number(cleaned);
  if (Number.isNaN(value)) throw new Error(`Not an amount: ${raw}`);
  const asCents = Math.round(value * 100);
  return negative ? -asCents : asCents;
}

export function centsToInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return (value / 100).toFixed(2);
}

/**
 * Parse a submitted form against its field spec. Empty optional fields become
 * null rather than empty strings, so a cleared date genuinely clears.
 */
export function parseForm(fields: readonly Field[], data: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = data.get(field.name);

    if (field.type === 'checkbox') {
      out[field.name] = raw === 'on' || raw === 'true';
      continue;
    }

    const value = typeof raw === 'string' ? raw.trim() : '';

    if (value === '') {
      if (field.required) throw new FieldError(field.name, `${field.label} is required`);
      out[field.name] = null;
      continue;
    }

    switch (field.type) {
      case 'money':
        try {
          out[field.name] = parseMoney(value);
        } catch {
          throw new FieldError(field.name, `${field.label} is not an amount`);
        }
        break;
      case 'number':
      case 'percent': {
        const n = Number(value);
        if (Number.isNaN(n)) throw new FieldError(field.name, `${field.label} is not a number`);
        out[field.name] = n;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new FieldError(field.name, `${field.label} must be a date`);
        }
        out[field.name] = value;
        break;
      default:
        out[field.name] = value;
    }
  }

  return out;
}
