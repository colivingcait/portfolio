import type { Field, SelectOption } from '@/lib/forms';
import { centsToInput } from '@/lib/forms';
import { MODELS, type ModelKey } from '@/lib/models';

export interface LoadedOptions {
  categories?: SelectOption[];
  entities: SelectOption[];
  properties: SelectOption[];
  accounts: SelectOption[];
  loans: SelectOption[];
  units: SelectOption[];
}

/**
 * Which loaded option list feeds which select, per model. Declared once so the
 * create form and the edit form cannot drift apart.
 */
const OPTION_SOURCES: Record<ModelKey, Record<string, keyof LoadedOptions>> = {
  valuation: { propertyId: 'properties' },
  entity: {},
  property: { titleEntityId: 'entities' },
  ownershipInterest: { ownerId: 'entities', propertyId: 'properties', ownedEntityId: 'entities' },
  managementPeriod: { propertyId: 'properties' },
  bankAccount: { propertyId: 'properties' },
  loan: { propertyId: 'properties' },
  loanPayment: { loanId: 'loans' },
  lease: { propertyId: 'properties', unitId: 'units' },
  payeeRule: { bankAccountId: 'accounts', categoryKey: 'categories' },
  capitalAccountEntry: { entityId: 'entities', propertyId: 'properties' },
};

export function fieldsFor(modelKey: ModelKey, options: LoadedOptions): Field[] {
  const sources = OPTION_SOURCES[modelKey];
  return MODELS[modelKey].fields.map((field) => {
    const source = sources[field.name];
    const supplied = source ? options[source] : undefined;
    // A field with no loaded options keeps whatever it declared, so the
    // built-in category list still works before anything custom exists.
    return supplied ? { ...field, options: supplied } : field;
  });
}

/** Kept for pages that pass an explicit map. */
export function withOptions(modelKey: ModelKey, options: Record<string, SelectOption[]>): Field[] {
  return MODELS[modelKey].fields.map((field) =>
    options[field.name] ? { ...field, options: options[field.name] } : field,
  );
}

export function dateInput(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * A stored record back into form values.
 *
 * Every conversion is driven by the field's declared type, so a money field
 * renders as dollars, a date as YYYY-MM-DD and a Decimal percentage as a plain
 * string — the same shapes the parser on the other side expects.
 */
export function recordToInitial(
  modelKey: ModelKey,
  record: Record<string, unknown>,
): Record<string, string | boolean | null> {
  const initial: Record<string, string | boolean | null> = {};

  for (const field of MODELS[modelKey].fields) {
    const value = record[field.name];

    if (field.type === 'checkbox') {
      initial[field.name] = value === true;
      continue;
    }
    if (value === null || value === undefined) {
      initial[field.name] = '';
      continue;
    }
    switch (field.type) {
      case 'date':
        initial[field.name] = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
        break;
      case 'money':
        initial[field.name] = centsToInput(Number(value));
        break;
      default:
        // Prisma Decimal and number both stringify correctly.
        initial[field.name] = String(value);
    }
  }

  return initial;
}
