import { CATEGORIES } from '@/lib/engine/categories';
import { Badge, PageHeader, Panel, Td, Th } from '@/components/ui';

export const dynamic = 'force-static';

const GROUPS = [
  { key: 'income' as const, title: 'Income' },
  { key: 'not_income' as const, title: 'Not income', description: 'Real cash movements that are not revenue. Excluded from the P&L.' },
  { key: 'expense' as const, title: 'Expense' },
];

export default function CategoriesPage() {
  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="One account per property means the file is the property, so the hard half of classification — which property — is answered by the upload itself. Only what kind remains: one dimension, small vocabulary."
      />

      {GROUPS.map((group) => (
        <Panel key={group.key} title={group.title} description={group.description}>
          <table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Key</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.filter((c) => c.class === group.key).map((c) => (
                <tr key={c.key}>
                  <Td>
                    {c.label}
                    {c.excludeFromPnl ? <Badge tone="warn">off P&amp;L</Badge> : null}
                    {c.intercompany ? <Badge tone="accent">intercompany</Badge> : null}
                  </Td>
                  <Td>
                    <code className="text-[12px] text-muted">{c.key}</code>
                  </Td>
                  <Td>
                    <span className="text-[12px] leading-relaxed text-muted">{c.note ?? ''}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </>
  );
}
