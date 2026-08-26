import Link from 'next/link';
import { getBalanceSheet } from '@/lib/books-queries';
import { BooksTabs } from '@/components/BooksTabs';
import { FilterBar } from '@/components/FilterBar';
import { ExportButton } from '@/components/ExportButton';
import { Empty, Explainer, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.basis) ? params.basis[0] : params.basis;
  const basis: 'cost' | 'market' = raw === 'cost' ? 'cost' : 'market';
  const sheet = await getBalanceSheet(basis);

  const dollars = (cents: number) => (cents / 100).toFixed(2);
  const exportRows = [
    ['Section', 'Line', 'Amount'],
    ...sheet.assets.map((line) => ['Assets', line.label, dollars(line.amountCents)]),
    ['Assets', 'Total assets', dollars(sheet.totalAssetsCents)],
    ...sheet.liabilities.map((line) => ['Liabilities', line.label, dollars(line.amountCents)]),
    ['Liabilities', 'Total liabilities', dollars(sheet.totalLiabilitiesCents)],
    ...sheet.equity.map((line) => ['Equity', line.label, dollars(line.amountCents)]),
    ['Equity', 'Net worth', dollars(sheet.netWorthCents)],
  ];

  const Rows = ({ lines }: { lines: typeof sheet.assets }) =>
    lines.length === 0 ? (
      <tr>
        <Td><span className="pl-3 text-muted">nothing</span></Td>
        <Td right />
      </tr>
    ) : (
      <>
        {lines.map((line) => (
          <tr key={line.label}>
            <Td>
              <span className="pl-3">{line.label}</span>
              {line.detail ? <span className="text-[11px] text-muted"> · {line.detail}</span> : null}
            </Td>
            <Td right><Money cents={line.amountCents} /></Td>
          </tr>
        ))}
      </>
    );

  return (
    <>
      <PageHeader title="Balance sheet" subtitle={`As of ${sheet.asOf} · ${basis === 'cost' ? 'at cost' : 'at estimated value'}`} />
      <BooksTabs />

      <Explainer title="What this is and why it matters">
        A profit and loss says what the year <em>earned</em>. This says what the portfolio <em>is</em> — what you own,
        what you owe, and what would be left if it all settled today. The two answer different questions and disagree
        by design: a mortgage payment barely shows on a P&amp;L and moves this every month, because principal is not a
        cost, it is you buying more of the house.
        <div className="mt-1.5">
          Two things to be straight about. First, these books are built from bank statements rather than double-entry
          journals, so the equity side is a <strong>residual</strong> — it balances because it is defined to, not
          because two independent sets of figures happened to agree. Second, a property shown at{' '}
          <strong>cost</strong> is what a tax return uses; at <strong>estimated value</strong> is what your equity is
          actually worth. They are rarely close, and which one you want depends on who is asking.
        </div>
      </Explainer>

      <FilterBar
        groups={[
          {
            label: 'Carry properties at',
            primary: true,
            options: [
              {
                label: 'Estimated value',
                href: '/books/balance-sheet?basis=market',
                active: basis === 'market',
                hint: 'What the equity is actually worth',
              },
              {
                label: 'Cost',
                href: '/books/balance-sheet?basis=cost',
                active: basis === 'cost',
                hint: 'What a tax return uses',
              },
            ],
          },
        ]}
      />

      {sheet.warnings.map((warning) => (
        <Note key={warning} tone="warn">
          {warning}{' '}
          {warning.includes('carried at zero') ? (
            <Link href="/properties" className="underline">Add a valuation</Link>
          ) : (
            <Link href="/imports" className="underline">Import a statement</Link>
          )}
        </Note>
      ))}

      <Panel
        title="As of today"
        actions={<ExportButton filename={`balance-sheet-${sheet.asOf}.csv`} rows={exportRows} />}
      >
        {sheet.assets.length === 0 && sheet.liabilities.length === 0 ? (
          <Empty>Nothing to show yet. Add a property, a loan and a statement and this fills in.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Line</Th>
                <Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              <tr><Td><strong>Assets</strong></Td><Td right /></tr>
              <Rows lines={sheet.assets} />
              <tr className="border-t border-line">
                <Td><span className="pl-3 text-muted">Total assets</span></Td>
                <Td right><strong><Money cents={sheet.totalAssetsCents} /></strong></Td>
              </tr>

              <tr><Td><strong>Liabilities</strong></Td><Td right /></tr>
              <Rows lines={sheet.liabilities} />
              <tr className="border-t border-line">
                <Td><span className="pl-3 text-muted">Total liabilities</span></Td>
                <Td right><strong><Money cents={sheet.totalLiabilitiesCents} /></strong></Td>
              </tr>

              <tr className="border-t-2 border-line">
                <Td><strong>Net worth</strong></Td>
                <Td right>
                  <strong className={sheet.netWorthCents < 0 ? 'text-bad' : ''}><Money cents={sheet.netWorthCents} /></strong>
                </Td>
              </tr>

              <tr><Td><strong>Made up of</strong></Td><Td right /></tr>
              <Rows lines={sheet.equity} />
            </tbody>
          </table>
        )}
      </Panel>

      <Explainer title="Reading the equity section">
        <strong>Owner contributions</strong> is what went in. <strong>Owner distributions</strong> is what came back
        out — shown negative, because it reduces the claim. <strong>Retained</strong> is everything else: profit left
        in the business, and every gain or loss in what the properties are carried at. On a market basis a big
        retained figure is mostly appreciation, not cash — it is not money you can spend.
        <div className="mt-1.5">
          What an investor is owed back on sale is a different number again, and it is on the{' '}
          <Link href="/payouts" className="underline">Payouts</Link> screen: a profit distribution does not reduce
          capital, only capital handed back does.
        </div>
      </Explainer>
    </>
  );
}
