/**
 * Year-end reporting.
 *
 * Categorization stays operational — "electric", "lawn", "turn & cleaning" —
 * because that is a judgement anyone can make while looking at a bank line.
 * The translation into tax vocabulary happens here, once, at the end of the
 * year, where an accountant can check it.
 */

import { CATEGORIES, category, type CategoryCatalog, type ScheduleELine } from './categories';
import type { MonthKey } from './dates';
import { sumCents, type Cents } from './money';

export const SCHEDULE_E_LINES: { line: ScheduleELine; number: number; label: string }[] = [
  { line: 'advertising', number: 5, label: 'Advertising' },
  { line: 'auto_travel', number: 6, label: 'Auto and travel' },
  { line: 'cleaning_maintenance', number: 7, label: 'Cleaning and maintenance' },
  { line: 'commissions', number: 8, label: 'Commissions' },
  { line: 'insurance', number: 9, label: 'Insurance' },
  { line: 'legal_professional', number: 10, label: 'Legal and other professional fees' },
  { line: 'management_fees', number: 11, label: 'Management fees' },
  { line: 'mortgage_interest', number: 12, label: 'Mortgage interest paid to banks' },
  { line: 'other_interest', number: 13, label: 'Other interest' },
  { line: 'repairs', number: 14, label: 'Repairs' },
  { line: 'supplies', number: 15, label: 'Supplies' },
  { line: 'taxes', number: 16, label: 'Taxes' },
  { line: 'utilities', number: 17, label: 'Utilities' },
  { line: 'depreciation', number: 18, label: 'Depreciation expense or depletion' },
  { line: 'other', number: 19, label: 'Other' },
];

export interface TaxTransaction {
  date: string;
  categoryKey: string | null;
  amountCents: Cents;
  description?: string;
}

export interface ScheduleELineTotal {
  line: ScheduleELine;
  number: number;
  label: string;
  amountCents: Cents;
  /** Which operational categories fed this line, and how much each. */
  from: { categoryKey: string; label: string; amountCents: Cents }[];
}

export interface ScheduleEReport {
  year: number;
  propertyId: string;
  /** Line 3: rents received. */
  grossRentsCents: Cents;
  lines: ScheduleELineTotal[];
  totalExpensesCents: Cents;
  /** Gross rents less deductible expenses. Depreciation is not included. */
  netIncomeCents: Cents;
  /**
   * Spend that is depreciated rather than deducted. Listed separately with the
   * detail an accountant needs to set up an asset, never folded into expenses.
   */
  capitalizable: { categoryKey: string; label: string; amountCents: Cents; items: TaxTransaction[] }[];
  capitalizableTotalCents: Cents;
  /** Real cash movements that are not reportable either way. */
  excludedCents: Cents;
  /** Anything still uncategorized. A report with these in it is not finished. */
  uncategorizedCents: Cents;
  uncategorizedCount: number;
  warnings: string[];
}

export interface ScheduleEInput {
  year: number;
  propertyId: string;
  transactions: readonly TaxTransaction[];
  /**
   * Interest from the amortization schedules, not from the bank line: only the
   * interest half of a mortgage payment is deductible, and a statement shows
   * one undivided number.
   */
  mortgageInterestCents: Cents;
  /** Interest on notes that are not mortgages, where you separate them. */
  otherInterestCents?: Cents;
  /** Built-ins plus anything added later. */
  catalog?: CategoryCatalog;
}

