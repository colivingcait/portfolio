import 'server-only';
import { prisma } from './db';
import { getCategoryCatalog } from './categories-queries';
import { SCHEDULE_E_LINES } from './engine/tax';
import { requireIsoDate } from './mappers';
import { monthOf } from './engine/dates';
import { category } from './engine/categories';

/**
 * What the assistant is told about this system before it is asked anything.
 *
 * The point of a box like this is not that it can answer accounting questions
 * in general — anything can. It is that it answers them in the vocabulary of
 * THIS set of books: these categories, these properties, these conventions.
 * A generic answer about capitalizing a water line is worth much less than one
 * that says which category to pick and what the split does to the tax line.
 */

/** Stable across a session and worth caching: the rules this build encodes. */
export const CONVENTIONS = `
This tool is a single-user bookkeeping and reporting system for a small
residential rental portfolio. It replaces a monthly spreadsheet. The person
asking is the owner, not an accountant.

How it is built, in the terms the answers should use:

- One bank account per property. On import, the file IS the property.
- Categorizing is operational (Electric, Lawn, Pest control). Each category
  carries a tax treatment and a Schedule E line underneath, so the person never
  has to think about tax lines while doing monthly work.
- Tax treatments: "income", "deductible" (goes to a Schedule E line),
  "capitalizable" (depreciated, listed separately, NOT in the expense total),
  "not_reportable" (real money, no tax consequence).
- Some categories are excluded from the profit and loss even though real money
  moved: security deposits received or returned, transfers between own
  accounts, owner draws and contributions, loan proceeds, and charges that are
  not portfolio at all. They are cash, not income or cost.
- Debt service is ONE category. The bank shows one undivided payment; the
  amortization schedule splits it into interest (deductible, Schedule E line
  12), principal (a balance movement, not a cost), and escrow.
- Escrow paid IN is not deductible. What the servicer pays OUT of escrow for
  taxes and insurance is. Those annual amounts are entered on the loan record
  and are the only route those two bills reach Schedule E, since they never
  appear as a bank line.
- Payee rules match by case- and whitespace-insensitive substring on the
  description. A rule only works if its text survives into next month's
  statement, so a rule should be the vendor name alone. Rules can be scoped to
  one account or to every property, and can be direction-aware: the same
  transfer line is an owner draw when money leaves and an owner contribution
  when it arrives.
- A charge can be SPLIT into pieces that must add up to it. The original line
  stays as the bank has it so the statement still ties; the pieces are what the
  books count.
- The PM fee is derived, never entered: 10.5% of gross collected, only for
  months a PM-managed period covers.
- Ownership is a graph. Effective share is the sum, over every path from an
  owner to a property, of the percentages multiplied along that path. Equity
  basis and distribution basis are recorded separately.
- Capital accounts decide what an investor is owed back on sale. A profit
  distribution does NOT reduce that; only capital handed back does.
- Everything is cash basis, keyed to when money moved.

Screens: Portfolio (/), Debt, Payouts, Equity, Books (register at /books,
profit and loss at /books/pnl, balance sheet at /books/balance-sheet, year-end
Schedule E at /reports), Imports, Review, Settings.
`.trim();

export const PERSONA = `
You are the accounting help built into this tool. Answer as a careful
bookkeeper who knows this specific system.

How to answer:
- Be direct and specific. Name the exact category, screen or field to use.
- Lead with the answer. No preamble, no restating the question.
- Keep it short — a few sentences for a simple question. Use a short list only
  when there are genuinely several steps.
- Where the system already handles something automatically, say so, so the
  person does not do it by hand.

Honesty rules, which matter more than being helpful:
- You are not a CPA and this is not tax advice. Say so ONCE, briefly, and only
  where the question is a genuine judgement call with money at stake — a
  repair-versus-improvement line, a basis question, an entity or election
  question. Do not append a disclaimer to routine questions like which
  category a power bill goes in.
- Where accountants genuinely differ, say that and give the common treatment.
- If the question depends on data you have not been given, say what you would
  need rather than inventing a figure. Never guess at a number.
- If something is outside this tool (payroll, sales tax, personal returns),
  say so plainly and stop.
`.trim();

