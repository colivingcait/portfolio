/**
 * The two statements every bookkeeper reaches for first (§5, §8).
 *
 * A profit and loss says what the year earned. A balance sheet says what the
 * portfolio is worth and who has a claim on it. They answer different
 * questions and disagree by design: a mortgage payment is mostly invisible on
 * the first and moves the second every month.
 *
 * Cash basis throughout, keyed to when money moved, which is what a small
 * landlord files and what the bank statements can actually support.
 */

import { affectsPnl, category, isIncome, isIntercompany, type CategoryCatalog } from './categories';
import type { MonthKey } from './dates';
import { sumCents, type Cents } from './money';

export interface LedgerLine {
  month: MonthKey;
  propertyId: string;
  categoryKey: string | null;
  /** Credits positive, debits negative. */
  amountCents: Cents;
}

export interface PnlRow {
  categoryKey: string;
  label: string;
  /** Positive for both income and expense — the sign lives in the section. */
  byMonth: Record<MonthKey, Cents>;
  totalCents: Cents;
}

export interface PnlReport {
  months: MonthKey[];
  income: PnlRow[];
  expenses: PnlRow[];
  incomeByMonth: Record<MonthKey, Cents>;
  expenseByMonth: Record<MonthKey, Cents>;
  netByMonth: Record<MonthKey, Cents>;
  totalIncomeCents: Cents;
  totalExpenseCents: Cents;
  netCents: Cents;
  /** Real money that is not income or cost: deposits held, transfers, owner cash. */
  excludedCents: Cents;
  uncategorizedCents: Cents;
  uncategorizedCount: number;
}

function emptyByMonth(months: readonly MonthKey[]): Record<MonthKey, Cents> {
  return Object.fromEntries(months.map((month) => [month, 0]));
}

/**
 * Income and cost by category and month.
 *
 * Only categories that affect the P&L are counted. A security deposit is cash
 * in the account and not a penny of income; a transfer between your own
 * accounts is neither. Counting them would make a good month out of a quiet
 * one.
 */
export function buildPnl(
  lines: readonly LedgerLine[],
  months: readonly MonthKey[],
  options: { catalog?: CategoryCatalog; consolidated?: boolean } = {},
): PnlReport {
  const inRange = lines.filter((line) => months.includes(line.month));

  const income = new Map<string, Record<MonthKey, Cents>>();
  const expenses = new Map<string, Record<MonthKey, Cents>>();
  let excluded = 0;
  let uncategorized = 0;
  let uncategorizedCount = 0;

  for (const line of inRange) {
    if (!line.categoryKey) {
      uncategorized += line.amountCents;
      uncategorizedCount += 1;
      continue;
    }

    const definition = category(line.categoryKey, options.catalog);
    if (!definition) {
      uncategorized += line.amountCents;
      uncategorizedCount += 1;
      continue;
    }

    // A management fee one entity charges another is a cost to the property
    // and income to the manager. Across a consolidated view it is neither (§3).
    if (options.consolidated && isIntercompany(line.categoryKey, options.catalog)) continue;

    if (!affectsPnl(line.categoryKey, options.catalog)) {
      excluded += line.amountCents;
      continue;
    }

    const target = isIncome(line.categoryKey, options.catalog) ? income : expenses;
    const bucket = target.get(line.categoryKey) ?? emptyByMonth(months);
    // Expenses arrive negative; a P&L line is a positive figure, and the
    // section it sits in carries the sign.
    bucket[line.month] += target === income ? line.amountCents : -line.amountCents;
    target.set(line.categoryKey, bucket);
  }

  const toRows = (source: Map<string, Record<MonthKey, Cents>>): PnlRow[] =>
    [...source.entries()]
      .map(([categoryKey, byMonth]) => ({
        categoryKey,
        label: category(categoryKey, options.catalog)?.label ?? categoryKey,
        byMonth,
        totalCents: sumCents(Object.values(byMonth)),
      }))
      .filter((row) => row.totalCents !== 0 || Object.values(row.byMonth).some((v) => v !== 0))
      .sort((a, b) => b.totalCents - a.totalCents || a.label.localeCompare(b.label));

  const incomeRows = toRows(income);
  const expenseRows = toRows(expenses);

  const incomeByMonth = emptyByMonth(months);
  const expenseByMonth = emptyByMonth(months);
  const netByMonth = emptyByMonth(months);
  for (const month of months) {
    incomeByMonth[month] = sumCents(incomeRows.map((r) => r.byMonth[month]));
    expenseByMonth[month] = sumCents(expenseRows.map((r) => r.byMonth[month]));
    netByMonth[month] = incomeByMonth[month] - expenseByMonth[month];
  }

  const totalIncome = sumCents(incomeRows.map((r) => r.totalCents));
  const totalExpense = sumCents(expenseRows.map((r) => r.totalCents));

  return {
    months: [...months],
    income: incomeRows,
    expenses: expenseRows,
    incomeByMonth,
    expenseByMonth,
    netByMonth,
    totalIncomeCents: totalIncome,
    totalExpenseCents: totalExpense,
    netCents: totalIncome - totalExpense,
    excludedCents: excluded,
    uncategorizedCents: uncategorized,
    uncategorizedCount,
  };
}

