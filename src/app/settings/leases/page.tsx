import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Empty, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';

export const dynamic = 'force-dynamic';

export default async function LeasesPage() {
  const [leases, options] = await Promise.all([
    prisma.lease.findMany({ include: { property: true, unit: true }, orderBy: { startDate: 'desc' } }),
    getSelectOptions(),
  ]);

  const fields = withOptions('lease', { propertyId: options.properties, unitId: options.units });

  return (
    <>
      <PageHeader
        title="Leases"
        subtitle="Direct properties categorize revenue rather than importing it, so occupancy and delinquency are not derivable from the data alone. A minimal lease record makes expected-versus-received computable and gives them the same vacancy and collection figures the coliving houses get."
      />

      <Note tone="muted">
        Deposits held are a liability, not income — a move-in month would otherwise show phantom revenue and a
        move-out month a phantom loss.
      </Note>

      <Panel title="Add a lease">
        <RecordForm modelKey="lease" fields={fields} />
      </Panel>

      <Panel title={`${leases.length} leases`}>
        {leases.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Unit</Th>
                <Th>Tenant</Th>
                <Th right>Rent</Th>
                <Th right>Deposit held</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {leases.map((lease) => (
                <tr key={lease.id}>
                  <Td>{lease.property.name}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{lease.unit?.label ?? '—'}</span>
                  </Td>
                  <Td>{lease.tenantName}</Td>
                  <Td right>
                    <Money cents={lease.rentCents} />
                  </Td>
                  <Td right>
                    <Money cents={lease.depositHeldCents} muted />
                  </Td>
                  <Td>
                    <span className="num">{lease.startDate.toISOString().slice(0, 10)}</span>
                  </Td>
                  <Td>
                    <span className="num text-muted">
                      {lease.endDate ? lease.endDate.toISOString().slice(0, 10) : 'open'}
                    </span>
                  </Td>
                  <Td>
                    <DeleteButton modelKey="lease" id={lease.id} />
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
