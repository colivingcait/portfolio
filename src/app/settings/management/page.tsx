import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Badge, Empty, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';

export const dynamic = 'force-dynamic';

export default async function ManagementPage() {
  const [periods, options] = await Promise.all([
    prisma.managementPeriod.findMany({ include: { property: true }, orderBy: [{ propertyId: 'asc' }, { startDate: 'asc' }] }),
    getSelectOptions(),
  ]);

  const fields = withOptions('managementPeriod', { propertyId: options.properties });

  return (
    <>
      <PageHeader
        title="Management periods"
        subtitle="A management arrangement is a dated record, not a property-level setting. The engine looks up the period covering an earnings month and applies the matching identity, so historical months compute with no PM fee and no special case anywhere in the code."
      />

      <Note tone="muted">
        Under self-management maintenance costs were artificially low — the repairs were done in-house and unpaid
        labour never hit a statement. Under a PM the same work arrives as a priced vendor invoice, so any trend
        crossing the boundary shows maintenance apparently exploding. Every chart that crosses one says so.
      </Note>

      <Panel title="Add a period">
        <RecordForm modelKey="managementPeriod" fields={fields} />
      </Panel>

      <Panel title={`${periods.length} periods`}>
        {periods.length === 0 ? (
          <Empty>Nothing yet. Every property needs at least one period before its months can be priced.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Mode</Th>
                <Th>Manager</Th>
                <Th right>Fee</Th>
                <Th>Basis</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id}>
                  <Td>{period.property.name}</Td>
                  <Td>
                    <Badge tone={period.mode === 'pm' ? 'accent' : 'muted'}>{period.mode}</Badge>
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">{period.managerName ?? '—'}</span>
                  </Td>
                  <Td right>{period.feePercent ? `${String(period.feePercent)}%` : '—'}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{period.feeBasis?.replace(/_/g, ' ') ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="num">{period.startDate.toISOString().slice(0, 10)}</span>
                  </Td>
                  <Td>
                    <span className="num text-muted">
                      {period.endDate ? period.endDate.toISOString().slice(0, 10) : 'open'}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Link href={`/settings/management/${period.id}`} className="text-[12px] text-muted hover:text-accent">
                        Edit
                      </Link>
                      <DeleteButton modelKey="managementPeriod" id={period.id} />
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
