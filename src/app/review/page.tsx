import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Empty, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const unmatched = await prisma.bankTransaction.findMany({
    where: { categoryKey: null },
    include: { statement: { include: { bankAccount: { include: { property: true } } } } },
    orderBy: { date: 'desc' },
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Review"
        subtitle="Unmatched bank transactions only. If this list is ever long, the rule table needs work."
      />

      {unmatched.length === 0 ? (
        <Panel>
          <Empty>
            Nothing to review. Once statements are importing, only rows no payee rule matched land here — and
            confirming one writes the rule for every future import.{' '}
            <Link href="/settings/rules" className="underline">Payee rules</Link>
          </Empty>
        </Panel>
      ) : (
        <>
          {unmatched.length > 25 ? (
            <Note>
              {unmatched.length} unmatched rows. That is more than a handful of one-offs — the rule table needs work.
            </Note>
          ) : null}
          <Panel title={`${unmatched.length} unmatched`}>
            <table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Property</Th>
                  <Th>Description</Th>
                  <Th right>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((transaction) => (
                  <tr key={transaction.id}>
                    <Td>
                      <span className="num">{transaction.date.toISOString().slice(0, 10)}</span>
                    </Td>
                    <Td>{transaction.statement.bankAccount.property.name}</Td>
                    <Td>{transaction.description}</Td>
                    <Td right>
                      <Money cents={transaction.amountCents} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </>
  );
}
