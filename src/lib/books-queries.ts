import 'server-only';
import { prisma } from './db';
import { requireIsoDate, toLoanPayment, toLoanTerms } from './mappers';
import { buildSchedule } from './engine/amortization';
import { buildBalanceSheet, buildPnl, type BalanceSheet, type LedgerLine, type PnlReport } from './engine/statements';
import { monthOf, type MonthKey } from './engine/dates';
import { getCategoryCatalog } from './categories-queries';
import { category, type CategoryCatalog } from './engine/categories';
import { findReversals } from './engine/bank';
import { formatCents } from './engine/money';

export interface TransactionFilters {
  propertyId?: string;
  accountId?: string;
  categoryKey?: string;
  /**
   * 'uncategorized' for rows with no category yet, 'unconfirmed' for rows a
   * rule filed that nobody has looked at, 'split' for containers.
   */
  state?: 'all' | 'uncategorized' | 'unconfirmed' | 'categorized' | 'split';
  from?: string;
  to?: string;
  search?: string;
  page?: number;
}

export interface RegisterRow {
  id: string;
  date: string;
  propertyName: string;
  accountLabel: string;
  description: string;
  memo: string | null;
  amountCents: number;
  categoryKey: string | null;
  categoryLabel: string | null;
  confirmed: boolean;
  statementId: string;
  isSplit: boolean;
  splits: { id: string; categoryKey: string | null; categoryLabel: string | null; amountCents: number; memo: string | null }[];
  /**
   * Where the row has no category yet, what to open the picker on. A credit is
   * nearly always income and a debit nearly always a cost — a starting point,
   * not a guess that saves itself.
   */
  suggestion: string | null;
  /** Set where the row looks like it cancels another one, or is cancelled by it. */
  reversalOf: {
    description: string;
    date: string;
    amount: string;
    /** Null where the other half has not been categorized either. */
    categoryLabel: string | null;
  } | null;
}

export interface RegisterPage {
  rows: RegisterRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Totals across everything the filter matched, not just this page. */
  inCents: number;
  outCents: number;
  categories: { key: string; label: string }[];
  properties: { value: string; label: string }[];
  accounts: { value: string; label: string }[];
  /** Rows still unfiled, across everything — not just what the filter matched. */
  uncategorized: number;
  /** Filed by a rule at import and never looked at. Same caveat: unfiltered. */
  unconfirmed: number;
}

const PAGE_SIZE = 100;

function labelOf(key: string | null, catalog: CategoryCatalog): string | null {
  if (!key) return null;
  return category(key, catalog)?.label ?? key;
}

/**
 * The register: every line the bank has, with what it was called.
 *
 * This is the page a bookkeeper lives on. Categorizing happens once in Review,
 * but revising happens forever — a repair that turns out to be an improvement,
 * a charge that turns out to belong to another house.
 */
