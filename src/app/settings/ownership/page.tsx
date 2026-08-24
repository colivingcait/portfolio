import { prisma } from '@/lib/db';
import { getOwnershipContext, getSelectOptions, todayIso } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Empty, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';
import { effectiveShare } from '@/lib/engine/ownership';

export const dynamic = 'force-dynamic';

export default async function OwnershipPage() {
  const asOf = todayIso();
  const [interests, options, context, properties] = await Promise.all([
    prisma.ownershipInterest.findMany({
      include: { owner: true, property: true, ownedEntity: true },
      orderBy: [{ startDate: 'desc' }],
    }),
    getSelectOptions(),
    getOwnershipContext(todayIso()),
    prisma.property.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const fields = withOptions('ownershipInterest', {
    ownerId: options.entities,
    propertyId: options.properties,
    ownedEntityId: options.entities,
  });

  return (
    <>
      <PageHeader
        title="Ownership"
        subtitle="A graph, not a field. Effective share is the sum, over every path from you to a property, of the product of the percentages along that path — so half of a property held by an entity you half-own is a quarter."
      />

      {context.warnings.length > 0 ? (
        <Note>
          {context.warnings.length} {context.warnings.length === 1 ? 'holding does' : 'holdings do'} not total 100% as of{' '}
          {asOf}:{' '}
          {context.warnings
            .map((w) => `${context.names.get(w.ownedId) ?? w.ownedId} at ${w.totalPercent}%`)
            .join(', ')}
          . This is a warning, not a block — partial records are normal while you are entering them.
        </Note>
      ) : null}

      {!context.viewerId ? (
        <Note tone="bad">No entity is marked as you, so no effective share can be computed.</Note>
      ) : null}

      <Panel title="Add an interest" description="Dating every interest means a partner buying in or out is a new record, not an edit that silently rewrites history.">
        <RecordForm modelKey="ownershipInterest" fields={fields} />
      </Panel>

      {context.viewerId && properties.length > 0 ? (
        <Panel title={`Your effective share as of ${asOf}`}>
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th right>Equity</Th>
                <Th right>Cash (distributions)</Th>
                <Th>Paths</Th>
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => {
                const equity = effectiveShare(context.interests, context.viewerId!, property.id, asOf, 'equity');
                const cash = effectiveShare(context.interests, context.viewerId!, property.id, asOf, 'distribution');
                return (
                  <tr key={property.id}>
                    <Td>{property.name}</Td>
                    <Td right>
                      <Pct value={equity.percent} digits={3} />
                    </Td>
                    <Td right>
                      <Pct value={cash.percent} digits={3} />
                    </Td>
                    <Td>
                      <span className="text-[11px] text-muted">
                        {equity.paths.length === 0
                          ? '—'
                          : equity.paths
                              .map((path) => path.nodes.map((n) => context.names.get(n) ?? 'you').join(' → '))
                              .join(' | ')}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <Panel title={`${interests.length} interests`}>
        {interests.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Owner</Th>
                <Th>Holds</Th>
                <Th right>Percent</Th>
                <Th right>Distribution</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Basis</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {interests.map((interest) => (
                <tr key={interest.id}>
                  <Td>{interest.owner.name}</Td>
                  <Td>{interest.property?.name ?? interest.ownedEntity?.name ?? '—'}</Td>
                  <Td right>{String(interest.percent)}%</Td>
                  <Td right>
                    <span className="text-muted">
                      {interest.distributionPercent ? `${String(interest.distributionPercent)}%` : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="num">{interest.startDate.toISOString().slice(0, 10)}</span>
                  </Td>
                  <Td>
                    <span className="num text-muted">
                      {interest.endDate ? interest.endDate.toISOString().slice(0, 10) : 'open'}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">{interest.basis}</span>
                  </Td>
                  <Td>
                    <DeleteButton modelKey="ownershipInterest" id={interest.id} />
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
