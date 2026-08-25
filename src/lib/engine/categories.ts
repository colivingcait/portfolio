/**
 * The categorization vocabulary (§7).
 *
 * One account per property means the file is the property: the hard half of
 * classification — WHICH property — is answered by the upload itself. Only
 * WHAT KIND remains. One dimension, small vocabulary.
 */

export type CategoryClass = 'income' | 'not_income' | 'expense';

/**
 * Where a category lands on Schedule E.
 *
 * Deliberately invisible while categorizing: sorting a Georgia Power debit as
 * "electric" is a judgement anyone can make in a second, while "utilities,
 * line 13" is a translation into someone else's vocabulary. The mapping lives
 * here so the operational name stays the only thing ever chosen.
 */
export type ScheduleELine =
  | 'advertising'
  | 'auto_travel'
  | 'cleaning_maintenance'
  | 'commissions'
  | 'insurance'
  | 'legal_professional'
  | 'management_fees'
  | 'mortgage_interest'
  | 'other_interest'
  | 'repairs'
  | 'supplies'
  | 'taxes'
  | 'utilities'
  | 'depreciation'
  | 'other';

/**
 * What the tax treatment actually is, which is not the same question as which
 * line it goes on.
 *
 * 'capitalizable' is the one that matters: furnishings and capex are not
 * deductible in the year they are spent, they are depreciated. Reporting them
 * as expenses would overstate deductions and understate basis.
 */
export type TaxTreatment = 'income' | 'deductible' | 'capitalizable' | 'not_reportable';

export interface CategoryDef {
  key: string;
  label: string;
  class: CategoryClass;
  /** Where this lands on Schedule E. Never shown while categorizing. */
  taxLine?: ScheduleELine;
  taxTreatment: TaxTreatment;
  /** Excluded from the P&L. */
  excludeFromPnl?: boolean;
  /** Netted out of consolidated views so it isn't both a cost and a receipt. */
  intercompany?: boolean;
  note?: string;
}

