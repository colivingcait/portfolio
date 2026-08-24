import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Empty, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';
import { getCategoryCatalog } from '@/lib/categories-queries';
import { category } from '@/lib/engine/categories';

const DIRECTION_LABEL: Record<string, string> = {
  any: 'Any amount',
  debit: 'Money out',
  credit: 'Money in',
};

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const [rules, options, catalog] = await Promise.all([
    prisma.payeeRule.findMany({ include: { bankAccount: { include: { property: true } } }, orderBy: [{ priority: 'desc' }, { match: 'asc' }] }),
    getSelectOptions(),
    getCategoryCatalog(),
  ]);

  const fields = withOptions('payeeRule', {
    bankAccountId: options.accounts,
    categoryKey: catalog.map((c) => ({ value: c.key, label: c.label })),
  });

  return (
    <>
      <PageHeader
        title="Payee rules"
        subtitle="A rule table learns the twenty-odd recurring payees each account sees, so after two months the monthly work is a handful of one-offs. Rules are also written automatically when you confirm a row in Review."
      />

      <Panel title="Add a rule">
        <RecordForm modelKey="payeeRule" fields={fields} />
      </Panel>

      <Panel title={`${rules.length} rules`}>
        {rules.length === 0 ? (
          <Empty>Nothing yet. Rules accumulate as statements get categorized.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Description contains</Th>
                <Th>Category</Th>
                <Th>Applies to</Th>
                <Th right>Priority</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <Td>
                    <span className="text-[12px] text-muted">
                      {rule.bankAccount ? `${rule.bankAccount.property.name} · ${rule.bankAccount.label}` : 'All accounts'}
                    </span>
                  </Td>
                  <Td>
                    <code className="text-[12px]">{rule.match}</code>
                  </Td>
                  <Td>{category(rule.categoryKey, catalog)?.label ?? rule.categoryKey}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{DIRECTION_LABEL[rule.direction] ?? rule.direction}</span>
                  </Td>
                  <Td right>{rule.priority}</Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Link href={`/settings/rules/${rule.id}`} className="text-[12px] text-muted hover:text-accent">
                        Edit
                      </Link>
                      <DeleteButton modelKey="payeeRule" id={rule.id} />
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
