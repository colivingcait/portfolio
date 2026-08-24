/**
 * The categorization vocabulary (§7).
 *
 * One account per property means the file is the property: the hard half of
 * classification — WHICH property — is answered by the upload itself. Only
 * WHAT KIND remains. One dimension, small vocabulary.
 */

export type CategoryClass = 'income' | 'not_income' | 'expense';

export interface CategoryDef {
  key: string;
  label: string;
  class: CategoryClass;
  /** Excluded from the P&L. */
  excludeFromPnl?: boolean;
  /** Netted out of consolidated views so it isn't both a cost and a receipt. */
  intercompany?: boolean;
  note?: string;
}

export const CATEGORIES: CategoryDef[] = [
  // Income
  { key: 'rental_income', label: 'Rental income', class: 'income' },
  { key: 'padsplit_deposit', label: 'PadSplit deposit', class: 'income' },
  { key: 'pm_disbursement', label: 'PM disbursement', class: 'income' },
  { key: 'other_income', label: 'Other income', class: 'income' },

  // Not income — real cash movements that are not revenue
  {
    key: 'security_deposit_received',
    label: 'Security deposit received',
    class: 'not_income',
    excludeFromPnl: true,
    note: 'A liability, not income. A move-in month would otherwise show phantom revenue.',
  },
  {
    key: 'security_deposit_returned',
    label: 'Security deposit returned',
    class: 'not_income',
    excludeFromPnl: true,
    note: 'Repayment of a liability. A move-out month would otherwise show a phantom loss.',
  },
  { key: 'transfer_between_own_accounts', label: 'Transfer between own accounts', class: 'not_income', excludeFromPnl: true },
  { key: 'owner_contribution', label: 'Owner contribution', class: 'not_income', excludeFromPnl: true },
  { key: 'owner_draw', label: 'Owner draw', class: 'not_income', excludeFromPnl: true },
  {
    key: 'not_portfolio',
    label: 'Not portfolio',
    class: 'not_income',
    excludeFromPnl: true,
    note: 'A charge that landed in an account it does not belong to — flagged foreign, never force-assigned to whichever property’s statement it turned up in.',
  },

  // Expense
  { key: 'electric', label: 'Electric', class: 'expense' },
  { key: 'gas', label: 'Gas', class: 'expense' },
  { key: 'water_sewer', label: 'Water & sewer', class: 'expense' },
  { key: 'trash', label: 'Trash', class: 'expense' },
  { key: 'internet', label: 'Internet', class: 'expense' },
  { key: 'supplies', label: 'Supplies', class: 'expense' },
  {
    key: 'furnishings',
    label: 'Furnishings',
    class: 'expense',
    note: 'Broken out from supplies deliberately: for a furnished rental these are a capitalizable asset class with distinct tax treatment.',
  },
  { key: 'turn_cleaning', label: 'Turn & cleaning', class: 'expense' },
  { key: 'maintenance_repairs', label: 'Maintenance & repairs', class: 'expense' },
  { key: 'lawn', label: 'Lawn', class: 'expense' },
  { key: 'insurance', label: 'Insurance', class: 'expense' },
  { key: 'property_tax', label: 'Property tax', class: 'expense' },
  { key: 'hoa', label: 'HOA', class: 'expense' },
  {
    key: 'debt_service',
    label: 'Debt service',
    class: 'expense',
    note: 'The bank shows one number; the amortization schedule splits it into principal and interest (§8).',
  },
  { key: 'capex', label: 'Capex', class: 'expense' },
  { key: 'professional_fees', label: 'Professional fees', class: 'expense' },
  {
    key: 'pm_fee',
    label: 'PM fee',
    class: 'expense',
    note: 'Derived from the PadSplit rollup, never entered (§9).',
  },
  {
    key: 'pm_opex_underived',
    label: 'PM opex (underived)',
    class: 'expense',
    note: 'The single residual line posted until the PM statement importer exists (§5).',
  },
  {
    key: 'operator_management_fee',
    label: 'Operator management fee',
    class: 'expense',
    intercompany: true,
    note: 'An expense at property level and income to the recipient. Excluded from consolidated views so it is not counted as both a cost and a receipt (§3).',
  },
  { key: 'other_expense', label: 'Other', class: 'expense' },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export function category(key: string): CategoryDef | null {
  return BY_KEY.get(key) ?? null;
}

export function isIncome(key: string): boolean {
  return category(key)?.class === 'income';
}

export function isExpense(key: string): boolean {
  return category(key)?.class === 'expense';
}

/** Excluded from the P&L: deposits held, transfers, owner cash, foreign charges. */
export function affectsPnl(key: string): boolean {
  const def = category(key);
  return def !== null && !def.excludeFromPnl;
}

export function isIntercompany(key: string): boolean {
  return category(key)?.intercompany === true;
}

export const DEPOSIT_LIABILITY_CATEGORIES = [
  'security_deposit_received',
  'security_deposit_returned',
] as const;