export const CATEGORIES: CategoryDef[] = [
  // Income
  { key: 'rental_income', taxTreatment: 'income', label: 'Rental income', class: 'income' },
  { key: 'padsplit_deposit', taxTreatment: 'income', label: 'PadSplit deposit', class: 'income' },
  { key: 'pm_disbursement', taxTreatment: 'income', label: 'PM disbursement', class: 'income' },
  { key: 'other_income', taxTreatment: 'income', label: 'Other income', class: 'income' },

  // Not income — real cash movements that are not revenue
  {
    key: 'security_deposit_received', taxTreatment: 'not_reportable',
    label: 'Security deposit received',
    class: 'not_income',
    excludeFromPnl: true,
    note: 'A liability, not income. A move-in month would otherwise show phantom revenue.',
  },
  {
    key: 'security_deposit_returned', taxTreatment: 'not_reportable',
    label: 'Security deposit returned',
    class: 'not_income',
    excludeFromPnl: true,
    note: 'Repayment of a liability. A move-out month would otherwise show a phantom loss.',
  },
  { key: 'transfer_between_own_accounts', taxTreatment: 'not_reportable', label: 'Transfer between own accounts', class: 'not_income', excludeFromPnl: true },
  { key: 'owner_contribution', taxTreatment: 'not_reportable', label: 'Owner contribution', class: 'not_income', excludeFromPnl: true },
  {
    key: 'loan_proceeds',
    taxTreatment: 'not_reportable',
    label: 'Loan proceeds',
    class: 'not_income',
    excludeFromPnl: true,
    note: 'Money borrowed is not income — it is debt, and it is repaid. What the money then buys is classified on its own merits, and the interest is deductible as it is paid.',
  },
  { key: 'owner_draw', taxTreatment: 'not_reportable', label: 'Owner draw', class: 'not_income', excludeFromPnl: true },
  {
    key: 'not_portfolio', taxTreatment: 'not_reportable',
    label: 'Not portfolio',
    class: 'not_income',
    excludeFromPnl: true,
    note: 'A charge that landed in an account it does not belong to — flagged foreign, never force-assigned to whichever property’s statement it turned up in.',
  },

  // Expense
  { key: 'electric', taxTreatment: 'deductible', taxLine: 'utilities', label: 'Electric', class: 'expense' },
  { key: 'gas', taxTreatment: 'deductible', taxLine: 'utilities', label: 'Gas', class: 'expense' },
  { key: 'water_sewer', taxTreatment: 'deductible', taxLine: 'utilities', label: 'Water & sewer', class: 'expense' },
  { key: 'trash', taxTreatment: 'deductible', taxLine: 'utilities', label: 'Trash', class: 'expense' },
  { key: 'internet', taxTreatment: 'deductible', taxLine: 'utilities', label: 'Internet', class: 'expense' },
  { key: 'supplies', taxTreatment: 'deductible', taxLine: 'supplies', label: 'Supplies', class: 'expense' },
  {
    key: 'furnishings', taxTreatment: 'capitalizable', taxLine: 'depreciation',
    label: 'Furnishings',
    class: 'expense',
    note: 'Broken out from supplies deliberately: for a furnished rental these are a capitalizable asset class with distinct tax treatment.',
  },
  { key: 'turn_cleaning', taxTreatment: 'deductible', taxLine: 'cleaning_maintenance', label: 'Turn & cleaning', class: 'expense' },
  { key: 'maintenance_repairs', taxTreatment: 'deductible', taxLine: 'repairs', label: 'Maintenance & repairs', class: 'expense' },
  { key: 'lawn', taxTreatment: 'deductible', taxLine: 'cleaning_maintenance', label: 'Lawn', class: 'expense' },
  {
    key: 'pest_control',
    taxTreatment: 'deductible',
    taxLine: 'cleaning_maintenance',
    label: 'Pest control',
    class: 'expense',
  },
  {
    key: 'home_warranty',
    taxTreatment: 'deductible',
    taxLine: 'repairs',
    label: 'Home warranty',
    class: 'expense',
    note: 'A service contract covering repairs, so it lands on the repairs line. Some accountants prefer insurance — the mapping is shown in Reports, and can be overridden in Settings if yours disagrees.',
  },
  { key: 'insurance', taxTreatment: 'deductible', taxLine: 'insurance', label: 'Insurance', class: 'expense' },
  { key: 'property_tax', taxTreatment: 'deductible', taxLine: 'taxes', label: 'Property tax', class: 'expense' },
  { key: 'hoa', taxTreatment: 'deductible', taxLine: 'other', label: 'HOA', class: 'expense' },
  {
    key: 'debt_service', taxTreatment: 'not_reportable',
    label: 'Debt service',
    class: 'expense',
    note: 'The bank shows one number; the amortization schedule splits it into principal and interest (§8).',
  },
  { key: 'capex', taxTreatment: 'capitalizable', taxLine: 'depreciation', label: 'Capex', class: 'expense' },
  { key: 'professional_fees', taxTreatment: 'deductible', taxLine: 'legal_professional', label: 'Professional fees', class: 'expense' },
  {
    key: 'pm_fee', taxTreatment: 'deductible', taxLine: 'management_fees',
    label: 'PM fee',
    class: 'expense',
    note: 'Derived from the PadSplit rollup, never entered (§9).',
  },
  {
    key: 'pm_opex_underived', taxTreatment: 'deductible', taxLine: 'repairs',
    label: 'PM opex (underived)',
    class: 'expense',
    note: 'The single residual line posted until the PM statement importer exists (§5).',
  },
  {
    key: 'operator_management_fee', taxTreatment: 'deductible', taxLine: 'management_fees',
    label: 'Operator management fee',
    class: 'expense',
    intercompany: true,
    note: 'An expense at property level and income to the recipient. Excluded from consolidated views so it is not counted as both a cost and a receipt (§3).',
  },
  {
    key: 'bank_fee', taxTreatment: 'deductible', taxLine: 'other',
    label: 'Bank fee',
    class: 'expense',
    note: 'A fee the bank reverses is categorized here too, on the credit side. The two carry opposite signs, so they cancel and the line ends at what was actually kept.',
  },
  { key: 'other_expense', taxTreatment: 'deductible', taxLine: 'other', label: 'Other', class: 'expense' },
];