export async function getRegister(filters: TransactionFilters): Promise<RegisterPage> {
  const catalog = await getCategoryCatalog();
  const page = Math.max(1, filters.page ?? 1);

  const where = {
    // Pieces of a split are shown under their parent, never as rows of their own.
    splitParentId: null,
    ...(filters.state === 'uncategorized' ? { categoryKey: null, splits: { none: {} } } : {}),
    ...(filters.state === 'unconfirmed' ? { NOT: { categoryKey: null }, confirmed: false } : {}),
    ...(filters.state === 'categorized' ? { NOT: { categoryKey: null } } : {}),
    ...(filters.state === 'split' ? { splits: { some: {} } } : {}),
    ...(filters.categoryKey ? { categoryKey: filters.categoryKey } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00Z`) } : {}),
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { description: { contains: filters.search, mode: 'insensitive' as const } },
            { memo: { contains: filters.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(filters.accountId || filters.propertyId
      ? {
          statement: {
            ...(filters.accountId ? { bankAccountId: filters.accountId } : {}),
            ...(filters.propertyId ? { bankAccount: { propertyId: filters.propertyId } } : {}),
          },
        }
      : {}),
  };

  const [rows, total, sums, properties, accounts, uncategorized, unconfirmed] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      include: {
        statement: { include: { bankAccount: { include: { property: true } } } },
        splits: { orderBy: { amountCents: 'desc' } },
      },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.bankTransaction.count({ where }),
    // Money in and out across the whole filter, so the figure at the top is
    // about what was asked for rather than about which page you happen to be on.
    prisma.bankTransaction.findMany({ where, select: { amountCents: true } }),
    prisma.property.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.bankAccount.findMany({ include: { property: true }, orderBy: { label: 'asc' } }),
    // Deliberately unfiltered: the backlog is a fact about the books, not about
    // whatever the filter happens to be narrowed to.
    prisma.bankTransaction.count({ where: { splitParentId: null, categoryKey: null, splits: { none: {} } } }),
    prisma.bankTransaction.count({ where: { splitParentId: null, NOT: { categoryKey: null }, confirmed: false } }),
  ]);

  const reversals = await findReversalHints(rows);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      date: requireIsoDate(row.date),
      propertyName: row.statement.bankAccount.property.name,
      suggestion:
        row.categoryKey === null
          ? (reversals.get(row.id)?.categoryKey ?? (row.amountCents > 0 ? 'rental_income' : 'maintenance_repairs'))
          : null,
      reversalOf: row.categoryKey === null ? (reversals.get(row.id)?.hint ?? null) : null,
      accountLabel: row.statement.bankAccount.label,
      description: row.description,
      memo: row.memo,
      amountCents: row.amountCents,
      categoryKey: row.categoryKey,
      categoryLabel: labelOf(row.categoryKey, catalog),
      confirmed: row.confirmed,
      statementId: row.statementId,
      isSplit: row.splits.length > 0,
      splits: row.splits.map((split) => ({
        id: split.id,
        categoryKey: split.categoryKey,
        categoryLabel: labelOf(split.categoryKey, catalog),
        amountCents: split.amountCents,
        memo: split.memo,
      })),
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    inCents: sums.filter((s) => s.amountCents > 0).reduce((sum, s) => sum + s.amountCents, 0),
    outCents: sums.filter((s) => s.amountCents < 0).reduce((sum, s) => sum - s.amountCents, 0),
    categories: catalog.map((c) => ({ key: c.key, label: c.label })),
    properties: properties.map((p) => ({ value: p.id, label: p.name })),
    accounts: accounts.map((a) => ({ value: a.id, label: `${a.property.name} · ${a.label}` })),
    uncategorized,
    unconfirmed,
  };
}

export interface PnlData extends PnlReport {
  year: number;
  propertyId: string | null;
  propertyName: string | null;
  properties: { value: string; label: string }[];
  years: number[];
}

export async function getPnl(year: number, propertyId: string | null): Promise<PnlData> {
  const months: MonthKey[] = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const [catalog, transactions, properties, statements] = await Promise.all([
    getCategoryCatalog(),
    prisma.bankTransaction.findMany({
      where: {
        statement: {
          status: 'posted',
          ...(propertyId ? { bankAccount: { propertyId } } : {}),
        },
        date: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) },
        // The pieces of a split are the entries; the container is not.
        splits: { none: {} },
      },
      include: { statement: { include: { bankAccount: true } } },
    }),
    prisma.property.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.bankStatement.findMany({ select: { periodStart: true, periodEnd: true } }),
  ]);

  const lines: LedgerLine[] = transactions.map((t) => ({
    month: monthOf(requireIsoDate(t.date)),
    propertyId: t.statement.bankAccount.propertyId,
    categoryKey: t.categoryKey,
    amountCents: t.amountCents,
  }));

  const years = [
    ...new Set(statements.flatMap((s) => [s.periodStart.getUTCFullYear(), s.periodEnd.getUTCFullYear()])),
  ].sort((a, b) => b - a);

  return {
    ...buildPnl(lines, months, { catalog, consolidated: propertyId === null }),
    year,
    propertyId,
    propertyName: propertyId ? (properties.find((p) => p.id === propertyId)?.name ?? null) : null,
    properties: properties.map((p) => ({ value: p.id, label: p.name })),
    years: years.length > 0 ? years : [year],
  };
}

export interface BalanceSheetData extends BalanceSheet {
  asOf: string;
}

export async function getBalanceSheet(basis: 'cost' | 'market'): Promise<BalanceSheetData> {
  const [properties, loans, accounts, leases, capital] = await Promise.all([
    prisma.property.findMany({ orderBy: { name: 'asc' } }),
    prisma.loan.findMany({ where: { status: 'active' }, include: { payments: true } }),
    prisma.bankAccount.findMany({
      include: {
        property: true,
        statements: { where: { status: 'posted' }, orderBy: { periodEnd: 'desc' }, take: 1 },
      },
      orderBy: { label: 'asc' },
    }),
    prisma.lease.findMany(),
    prisma.capitalAccountEntry.findMany(),
  ]);

  const valuations = await prisma.valuation.findMany({ orderBy: { date: 'desc' } });
  const today = new Date().toISOString().slice(0, 10);

  const debtByProperty = new Map<string, number>();
  for (const loan of loans) {
    const schedule = buildSchedule(toLoanTerms(loan), loan.payments.map(toLoanPayment));
    const last = [...schedule].reverse().find((row) => row.dueDate <= today);
    const balance = last ? last.closingBalanceCents : loan.originalPrincipalCents;
    debtByProperty.set(loan.propertyId, (debtByProperty.get(loan.propertyId) ?? 0) + balance);
  }

  const sheet = buildBalanceSheet(
    {
      properties: properties.map((property) => ({
        propertyId: property.id,
        propertyName: property.name,
        costCents: property.purchasePriceCents,
        valueCents: valuations.find((v) => v.propertyId === property.id)?.valueCents ?? null,
        debtCents: debtByProperty.get(property.id) ?? 0,
      })),
      cash: accounts.map((account) => ({
        accountId: account.id,
        label: `${account.property.name} · ${account.label}`,
        balanceCents: account.statements[0]?.closingBalanceCents ?? 0,
        asOf: account.statements[0] ? requireIsoDate(account.statements[0].periodEnd) : null,
      })),
      // A deposit is owed back until the lease ends, so an ended lease no
      // longer counts against you here.
      depositsHeldCents: leases
        .filter((lease) => !lease.endDate || requireIsoDate(lease.endDate) >= today)
        .reduce((sum, lease) => sum + lease.depositHeldCents, 0),
      contributionsCents: capital
        .filter((entry) => entry.kind === 'contribution')
        .reduce((sum, entry) => sum + entry.amountCents, 0),
      distributionsCents: capital
        .filter((entry) => entry.kind !== 'contribution')
        .reduce((sum, entry) => sum + entry.amountCents, 0),
    },
    basis,
  );

  return { ...sheet, asOf: today };
}

/**
 * Charges the bank later reversed, paired with the row that cancelled them.
 *
 * Looked for against every row on the account rather than only the ones still
 * needing a category: the charge is usually categorized already and it is the
 * reversal that is still sitting unfiled. Scoped per account, since a fee on
 * one house has nothing to do with a credit of the same size on another.
 *
 * This used to live on the Review page. It moved here when Review and the
 * register became one screen, so the hint follows the row wherever it is shown.
 */
async function findReversalHints(
  visible: readonly { id: string; categoryKey: string | null }[],
): Promise<Map<string, { categoryKey: string | null; hint: RegisterRow['reversalOf'] }>> {
  const found = new Map<string, { categoryKey: string | null; hint: RegisterRow['reversalOf'] }>();
  const needed = visible.filter((row) => row.categoryKey === null);
  if (needed.length === 0) return found;

  const [everything, catalog] = await Promise.all([
    prisma.bankTransaction.findMany({
      select: {
        id: true,
        date: true,
        description: true,
        amountCents: true,
        categoryKey: true,
        statement: { select: { bankAccountId: true } },
      },
    }),
    getCategoryCatalog(),
  ]);

  const byAccount = new Map<string, typeof everything>();
  for (const transaction of everything) {
    const list = byAccount.get(transaction.statement.bankAccountId) ?? [];
    list.push(transaction);
    byAccount.set(transaction.statement.bankAccountId, list);
  }

  const label = (key: string | null) => (key ? (category(key, catalog)?.label ?? null) : null);

  for (const rows of byAccount.values()) {
    const pairs = findReversals(
      rows.map((r) => ({ date: requireIsoDate(r.date), description: r.description, amountCents: r.amountCents })),
    );
    for (const pair of pairs) {
      // Either half can be the one still needing a category.
      const later = rows[pair.index];
      const original = rows[pair.originalIndex];
      found.set(later.id, {
        categoryKey: original.categoryKey,
        hint: {
          description: original.description,
          date: requireIsoDate(original.date),
          amount: formatCents(original.amountCents),
          categoryLabel: label(original.categoryKey),
        },
      });
      found.set(original.id, {
        categoryKey: later.categoryKey,
        hint: {
          description: later.description,
          date: requireIsoDate(later.date),
          amount: formatCents(later.amountCents),
          categoryLabel: label(later.categoryKey),
        },
      });
    }
  }

  return found;
}
