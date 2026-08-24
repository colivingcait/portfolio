import 'server-only';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { MODELS, type ModelKey } from '@/lib/models';
import { RecordForm } from '@/components/RecordForm';
import { PageHeader, Panel } from '@/components/ui';
import { fieldsFor, recordToInitial } from './helpers';

type Finder = (id: string) => Promise<Record<string, unknown> | null>;

const FINDERS: Record<ModelKey, Finder> = {
  entity: (id) => prisma.entity.findUnique({ where: { id } }),
  property: (id) => prisma.property.findUnique({ where: { id } }),
  ownershipInterest: (id) => prisma.ownershipInterest.findUnique({ where: { id } }),
  managementPeriod: (id) => prisma.managementPeriod.findUnique({ where: { id } }),
  bankAccount: (id) => prisma.bankAccount.findUnique({ where: { id } }),
  loan: (id) => prisma.loan.findUnique({ where: { id } }),
  loanPayment: (id) => prisma.loanPayment.findUnique({ where: { id } }),
  lease: (id) => prisma.lease.findUnique({ where: { id } }),
  payeeRule: (id) => prisma.payeeRule.findUnique({ where: { id } }),
  capitalAccountEntry: (id) => prisma.capitalAccountEntry.findUnique({ where: { id } }),
};

/**
 * Editing a record in place.
 *
 * Deleting and re-adding is not an equivalent: a property cascades to its
 * loans, accounts, management periods and ownership interests, so a corrected
 * room count would take the whole history with it.
 */
export async function EditRecord({
  modelKey,
  id,
  backHref,
  label,
}: {
  modelKey: ModelKey;
  id: string;
  backHref: string;
  label?: string;
}) {
  const [record, options] = await Promise.all([FINDERS[modelKey](id), getSelectOptions()]);
  if (!record) notFound();

  const spec = MODELS[modelKey];
  const title = label ?? (typeof record.name === 'string' ? record.name : spec.label);

  return (
    <>
      <PageHeader
        title={`Edit ${title}`}
        subtitle={`${spec.label} · changes apply everywhere this record is used.`}
        actions={
          <Link href={backHref} className="text-[13px] text-muted hover:text-text">
            ← Back
          </Link>
        }
      />
      <Panel>
        <RecordForm
          modelKey={modelKey}
          id={id}
          fields={fieldsFor(modelKey, options)}
          initial={recordToInitial(modelKey, record)}
          submitLabel="Save changes"
        />
      </Panel>
    </>
  );
}
