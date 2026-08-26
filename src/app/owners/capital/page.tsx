import Link from 'next/link';
import { AddPanel } from '@/components/AddPanel';
import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { RowActions } from '@/components/RowActions';
import { Empty, Explainer, Money, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '@/lib/form-helpers';
import { capitalPositions } from '@/lib/engine/payouts';
import { requireIsoDate } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function CapitalPage() {
  const [entries, options, entities] = await Promise.all([
    prisma.capitalAccountEntry.findMany({ include: { entity: true, property: true }, orderBy: { date: 'desc' } }),
    getSelectOptions(),
    prisma.entity.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const fields = withOptions('capitalAccountEntry', {
    entityId: options.entities,
    propertyId: options.properties,
  });

  // The same function Payouts uses. Computing this inline here is how the two
  // screens came to disagree: a profit distribution reduced the balance on one
  // and not the other, for the same investor on the same day.
  const names = new Map(entities.map((entity) => [entity.id, entity.name]));
  const balances = capitalPositions(
    entries.map((entry) => ({
      entityId: entry.entityId,
      propertyId: entry.propertyId,
      kind: entry.kind,
      date: requireIsoDate(entry.date),
      amountCents: entry.amountCents,
    })),
  )
    .map((position) => ({ ...position, name: names.get(position.entityId) ?? 'Unknown' }))
    .filter((row) => row.contributedCents !== 0 || row.profitDistributedCents !== 0 || row.returnedCents !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Capital accounts"
        subtitle="Ownership percent records who owns; it says nothing about who funded. Where contributions have been uneven — one partner covering a repair, another a down payment — this ledger is the only way effective economics stay honest."
      />


      <Explainer title="Why this matters">
        Ownership percent records who <em>owns</em>. It says nothing about who <em>funded</em>, and those come
        apart the moment one partner covers a repair or a down payment the others do not.
        <div className="mt-1.5">
          This ledger is what decides an investor&apos;s claim. A <strong>profit distribution</strong> does not reduce
          what they are owed back on sale — only capital actually handed back does. Recording a monthly split as a
          return of capital would quietly wipe out their principal; the Payouts screen checks these entries against
          what the bank statements show leaving, so the two cannot drift apart unnoticed.
        </div>
      </Explainer>
      {balances.length > 0 ? (
        <Panel
          title="Balances"
          description="Profit paid does not reduce what is owed back on sale — only capital handed back does. These are the same figures Payouts shows."
        >
          <table>
            <thead>
              <tr>
                <Th>Owner</Th>
                <Th right>Contributed</Th>
                <Th right>Profit paid</Th>
                <Th right>Capital returned</Th>
                <Th right>Owed back on sale</Th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row) => (
                <tr key={row.entityId}>
                  <Td>{row.name}</Td>
                  <Td right>
                    <Money cents={row.contributedCents} />
                  </Td>
                  <Td right>
                    <Money cents={row.profitDistributedCents} muted />
                  </Td>
                  <Td right>
                    {row.returnedCents ? <Money cents={row.returnedCents} /> : <span className="num text-muted">—</span>}
                  </Td>
                  <Td right>
                    <Money cents={row.outstandingCents} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <Panel title={`${entries.length} entries`}>
        {entries.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Owner</Th>
                <Th>Property</Th>
                <Th>Kind</Th>
                <Th right>Amount</Th>
                <Th>Memo</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <Td>
                    <span className="num">{entry.date.toISOString().slice(0, 10)}</span>
                  </Td>
                  <Td>{entry.entity.name}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{entry.property?.name ?? 'Portfolio-wide'}</span>
                  </Td>
                  <Td>
                    <span className="text-[12px]">{entry.kind}</span>
                  </Td>
                  <Td right>
                    <Money cents={entry.amountCents} />
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">{entry.memo ?? '—'}</span>
                  </Td>
                  <Td>
                    <RowActions modelKey="capitalAccountEntry" id={entry.id} back="/owners/capital" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <AddPanel label="Add an entry" description="A contribution, a distribution, or capital handed back.">
        <RecordForm modelKey="capitalAccountEntry" fields={fields} />
      
      </AddPanel>

    </>
  );
}