export interface BalanceSheetInput {
  /** What each property is carried at, and on what footing. */
  properties: {
    propertyId: string;
    propertyName: string;
    /** What it cost, where that is known. */
    costCents: Cents | null;
    /** What it is thought to be worth now, where a valuation exists. */
    valueCents: Cents | null;
    debtCents: Cents;
  }[];
  /** Closing balance on each account's most recent posted statement. */
  cash: { accountId: string; label: string; balanceCents: Cents; asOf: string | null }[];
  /** Security deposits taken and not yet returned — someone else's money. */
  depositsHeldCents: Cents;
  contributionsCents: Cents;
  distributionsCents: Cents;
}

export interface BalanceSheetLine {
  label: string;
  amountCents: Cents;
  detail?: string;
}

export interface BalanceSheet {
  basis: 'cost' | 'market';
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  totalAssetsCents: Cents;
  totalLiabilitiesCents: Cents;
  /** Assets less liabilities. What would be left if everything settled today. */
  netWorthCents: Cents;
  equity: BalanceSheetLine[];
  /**
   * Net worth less what owners put in and took out. On a set of books built
   * from bank statements rather than journal entries this is a residual, not a
   * independently computed figure — it is what makes the two sides agree.
   */
  retainedCents: Cents;
  warnings: string[];
}

/**
 * What is owned, what is owed, and what is left.
 *
 * Two honest caveats, both surfaced rather than buried. These books are built
 * from bank statements, not double-entry journals, so the equity side is a
 * residual: it balances because it is defined to. And a property can be shown
 * at cost or at estimated value — cost is what a tax return uses, value is
 * what the equity is actually worth, and the two are rarely close.
 */
export function buildBalanceSheet(input: BalanceSheetInput, basis: 'cost' | 'market' = 'market'): BalanceSheet {
  const warnings: string[] = [];

  const propertyLines = input.properties.map((property) => {
    const carried = basis === 'cost' ? property.costCents : (property.valueCents ?? property.costCents);
    return {
      label: property.propertyName,
      amountCents: carried ?? 0,
      detail:
        carried === null
          ? 'no cost or valuation on record'
          : basis === 'market' && property.valueCents === null
            ? 'no valuation — shown at cost'
            : undefined,
    };
  });

  const missing = input.properties.filter(
    (p) => (basis === 'cost' ? p.costCents : (p.valueCents ?? p.costCents)) === null,
  );
  if (missing.length > 0) {
    warnings.push(
      `${missing.map((p) => p.propertyName).join(', ')} ${missing.length === 1 ? 'is' : 'are'} carried at zero: no ${basis === 'cost' ? 'acquisition cost' : 'valuation or cost'} on record. Every total below is understated until that is entered.`,
    );
  }

  const staleCash = input.cash.filter((account) => account.asOf === null);
  if (staleCash.length > 0) {
    warnings.push(
      `${staleCash.length} account${staleCash.length === 1 ? ' has' : 's have'} no posted statement, so ${staleCash.length === 1 ? 'its balance is' : 'their balances are'} shown as zero.`,
    );
  }

  const cashLines = input.cash.map((account) => ({
    label: account.label,
    amountCents: account.balanceCents,
    detail: account.asOf ? `as of ${account.asOf}` : 'no statement imported',
  }));

  const assets: BalanceSheetLine[] = [...propertyLines, ...cashLines];
  const liabilities: BalanceSheetLine[] = [
    ...input.properties
      .filter((p) => p.debtCents !== 0)
      .map((p) => ({ label: `${p.propertyName} — debt`, amountCents: p.debtCents })),
  ];
  if (input.depositsHeldCents !== 0) {
    liabilities.push({
      label: 'Security deposits held',
      amountCents: input.depositsHeldCents,
      detail: 'a tenant’s money sitting in your account, owed back',
    });
  }

  const totalAssets = sumCents(assets.map((a) => a.amountCents));
  const totalLiabilities = sumCents(liabilities.map((l) => l.amountCents));
  const netWorth = totalAssets - totalLiabilities;
  const retained = netWorth - input.contributionsCents + input.distributionsCents;

  return {
    basis,
    assets,
    liabilities,
    totalAssetsCents: totalAssets,
    totalLiabilitiesCents: totalLiabilities,
    netWorthCents: netWorth,
    equity: [
      { label: 'Owner contributions', amountCents: input.contributionsCents },
      { label: 'Owner distributions', amountCents: -input.distributionsCents },
      { label: 'Retained (residual)', amountCents: retained },
    ],
    retainedCents: retained,
    warnings,
  };
}