/**
 * The categories in play.
 *
 * Always passed explicitly, never defaulted. It used to be optional, falling
 * back to the built-ins, and a single caller that forgot it rejected every
 * category anyone had added themselves — a rule for a new Phone category came
 * back "Unknown category: phone" while the picker offered it happily. A
 * default that is right almost everywhere is worse than no default: the one
 * place it is wrong fails silently and looks like the user's mistake. Pass
 * CATEGORIES where the built-ins really are what is meant.
 */
export type CategoryCatalog = readonly CategoryDef[];

export function category(key: string, catalog: CategoryCatalog): CategoryDef | null {
  return catalog.find((definition) => definition.key === key) ?? null;
}

export function isIncome(key: string, catalog: CategoryCatalog): boolean {
  return category(key, catalog)?.class === 'income';
}

export function isExpense(key: string, catalog: CategoryCatalog): boolean {
  return category(key, catalog)?.class === 'expense';
}

/** Excluded from the P&L: deposits held, transfers, owner cash, foreign charges. */
export function affectsPnl(key: string, catalog: CategoryCatalog): boolean {
  const def = category(key, catalog);
  return def !== null && !def.excludeFromPnl;
}

export function isIntercompany(key: string, catalog: CategoryCatalog): boolean {
  return category(key, catalog)?.intercompany === true;
}

/**
 * Built-ins plus anything added later. A custom entry sharing a built-in's key
 * replaces it, which is how a mapping you disagree with gets corrected.
 */
export function mergeCatalog(custom: readonly CategoryDef[]): CategoryDef[] {
  const merged = new Map(CATEGORIES.map((definition) => [definition.key, definition]));
  for (const definition of custom) merged.set(definition.key, definition);
  return [...merged.values()];
}

/** A label into a stable key: "Pest Control" becomes "pest_control". */
export function keyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function taxLineFor(key: string, catalog: CategoryCatalog): ScheduleELine | null {
  return category(key, catalog)?.taxLine ?? null;
}

export function taxTreatmentFor(key: string, catalog: CategoryCatalog): TaxTreatment | null {
  return category(key, catalog)?.taxTreatment ?? null;
}

/** Spend that is depreciated rather than deducted in the year it happened. */
export function isCapitalizable(key: string, catalog: CategoryCatalog): boolean {
  return category(key, catalog)?.taxTreatment === 'capitalizable';
}

/**
 * Categories that come in pairs, one for each direction the money moved.
 *
 * The description on a transfer between your own accounts is identical
 * whichever way it went — only the sign says whether you took money out or put
 * it in. A single rule per payee would get one of them wrong every time.
 */
export const DIRECTIONAL_PAIRS: { debit: string; credit: string }[] = [
  { debit: 'owner_draw', credit: 'owner_contribution' },
  { debit: 'security_deposit_returned', credit: 'security_deposit_received' },
];

/** The category this one becomes when the money goes the other way. */
export function oppositeCategory(key: string): { key: string; direction: 'debit' | 'credit' } | null {
  for (const pair of DIRECTIONAL_PAIRS) {
    if (pair.debit === key) return { key: pair.credit, direction: 'credit' };
    if (pair.credit === key) return { key: pair.debit, direction: 'debit' };
  }
  return null;
}

/** Which way a category expects money to move, where it only makes sense one way. */
export function expectedDirection(key: string): 'debit' | 'credit' | null {
  for (const pair of DIRECTIONAL_PAIRS) {
    if (pair.debit === key) return 'debit';
    if (pair.credit === key) return 'credit';
  }
  return null;
}

export const DEPOSIT_LIABILITY_CATEGORIES = [
  'security_deposit_received',
  'security_deposit_returned',
] as const;
