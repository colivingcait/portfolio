import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Badge, Empty, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { RecomputeButton } from '@/components/RecomputeButton';
import { StatementDropzone } from '@/components/StatementDropzone';
import { PadSplitDropzone } from '@/components/PadSplitDropzone';
import { DeleteStatementButton } from '@/components/DeleteStatementButton';

export const dynamic = 'force-dynamic';

export default async function ImportsPage() {
  const [accounts, statements, padsplitImports] = await Promise.all([
    prisma.bankAccount.findMany({ include: { property: true }, where: { active: true }, orderBy: { label: 'asc' } }),
    prisma.bankStatement.findMany({
      include: {
        bankAccount: { include: { property: true } },
        _count: { select: { transactions: true } },
      },
      orderBy: { periodEnd: 'desc' },
      take: 30,
    }),
    prisma.padSplitImport.findMany({ orderBy: { importedAt: 'desc' }, take: 20 }),
  ]);

  const options = accounts.map((a) => ({ value: a.id, label: `${a.property.name} · ${a.label}` }));

  return (
    <>
      <PageHeader
        title="Imports"
        subtitle="Drop statements in. Each one is read for the account it belongs to, the period it covers and the balances to check against. One account per property means the file is the property, so every row in it belongs there — the only question left is what kind."
      />

      {options.length === 0 ? (
        <Note tone="bad">
          No bank accounts yet. One account per property is what makes an import need no typing — add one on the
          house’s own page under <Link href="/properties" className="underline">Properties</Link> before importing.
        </Note>
      ) : (
        <Panel
          title="Bank statements"
          description="Nothing posts unless opening + credits − debits equals the closing balance. A statement that does not tie is refused rather than half-imported."
        >
          <StatementDropzone accounts={options} />
        </Panel>
      )}

      <Panel title="Statement history">
        {statements.length === 0 ? (
          <Empty>Nothing imported yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Account</Th>
                <Th>Period</Th>
                <Th right>Rows</Th>
                <Th right>Opening</Th>
                <Th right>Closing</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {statements.map((statement) => (
                <tr key={statement.id}>
                  <Td>{statement.bankAccount.property.name}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{statement.bankAccount.label}</span>
                  </Td>
                  <Td>
                    <span className="num">
                      {statement.periodStart.toISOString().slice(0, 10)} → {statement.periodEnd.toISOString().slice(0, 10)}
                    </span>
                  </Td>
                  <Td right>{statement._count.transactions}</Td>
                  <Td right>
                    <Money cents={statement.openingBalanceCents} muted />
                  </Td>
                  <Td right>
                    <Money cents={statement.closingBalanceCents} muted />
                  </Td>
                  <Td>
                    <Badge tone={statement.status === 'posted' ? 'good' : statement.status === 'rejected' ? 'bad' : 'warn'}>
                      {statement.status === 'posted' ? 'tied' : statement.status}
                    </Badge>
                  </Td>
                  <Td>
                    <DeleteStatementButton id={statement.id} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="PadSplit"
        description="The four-file export, dropped together. Each file is recognised by its own columns, so the names and the order do not matter."
      >
        <PadSplitDropzone />
      </Panel>

      <Panel
        title="Stored figures"
        description="The dashboard reads monthly figures that were worked out when the data was imported, rather than recomputing them on every view. Rebuild them after a change to how a figure is derived — occupancy, collection rate, net cash — or the dashboard keeps quoting the old definition. Nothing is re-read from a file and nothing you have categorised is touched."
      >
        <RecomputeButton />
      </Panel>

      <Note tone="muted">
        The PM statement importer is blocked on a real sample. Until it exists, PM-managed months reconcile in reduced
        form: expected = host earnings − 10.5% of gross collected, with the difference posted as a single line, PM opex
        (underived).
      </Note>
    </>
  );
}