export function buildScheduleE(input: ScheduleEInput): ScheduleEReport {
  const inYear = input.transactions.filter((t) => t.date.startsWith(String(input.year)));

  let grossRents = 0;
  let excluded = 0;
  let uncategorized = 0;
  let uncategorizedCount = 0;

  const byLine = new Map<ScheduleELine, Map<string, Cents>>();
  const capitalizable = new Map<string, { amountCents: Cents; items: TaxTransaction[] }>();

  for (const transaction of inYear) {
    if (!transaction.categoryKey) {
      uncategorized += transaction.amountCents;
      uncategorizedCount += 1;
      continue;
    }

    const definition = category(transaction.categoryKey, input.catalog);
    if (!definition) {
      uncategorized += transaction.amountCents;
      uncategorizedCount += 1;
      continue;
    }

    switch (definition.taxTreatment) {
      case 'income':
        grossRents += transaction.amountCents;
        break;
      case 'not_reportable':
        excluded += transaction.amountCents;
        break;
      case 'capitalizable': {
        const existing = capitalizable.get(transaction.categoryKey) ?? { amountCents: 0, items: [] };
        existing.amountCents += -transaction.amountCents;
        existing.items.push(transaction);
        capitalizable.set(transaction.categoryKey, existing);
        break;
      }
      case 'deductible': {
        const line = definition.taxLine ?? 'other';
        const bucket = byLine.get(line) ?? new Map<string, Cents>();
        // Expenses arrive negative; a Schedule E line is a positive figure.
        bucket.set(transaction.categoryKey, (bucket.get(transaction.categoryKey) ?? 0) + -transaction.amountCents);
        byLine.set(line, bucket);
        break;
      }
    }
  }

  // Interest comes from the schedules rather than from a categorized line.
  if (input.mortgageInterestCents > 0) {
    const bucket = byLine.get('mortgage_interest') ?? new Map<string, Cents>();
    bucket.set('__schedule__', (bucket.get('__schedule__') ?? 0) + input.mortgageInterestCents);
    byLine.set('mortgage_interest', bucket);
  }
  if (input.otherInterestCents && input.otherInterestCents > 0) {
    const bucket = byLine.get('other_interest') ?? new Map<string, Cents>();
    bucket.set('__schedule__', (bucket.get('__schedule__') ?? 0) + input.otherInterestCents);
    byLine.set('other_interest', bucket);
  }

  const lines: ScheduleELineTotal[] = SCHEDULE_E_LINES.map((definition) => {
    const bucket = byLine.get(definition.line);
    const from = bucket
      ? [...bucket.entries()].map(([categoryKey, amountCents]) => ({
          categoryKey,
          label:
            categoryKey === '__schedule__'
              ? 'From the amortization schedule'
              : (category(categoryKey, input.catalog)?.label ?? categoryKey),
          amountCents,
        }))
      : [];
    return {
      ...definition,
      amountCents: from.reduce((sum, entry) => sum + entry.amountCents, 0),
      from,
    };
  });

  // Depreciation is the accountant's to compute; the line stays at zero here.
  const totalExpenses = lines
    .filter((line) => line.line !== 'depreciation')
    .reduce((sum, line) => sum + line.amountCents, 0);

  const warnings: string[] = [];
  if (uncategorizedCount > 0) {
    warnings.push(
      `${uncategorizedCount} transactions are still uncategorized. Until they are cleared this report is incomplete, whatever the totals say.`,
    );
  }
  if (capitalizable.size > 0) {
    warnings.push(
      'Furnishings and capital spend are listed separately and are NOT in the expense total. They are depreciated, and the schedule is your accountant’s to set up.',
    );
  }

  return {
    year: input.year,
    propertyId: input.propertyId,
    grossRentsCents: grossRents,
    lines,
    totalExpensesCents: totalExpenses,
    netIncomeCents: grossRents - totalExpenses,
    capitalizable: [...capitalizable.entries()].map(([categoryKey, value]) => ({
      categoryKey,
      label: category(categoryKey, input.catalog)?.label ?? categoryKey,
      amountCents: value.amountCents,
      items: value.items,
    })),
    capitalizableTotalCents: sumCents([...capitalizable.values()].map((v) => v.amountCents)),
    excludedCents: excluded,
    uncategorizedCents: uncategorized,
    uncategorizedCount,
    warnings,
  };
}

/** Every operational category and the line it feeds, for the mapping page. */
export function mappingTable(
  catalog: CategoryCatalog = CATEGORIES,
): { categoryKey: string; label: string; treatment: string; line: string }[] {
  return catalog.map((definition) => ({
    categoryKey: definition.key,
    label: definition.label,
    treatment: definition.taxTreatment,
    line: definition.taxLine
      ? (SCHEDULE_E_LINES.find((l) => l.line === definition.taxLine)?.label ?? definition.taxLine)
      : '—',
  }));
}

/** Months of a calendar year, for pulling rollups. */
export function monthsOfYear(year: number): MonthKey[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}
