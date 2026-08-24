import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Empty, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const [accounts, options, properties] = await Promise.all([
    prisma.bankAccount.findMany({ include: { property: true, _count: { select: { statements: true } } }, orderBy: { label: 'asc' } }),
    getSelectOptions(),
    prisma.property.findMany({ include: { bankAccounts: true } }),
  ]);

  const fields = withOptions('bankAccount', { propertyId: options.properties });
  const withoutAccount = properties.filter((p) => p.bankAccounts.length === 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Each property has its own bank account, and everything for that property moves in and out through it. This is the single most important structural fact in the build: on import, the file is the property."
      />

      {withoutAccount.length > 0 ? (
        <Note>
          No account yet for {withoutAccount.map((p) => p.name).join(', ')}. Statement import needs one per property —
          that is what answers “which property” without a single classification decision.
        </Note>
      ) : null}

      <Panel title="Add an account">
        <RecordForm modelKey="bankAccount" fields={fields} />
      </Panel>

      <Panel title={`${accounts.length} accounts`}>
        {accounts.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Label</Th>
                <Th>Institution</Th>
                <Th>Last 4</Th>
                <Th right>Statements</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <Td>{account.property.name}</Td>
                  <Td>{account.label}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{account.institution ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="num text-muted">{account.last4 ?? '—'}</span>
                  </Td>
                  <Td right>{account._count.statements}</Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Link href={`/settings/accounts/${account.id}`} className="text-[12px] text-muted hover:text-accent">
                        Edit
                      </Link>
                      <DeleteButton modelKey="bankAccount" id={account.id} />
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
