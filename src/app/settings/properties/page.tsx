import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Badge, Empty, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';

export const dynamic = 'force-dynamic';

export default async function PropertiesPage() {
  const [properties, options] = await Promise.all([
    prisma.property.findMany({ include: { titleEntity: true }, orderBy: { name: 'asc' } }),
    getSelectOptions(),
  ]);

  const fields = withOptions('property', { titleEntityId: options.entities });
  const unverified = properties.filter((p) => !p.dataVerified).length;

  return (
    <>
      <PageHeader
        title="Properties"
        subtitle="Four attributes vary and the engine branches on them: revenue source, unit structure, management (as a period of time, not a flag) and the entity holding title."
      />

      {unverified > 0 ? (
        <Note>
          {unverified} {unverified === 1 ? 'property is' : 'properties are'} unverified. The coliving rows in the build
          spec were carried from an earlier document — addresses, room counts and statuses need confirming, and the
          room counts sum to 45 before anyone has checked them.
        </Note>
      ) : null}

      {options.entities.length === 0 ? (
        <Note tone="bad">
          Add an entity first — a property needs an owner of title.{' '}
          <Link href="/settings/entities" className="underline">Settings → Entities</Link>
        </Note>
      ) : (
        <Panel title="Add a property">
          <RecordForm modelKey="property" fields={fields} />
        </Panel>
      )}

      <Panel title={`${properties.length} properties`}>
        {properties.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>PSID</Th>
                <Th>Entity</Th>
                <Th>Revenue</Th>
                <Th>Structure</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => (
                <tr key={property.id}>
                  <Td>
                    <Link href={`/properties/${property.id}`} className="hover:text-accent">
                      {property.name}
                    </Link>
                    {!property.dataVerified ? <Badge tone="warn">unverified</Badge> : null}
                  </Td>
                  <Td>
                    <span className="num text-muted">{property.externalId ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">{property.titleEntity.name}</span>
                  </Td>
                  <Td>
                    <span className="text-[12px]">{property.revenueSource}</span>
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">
                      {property.unitStructure === 'rooms'
                        ? `${property.roomCount ?? '?'} rooms`
                        : `${property.unitCount ?? '?'} units`}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[12px]">{property.status}</span>
                  </Td>
                  <Td>
                    <DeleteButton modelKey="property" id={property.id} />
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
