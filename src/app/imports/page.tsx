import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Badge, Empty, Note, PageHeader, Panel, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

const SOURCES = [
  {
    title: 'Bank statements',
    step: 'Build step 2',
    ready: false,
    body: 'One account per property means the file is the property: pick the property, drop its statement, and every row belongs to it. Rows post only when opening + credits − debits ties to the closing balance — a partial statement is refused, not silently accepted.',
  },
  {
    title: 'PadSplit — four files per month',
    step: 'Build step 4',
    ready: false,
    body: 'summary.csv, billed.csv, collected.csv and earnings_table.csv, keyed by earnings month and never by payout month. Credits and payout come from earnings_table; the latest month is still collecting and is excluded from every rate.',
  },
  {
    title: 'PM statement',
    step: 'Build step 6 — blocked',
    ready: false,
    body: 'Blocked on a real sample. Until it exists, PM months reconcile in reduced form: expected = host earnings − 10.5% of gross collected, with the difference posted as a single line, PM opex (underived).',
  },
];

export default async function ImportsPage() {
  const [statements, padsplitImports] = await Promise.all([
    prisma.bankStatement.findMany({
      include: { bankAccount: { include: { property: true } } },
      orderBy: { periodEnd: 'desc' },
      take: 25,
    }),
    prisma.padSplitImport.findMany({ orderBy: { importedAt: 'desc' }, take: 25 }),
  ]);

  return (
    <>
      <PageHeader
        title="Imports"
        subtitle="A drop zone per source, import history, and reconciliation status per property-month: tied, does not tie, or awaiting PM statement."
      />

      <Note tone="muted">
        No importer is wired up yet — this is build order steps 2, 4 and 6. The parsing and reconciliation rules they
        will run are already written and tested; what is missing is the upload and persistence around them.
      </Note>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {SOURCES.map((source) => (
          <div key={source.title} className="rounded-lg border border-dashed border-line bg-surface px-4 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-medium">{source.title}</h3>
              <Badge tone="warn">{source.step}</Badge>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">{source.body}</p>
          </div>
        ))}
      </div>

      <Panel title="Statement history">
        {statements.length === 0 ? (
          <Empty>
            Nothing imported yet. Accounts are configured in{' '}
            <Link href="/settings/accounts" className="underline">Settings → Accounts</Link>.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Account</Th>
                <Th>Period</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {statements.map((statement) => (
                <tr key={statement.id}>
                  <Td>{statement.bankAccount.property.name}</Td>
                  <Td>{statement.bankAccount.label}</Td>
                  <Td>
                    <span className="num">
                      {statement.periodStart.toISOString().slice(0, 10)} → {statement.periodEnd.toISOString().slice(0, 10)}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={statement.status === 'posted' ? 'good' : statement.status === 'rejected' ? 'bad' : 'warn'}>
                      {statement.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="PadSplit history">
        {padsplitImports.length === 0 ? (
          <Empty>Nothing imported yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Earnings month</Th>
                <Th>File</Th>
                <Th>Kind</Th>
                <Th right>Rows</Th>
              </tr>
            </thead>
            <tbody>
              {padsplitImports.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <span className="num">{row.earningsMonth}</span>
                  </Td>
                  <Td>{row.fileName}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{row.fileKind}</span>
                  </Td>
                  <Td right>{row.rowCount}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
