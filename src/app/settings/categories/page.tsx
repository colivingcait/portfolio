import { prisma } from '@/lib/db';
import { AddPanel } from '@/components/AddPanel';
import { getCategoryCatalog } from '@/lib/categories-queries';
import { CATEGORIES } from '@/lib/engine/categories';
import { CategoryEditor } from '@/components/CategoryEditor';
import { Badge, Explainer, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { SCHEDULE_E_LINES } from '@/lib/engine/tax';

export const dynamic = 'force-dynamic';

const GROUPS = [
  { key: 'income' as const, title: 'Income' },
  {
    key: 'not_income' as const,
    title: 'Not income',
    description: 'Real cash movements that are neither earned nor spent. Excluded from the P&L and from the tax return.',
  },
  { key: 'expense' as const, title: 'Expense' },
];

export default async function CategoriesPage() {
  const [catalog, custom] = await Promise.all([
    getCategoryCatalog(),
    prisma.customCategory.findMany({ orderBy: { label: 'asc' } }),
  ]);

  const builtInKeys = new Set(CATEGORIES.map((c) => c.key));
  const rows = custom.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    class: row.class,
    taxLine: row.taxLine,
    taxTreatment: row.taxTreatment,
    note: row.note,
    archived: row.archived,
    overridesBuiltIn: builtInKeys.has(row.key),
  }));

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="One account per property means the file is the property, so the hard half of classification is already answered. Only what kind remains: one dimension, a small vocabulary, and it grows when you need it to."
      />


      <Explainer title="Why this matters">
        You categorize by what happened — lawn, pest control, home warranty. The tax treatment rides along
        underneath, so a Schedule E line is never something you have to think about while doing the monthly work.
        <div className="mt-1.5">
          Add categories freely; a new one needs no code change. What matters is the <strong>tax line</strong> you map
          it to, since that is where the money lands on a return. When in doubt, repairs and cleaning are the usual
          homes for a running cost, and anything that extends the life of the property belongs under capex — that gets
          depreciated rather than deducted, and your accountant sets that up.
        </div>
      </Explainer>
      <Note tone="muted">
        Adding one with the same name as a built-in replaces it — that is how a mapping you disagree with gets
        corrected. Hiding a category keeps it off the pickers without touching transactions already filed under it,
        since a report for a past year still has to resolve the name.
      </Note>

      {GROUPS.map((group) => (
        <Panel key={group.key} title={group.title} description={group.description}>
          <table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>At year end</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {catalog
                .filter((c) => c.class === group.key)
                .map((c) => (
                  <tr key={c.key}>
                    <Td>
                      {c.label}
                      {!builtInKeys.has(c.key) ? <Badge tone="accent">yours</Badge> : null}
                      {c.taxTreatment === 'capitalizable' ? <Badge tone="warn">depreciated</Badge> : null}
                      {c.intercompany ? <Badge tone="accent">intercompany</Badge> : null}
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">
                        {c.taxTreatment === 'not_reportable'
                          ? 'not reported'
                          : c.taxTreatment === 'capitalizable'
                            ? 'depreciated, not deducted'
                            : c.taxLine
                              ? (SCHEDULE_E_LINES.find((l) => l.line === c.taxLine)?.label ?? c.taxLine)
                              : 'income'}
                      </span>
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
      <AddPanel label="Add a category" description="Name it the way you think about it. Where it lands on a tax return is chosen once, here, and never asked again while you are categorizing.">
        <CategoryEditor rows={rows} />
      </AddPanel>

    </>
  );
}
