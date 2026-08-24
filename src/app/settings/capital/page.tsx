import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Empty, Money, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';

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

  const balances = entities
    .map((entity) => {
      const own = entries.filter((e) => e.entityId === entity.id);
      const contributed = own.filter((e) => e.kind === 'contribution').reduce((t, e) => t + e.amountCents, 0);
      const distributed = own.filter((e) => e.kind === 'distribution').reduce((t, e) => t + e.amountCents, 0);
      return { entity, contributed, distributed, net: contributed - distributed };
    })
    .filter((row) => row.contributed !== 0 || row.distributed !== 0);

  return (
    <>
      <PageHeader
        title="Capital accounts"
        subtitle="Ownership percent records who owns; it says nothing about who funded. Where contributions have been uneven — one partner covering a repair, another a down payment — this ledger is the only way effective economics stay honest."
      />

      <Panel title="Add an entry">
        <RecordForm modelKey="capitalAccountEntry" fields={fields} />
      </Panel>

      {balances.length > 0 ? (
        <Panel title="Balances">
          <table>
            <thead>
              <tr>
                <Th>Owner</Th>
                <Th right>Contributed</Th>
                <Th right>Distributed</Th>
                <Th right>Net</Th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row) => (
                <tr key={row.entity.id}>
                  <Td>{row.entity.name}</Td>
                  <Td right>
                    <Money cents={row.contributed} />
                  </Td>
                  <Td right>
                    <Money cents={row.distributed} />
                  </Td>
                  <Td right>
                    <Money cents={row.net} />
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
                    <div className="flex items-center gap-3">
                      <Link href={`/settings/capital/${entry.id}`} className="text-[12px] text-muted hover:text-accent">
                        Edit
                      </Link>
                      <DeleteButton modelKey="capitalAccountEntry" id={entry.id} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
