import Link from 'next/link';
import { getPnl } from '@/lib/books-queries';
import { BooksTabs } from '@/components/BooksTabs';
import { ExportButton } from '@/components/ExportButton';
import { Empty, Explainer, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { Legend, LineChart, SERIES, StackedBar } from '@/components/charts';

export const dynamic = 'force-dynamic';

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const propertyParam = Array.isArray(params.property) ? params.property[0] : params.property;
  const year = Number(yearParam ?? new Date().getFullYear());
  const data = await getPnl(year, propertyParam && propertyParam !== '' ? propertyParam : null);

  const short = (month: string) => MONTH_LABEL[Number(month.slice(5, 7)) - 1];
  const dollars = (cents: number) => (cents / 100).toFixed(2);

  const exportRows = [
    ['Line', ...data.months.map(short), 'Total'],
    ...data.income.map((row) => [row.label, ...data.months.map((m) => dollars(row.byMonth[m])), dollars(row.totalCents)]),
    ['Total income', ...data.months.map((m) => dollars(data.incomeByMonth[m])), dollars(data.totalIncomeCents)],
    ...data.expenses.map((row) => [row.label, ...data.months.map((m) => dollars(row.byMonth[m])), dollars(row.totalCents)]),
    ['Total expenses', ...data.months.map((m) => dollars(data.expenseByMonth[m])), dollars(data.totalExpenseCents)],
    ['Net operating cash', ...data.months.map((m) => dollars(data.netByMonth[m])), dollars(data.netCents)],
  ];

  const Section = ({ title, rows, totals, totalCents }: {
    title: string;
    rows: typeof data.income;
    totals: Record<string, number>;
    totalCents: number;
  }) => (
    <>
      <tr>
        <Td><strong>{title}</strong></Td>
        {data.months.map((m) => <Td key={m} right />)}
        <Td right />
      </tr>
      {rows.length === 0 ? (
        <tr>
          <Td><span className="pl-3 text-muted">nothing</span></Td>
          {data.months.map((m) => <Td key={m} right />)}
          <Td right />
        </tr>
      ) : (
        rows.map((row) => (
          <tr key={row.categoryKey}>
            <Td>
              <Link href={`/books?category=${row.categoryKey}&from=${year}-01-01&to=${year}-12-31`} className="pl-3 hover:text-accent">
                {row.label}
              </Link>
            </Td>
            {data.months.map((m) => (
              <Td key={m} right>
                {row.byMonth[m] === 0 ? <span className="num text-muted">—</span> : <Money cents={row.byMonth[m]} />}
              </Td>
            ))}
            <Td right><Money cents={row.totalCents} /></Td>
          </tr>
        ))
      )}
      <tr className="border-t border-line">
        <Td><span className="pl-3 text-muted">Total {title.toLowerCase()}</span></Td>
        {data.months.map((m) => <Td key={m} right><Money cents={totals[m]} muted /></Td>)}
        <Td right><strong><Money cents={totalCents} /></strong></Td>
      </tr>
    </>
  );

  // The three biggest costs named and the rest grouped: a bar with fifteen
  // slivers carries less than one with four, and the tail is individually
  // unactionable anyway.
  const ranked = [...data.expenses].sort((a, b) => b.totalCents - a.totalCents);
  const composition = [
    ...ranked.slice(0, 3).map((row, index) => ({ label: row.label, value: row.totalCents, color: SERIES[index] })),
    ...(ranked.length > 3
      ? [{
          label: `${ranked.length - 3} smaller costs`,
          value: ranked.slice(3).reduce((sum, row) => sum + row.totalCents, 0),
          color: SERIES[3],
        }]
      : []),
  ].filter((segment) => segment.value > 0);

  return (
    <>
      <PageHeader title="Profit & loss" subtitle={`${data.propertyName ?? 'All properties'} · ${year}`} />
      <BooksTabs />

      <Explainer title="What this is and why it matters">
        What the year earned: rent in, running costs out, month by month. Cash basis — a line lands in the month the
        money moved, which is what a small landlord files and the only thing bank statements can honestly support.
        <div className="mt-1.5">
          Three things are deliberately <em>not</em> here, and their absence is the point. A{' '}
          <strong>security deposit</strong> is cash in the account and not a penny of it earned. A{' '}
          <strong>transfer between your own accounts</strong> moves money without creating any. An{' '}
          <strong>owner draw</strong> is you paying yourself out of profit already counted — putting it here would
          count the same money as a cost as well. Include any of the three and a quiet month reads as a good one.
        </div>
        <div className="mt-1.5">
          Mortgage <strong>principal</strong> is missing too: it is not a cost, it is you buying more of the house. Only
          the interest half is, and it shows on the{' '}
          <Link href="/reports" className="underline">year-end report</Link>, split out of each payment by the
          amortization schedule. So net here is not what hit your bank account — the{' '}
          <Link href="/" className="underline">portfolio view</Link> reconciles the two.
        </div>
      </Explainer>

      <Panel title="Period">
        <form method="get" className="grid grid-cols-12 gap-3">
          <div className="col-span-12 sm:col-span-3">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="year">Year</label>
            <select id="year" name="year" defaultValue={String(year)}>
              {[...new Set([year, ...data.years])].sort((a, b) => b - a).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-4">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="property">Property</label>
            <select id="property" name="property" defaultValue={data.propertyId ?? ''}>
              <option value="">All properties (consolidated)</option>
              {data.properties.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-12 flex items-center pt-1">
            <button type="submit" className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent">
              Show
            </button>
          </div>
        </form>
      </Panel>

      {data.uncategorizedCount > 0 ? (
        <Note tone="bad">
          {data.uncategorizedCount} transactions in {year} have no category, totalling{' '}
          <Money cents={data.uncategorizedCents} />. They are in none of the figures below, which will look finished
          either way — that is the danger. Clear them in{' '}
          <Link href="/review" className="underline">Review</Link>.
        </Note>
      ) : null}

      {data.income.length + data.expenses.length > 0 ? (
        <>
          <Panel
            title="Income and cost through the year"
            description="One axis, so the gap between the lines is the profit and can be read directly. Cost is drawn positive — the sign lives in the label, not in the geometry."
          >
            <Legend
              series={[
                { label: 'Income', color: SERIES[0] },
                { label: 'Cost', color: SERIES[1] },
                { label: 'Net', color: SERIES[2] },
              ]}
            />
            <LineChart
              labels={data.months}
              format={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
              series={[
                { label: 'Income', color: SERIES[0], points: data.months.map((m) => ({ label: m, value: data.incomeByMonth[m] / 100 })) },
                { label: 'Cost', color: SERIES[1], points: data.months.map((m) => ({ label: m, value: data.expenseByMonth[m] / 100 })) },
                { label: 'Net', color: SERIES[2], points: data.months.map((m) => ({ label: m, value: data.netByMonth[m] / 100 })) },
              ]}
            />
          </Panel>

          {data.expenses.length > 0 ? (
            <Panel
              title="Where the money went"
              description="Every cost for the year, largest first. The three biggest are named; the rest are grouped, because a bar with fifteen slivers tells you less than one with four."
            >
              <StackedBar segments={composition} height={20} />
              <table className="mt-3">
                <tbody>
                  {composition.map((segment) => (
                    <tr key={segment.label}>
                      <Td>
                        <span className="mr-2 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: segment.color }} />
                        {segment.label}
                      </Td>
                      <Td right><Money cents={segment.value} /></Td>
                      <Td right>
                        <span className="num text-muted">
                          {data.totalExpenseCents ? `${((segment.value / data.totalExpenseCents) * 100).toFixed(0)}%` : '—'}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : null}
        </>
      ) : null}

      <Panel
        title={`${year} · ${data.propertyName ?? 'consolidated'}`}
        description={data.propertyId === null ? 'Consolidated: a management fee one of your entities charges another is dropped, so it is not counted as a cost and a receipt at once.' : undefined}
        actions={<ExportButton filename={`profit-and-loss-${year}.csv`} rows={exportRows} />}
      >
        {data.income.length === 0 && data.expenses.length === 0 ? (
          <Empty>
            Nothing categorized in {year} yet. <Link href="/imports" className="underline">Import a statement</Link> and
            categorize it in <Link href="/review" className="underline">Review</Link>.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Line</Th>
                  {data.months.map((m) => <Th key={m} right>{short(m)}</Th>)}
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                <Section title="Income" rows={data.income} totals={data.incomeByMonth} totalCents={data.totalIncomeCents} />
                <Section title="Expenses" rows={data.expenses} totals={data.expenseByMonth} totalCents={data.totalExpenseCents} />
                <tr className="border-t-2 border-line">
                  <Td><strong>Net operating cash</strong></Td>
                  {data.months.map((m) => (
                    <Td key={m} right>
                      <span className={data.netByMonth[m] < 0 ? 'text-bad' : ''}><Money cents={data.netByMonth[m]} /></span>
                    </Td>
                  ))}
                  <Td right>
                    <strong className={data.netCents < 0 ? 'text-bad' : ''}><Money cents={data.netCents} /></strong>
                  </Td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {data.excludedCents !== 0 ? (
        <Note tone="muted">
          <Money cents={data.excludedCents} /> of real money moved in {year} that is neither income nor cost — deposits
          held, transfers between your own accounts, owner draws and contributions, loan proceeds. It is all in the{' '}
          <Link href="/books" className="underline">register</Link>, and none of it belongs on a profit and loss.
        </Note>
      ) : null}
    </>
  );
}
