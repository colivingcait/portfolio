import Link from 'next/link';
import { AddPanel } from '@/components/AddPanel';
import { prisma } from '@/lib/db';
import { getOwnershipContext, getSelectOptions, todayIso } from '@/lib/queries';
import { RowActions } from '@/components/RowActions';
import { OwnershipSplitForm } from '@/components/OwnershipSplitForm';
import { Badge, Empty, Explainer, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
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

  // Grouped by what is owned, because that is the unit that has to total 100%.
  const groups = new Map<string, { label: string; rows: typeof interests; total: number }>();
  for (const interest of interests) {
    const ownedId = interest.propertyId ?? interest.ownedEntityId ?? 'unknown';
    const label = interest.property?.name ?? interest.ownedEntity?.name ?? 'Unknown';
    const group = groups.get(ownedId) ?? { label, rows: [], total: 0 };
    group.rows.push(interest);
    const active = interest.startDate.toISOString().slice(0, 10) <= asOf &&
      (!interest.endDate || interest.endDate.toISOString().slice(0, 10) >= asOf);
    if (active) group.total += Number(interest.percent);
    groups.set(ownedId, group);
  }
  const grouped = [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));

  return (
    <>
      <PageHeader
        title="Ownership"
        subtitle="A graph, not a field. Effective share is the sum, over every path from you to a property, of the product of the percentages along that path — so half of a property held by an entity you half-own is a quarter."
      />


      <Explainer title="Why this matters">
        This is a graph, not a field, and that is what makes it worth entering carefully. Your effective share
        of a house is the sum, over every path from you to it, of the percentages multiplied along the way — so half of
        a property held by an entity you half-own is a quarter, and two paths to the same house add up.
        <div className="mt-1.5">
          <strong>Equity</strong> and <strong>distribution</strong> are recorded separately on purpose. Who owns a
          thing and who gets this month&apos;s cash are often not the same split, especially where one partner funded
          more than their share. Payouts follows the distribution basis; equity and sale proceeds follow the other.
        </div>
      </Explainer>
      {!context.viewerId ? (
        <Note tone="bad">
          No entity is marked as you, so no effective share can be computed. Set “This is me” on your own entity in{' '}
          <Link href="/owners/entities" className="underline">Entities</Link>.
        </Note>
      ) : null}

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
                              .join('  |  ')}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ) : null}

      {grouped.length === 0 ? (
        <Panel title="Interests">
          <Empty>Nothing recorded yet.</Empty>
        </Panel>
      ) : (
        grouped.map(([ownedId, group]) => {
          const off = Math.abs(group.total - 100) > 0.005;
          return (
            <Panel
              key={ownedId}
              title={group.label}
              actions={
                <span className={`num text-[13px] ${off ? 'text-warn' : 'text-good'}`}>
                  {group.total.toFixed(group.total % 1 === 0 ? 0 : 3)}%
                  {off ? <Badge tone="warn">not 100%</Badge> : null}
                </span>
              }
              description={off ? 'Interests in force today do not total 100%. A warning, not a block — partial records are normal while you are entering them.' : undefined}
            >
              <table>
                <thead>
                  <tr>
                    <Th>Owner</Th>
                    <Th right>Percent</Th>
                    <Th right>Distribution</Th>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th>Basis</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((interest) => (
                    <tr key={interest.id}>
                      <Td>{interest.owner.name}</Td>
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
                        <RowActions modelKey="ownershipInterest" id={interest.id} back="/owners/ownership" />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          );
        })
      )}
      <AddPanel label="Add owners" description="Enter a whole split at once — every partner in one property, or everyone who holds the LLC. The running total flags a stack that misses 100% before it is saved rather than after.">
        <OwnershipSplitForm entities={options.entities} properties={options.properties} />
      </AddPanel>

    </>
  );
}
