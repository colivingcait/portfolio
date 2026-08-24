import { prisma } from '@/lib/db';
import { MODELS } from '@/lib/models';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Badge, Empty, PageHeader, Panel, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function EntitiesPage() {
  const entities = await prisma.entity.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { propertiesHeld: true, interestsHeld: true } } },
  });

  return (
    <>
      <PageHeader
        title="Entities"
        subtitle="People and legal entities are the same kind of node in the ownership graph; only the kind distinguishes them. Mark exactly one entity as you — that is the node the “My share” view traverses from."
      />

      <Panel title="Add an entity">
        <RecordForm modelKey="entity" fields={MODELS.entity.fields} />
      </Panel>

      <Panel title={`${entities.length} entities`}>
        {entities.length === 0 ? (
          <Empty>Start here: add yourself, then any LLC that holds title.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Kind</Th>
                <Th right>Properties held</Th>
                <Th right>Interests</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.id}>
                  <Td>
                    {entity.name} {entity.isViewer ? <Badge tone="accent">me</Badge> : null}
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">{entity.kind}</span>
                  </Td>
                  <Td right>{entity._count.propertiesHeld}</Td>
                  <Td right>{entity._count.interestsHeld}</Td>
                  <Td>
                    <DeleteButton modelKey="entity" id={entity.id} />
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
