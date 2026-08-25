import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCategoryOptions } from '@/lib/categories-queries';
import { Empty, Note, PageHeader, Panel, Th } from '@/components/ui';
import { ReviewRow } from '@/components/ReviewRow';
import { findReversals } from '@/lib/engine/bank';
import { requireIsoDate } from '@/lib/mappers';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

/**
 * A credit is nearly always income and a debit nearly always a cost, so the
 * dropdown opens on the likelier side. It is a starting point, not a guess
 * that gets saved on its own.
 */
function suggestionFor(amountCents: number): string {
  return amountCents > 0 ? 'rental_income' : 'maintenance_repairs';
}

export default async function ReviewPage() {
  const [categories, unmatched, everything] = await Promise.all([
    getCategoryOptions(),
    prisma.bankTransaction.findMany({
      where: { categoryKey: null },
      include: { statement: { include: { bankAccount: { include: { property: true } } } } },
      orderBy: [{ date: 'desc' }],
      take: 200,
    }),
    // Reversals are looked for against every row on the account, not just the
    // unmatched ones: the charge is usually categorized already and the
    // reversal is the row still sitting here.
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
  ]);

  // Per account, since a fee on one house has nothing to do with a credit of
  // the same size on another.
  const byAccount = new Map<string, typeof everything>();
  for (const transaction of everything) {
    const list = byAccount.get(transaction.statement.bankAccountId) ?? [];
    list.push(transaction);
    byAccount.set(transaction.statement.bankAccountId, list);
  }

  const reversals = new Map<string, { description: string; date: string; categoryKey: string | null; amountCents: number; confidence: string }>();
  for (const rows of byAccount.values()) {
    const pairs = findReversals(
      rows.map((r) => ({ date: requireIsoDate(r.date), description: r.description, amountCents: r.amountCents })),
    );
    for (const pair of pairs) {
      // Either half can be the one still needing a category.
      const later = rows[pair.index];
      const original = rows[pair.originalIndex];
      reversals.set(later.id, {
        description: original.description,
        date: requireIsoDate(original.date),
        categoryKey: original.categoryKey,
        amountCents: original.amountCents,
        confidence: pair.confidence,
      });
      reversals.set(original.id, {
        description: later.description,
        date: requireIsoDate(later.date),
        categoryKey: later.categoryKey,
        amountCents: later.amountCents,
        confidence: pair.confidence,
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Unmatched bank transactions only. No two lines from the same vendor read alike — the dates, trace numbers and order references all change — so each row shows the stable fragment a rule should match on, and how many other rows it would catch. Edit it if it grabbed the wrong part."
      />

      {unmatched.length === 0 ? (
        <Panel>
          <Empty>
            Nothing to review. Every imported row matched a rule.{' '}
            <Link href="/settings/rules" className="underline">Payee rules</Link>
          </Empty>
        </Panel>
      ) : (
        <>
          {unmatched.length > 25 ? (
            <Note>
              {unmatched.length} unmatched rows. That is more than a handful of one-offs — after the first two months
              this list should be short, so if it stays long the rule table needs work.
            </Note>
          ) : null}

          <Panel title={`${unmatched.length} to categorize`}>
            <table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Property</Th>
                  <Th>Description</Th>
                  <Th right>Amount</Th>
                  <Th>Category</Th>
                  <Th>Rule</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {unmatched.map((transaction) => (
                  <ReviewRow
                    key={transaction.id}
                    categories={categories}
                    id={transaction.id}
                    date={transaction.date.toISOString().slice(0, 10)}
                    propertyName={transaction.statement.bankAccount.property.name}
                    description={transaction.description}
                    amountCents={transaction.amountCents}
                    suggestion={
                      reversals.get(transaction.id)?.categoryKey ?? suggestionFor(transaction.amountCents)
                    }
                    reversalOf={
                      reversals.has(transaction.id)
                        ? {
                            description: reversals.get(transaction.id)!.description,
                            date: reversals.get(transaction.id)!.date,
                            amount: formatCents(reversals.get(transaction.id)!.amountCents),
                            categoryLabel:
                              categories.find((c) => c.key === reversals.get(transaction.id)!.categoryKey)?.label ??
                              null,
                          }
                        : null
                    }
                  />
                ))}
              </tbody>
            </table>
          </Panel>

          <Note tone="muted">
            Two categories worth reaching for: <strong>not portfolio</strong> for a charge that landed in an account it
            does not belong to — it gets flagged as foreign rather than forced onto this property — and{' '}
            <strong>security deposit received</strong>, which is a liability and stays off the P&amp;L so a move-in
            month shows no phantom revenue.
          </Note>
        </>
      )}
    </>
  );
}