export interface PortfolioSnapshot {
  text: string;
  hasData: boolean;
}

/** The current state of these books, compactly. Regenerated per request. */
export async function buildSnapshot(): Promise<PortfolioSnapshot> {
  const year = new Date().getFullYear();
  const catalog = await getCategoryCatalog();

  const [properties, entities, transactions, uncategorized, loans] = await Promise.all([
    prisma.property.findMany({
      orderBy: { name: 'asc' },
      select: { name: true, revenueSource: true, unitStructure: true, roomCount: true, unitCount: true, status: true },
    }),
    prisma.entity.findMany({ orderBy: { name: 'asc' }, select: { name: true, kind: true, isViewer: true } }),
    prisma.bankTransaction.findMany({
      where: {
        statement: { status: 'posted' },
        date: { gte: new Date(`${year}-01-01T00:00:00Z`) },
        splits: { none: {} },
      },
      select: {
        categoryKey: true,
        amountCents: true,
        date: true,
        statement: { select: { bankAccount: { select: { property: { select: { name: true } } } } } },
      },
    }),
    prisma.bankTransaction.count({ where: { categoryKey: null, splits: { none: {} } } }),
    prisma.loan.findMany({
      where: { status: 'active' },
      select: { lender: true, type: true, ratePercent: true, originalPrincipalCents: true, property: { select: { name: true } } },
    }),
  ]);

  const catalogLines = catalog
    .map((definition) => {
      const line = definition.taxLine
        ? (SCHEDULE_E_LINES.find((l) => l.line === definition.taxLine)?.label ?? definition.taxLine)
        : '—';
      return `  ${definition.key} · "${definition.label}" · ${definition.class} · ${definition.taxTreatment} · ${line}`;
    })
    .join('\n');

  // This year by category and property, which is what most questions need.
  const byProperty = new Map<string, Map<string, number>>();
  const months = new Set<string>();
  for (const transaction of transactions) {
    const property = transaction.statement.bankAccount.property.name;
    months.add(monthOf(requireIsoDate(transaction.date)));
    const bucket = byProperty.get(property) ?? new Map<string, number>();
    const key = transaction.categoryKey ?? 'UNCATEGORIZED';
    bucket.set(key, (bucket.get(key) ?? 0) + transaction.amountCents);
    byProperty.set(property, bucket);
  }

  const money = (cents: number) =>
    `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const activity =
    byProperty.size === 0
      ? '  (no statements imported for this year yet)'
      : [...byProperty.entries()]
          .map(([property, bucket]) => {
            const rows = [...bucket.entries()]
              .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
              .map(([key, cents]) => `      ${category(key, catalog)?.label ?? key}: ${money(cents)}`)
              .join('\n');
            return `  ${property}:\n${rows}`;
          })
          .join('\n');

  const text = `
CATEGORIES IN THIS SYSTEM (key · label · class · tax treatment · Schedule E line):
${catalogLines}

PROPERTIES:
${properties.map((p) => `  ${p.name} — ${p.revenueSource}, ${p.unitStructure}, ${p.roomCount ?? p.unitCount ?? '?'} ${p.unitStructure}, ${p.status}`).join('\n') || '  (none yet)'}

ENTITIES:
${entities.map((e) => `  ${e.name} (${e.kind}${e.isViewer ? ', this is the user' : ''})`).join('\n') || '  (none yet)'}

ACTIVE LOANS:
${loans.map((l) => `  ${l.property.name}: ${l.lender}, ${l.type}, ${Number(l.ratePercent)}%, ${money(l.originalPrincipalCents)} original`).join('\n') || '  (none)'}

${year} ACTIVITY SO FAR, signed as the bank has it (credits positive, debits negative), ${months.size} months imported:
${activity}

OPEN ITEMS:
  ${uncategorized} transactions are uncategorized and therefore in no report.

Today is ${new Date().toISOString().slice(0, 10)}.
`.trim();

  return { text, hasData: properties.length > 0 };
}
