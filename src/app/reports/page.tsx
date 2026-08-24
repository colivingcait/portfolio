import Link from 'next/link';
import { getYearReport } from '@/lib/reports-queries';
import { Badge, Empty, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { ExportButton } from '@/components/ExportButton';
import { formatCents } from '@/lib/engine/money';
import { mappingTable } from '@/lib/engine/tax';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; entity?: string }>;
}) {
  const params = await searchParams;
  const year = Number(params.year) || new Date().getUTCFullYear();
  const entityId = params.entity ?? null;
  const data = await getYearReport(year, entityId);

  const years = [year - 2, year - 1, year, year + 1].filter((y) => y <= new Date().getUTCFullYear() + 1);

  // One sheet the accountant can open: a column per property, a row per line.
  const exportRows: (string | number)[][] = [
    ['Schedule E', String(year), ...data.rows.map((r) => r.propertyName)],
    ['Entity', '', ...data.rows.map((r) => r.entityName)],
    ['Rents received', '', ...data.rows.map((r) => (r.scheduleE.grossRentsCents / 100).toFixed(2))],
    ...(data.rows[0]?.scheduleE.lines ?? []).map((line, index) => [
      `${line.number} ${line.label}`,
      '',
      ...data.rows.map((r) => (r.scheduleE.lines[index].amountCents / 100).toFixed(2)),
    ]),
    ['Total expenses', '', ...data.rows.map((r) => (r.scheduleE.totalExpensesCents / 100).toFixed(2))],
    ['Net income', '', ...data.rows.map((r) => (r.scheduleE.netIncomeCents / 100).toFixed(2))],
    [],
    ['Capitalizable (depreciate, not deduct)', '', ...data.rows.map((r) => (r.scheduleE.capitalizableTotalCents / 100).toFixed(2))],
    ['Principal paid (not deductible)', '', ...data.rows.map((r) => (r.principalPaidCents / 100).toFixed(2))],
    ['Uncategorized transactions', '', ...data.rows.map((r) => r.scheduleE.uncategorizedCount)],
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Year-end figures in the vocabulary an accountant uses, built from the operational categories you already assign. Nothing here changes how anything is categorized."
        actions={
          <div className="flex items-center gap-1 text-[13px]">
            {years.map((option) => (
              <Link
                key={option}
                href={`/reports?year=${option}${entityId ? `&entity=${entityId}` : ''}`}
                className={`rounded px-2 py-0.5 ${option === year ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
              >
                {option}
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <Link href={`/reports?year=${year}`} className={`rounded-md px-2.5 py-1 ${!entityId ? 'bg-surface-2' : 'text-muted hover:text-text'}`}>
          All entities
        </Link>
        {data.entities.map((entity) => (
          <Link
            key={entity.value}
            href={`/reports?year=${year}&entity=${entity.value}`}
            className={`rounded-md px-2.5 py-1 ${entityId === entity.value ? 'bg-surface-2' : 'text-muted hover:text-text'}`}
          >
            {entity.label}
          </Link>
        ))}
      </div>

      {data.totalUncategorized > 0 ? (
        <Note tone="bad">
          {data.totalUncategorized} transactions are still uncategorized across {year}. Until they are cleared in{' '}
          <Link href="/review" className="underline">Review</Link>, these totals are incomplete — and they will look
          finished either way, which is the danger.
        </Note>
      ) : null}

      {data.monthsCovered < 12 ? (
        <Note>
          Only {data.monthsCovered} month{data.monthsCovered === 1 ? '' : 's'} of {year} have been imported. Every
          figure below covers that much and no more; the metrics say where they have been annualised from a part year.
        </Note>
      ) : null}

      {data.rows.some((r) => r.scheduleE.unallocatedEscrowCents > 0) ? (
        <Note>
          Escrow went out inside a mortgage payment with no disbursement split on record, so it is on no line below.
          Paying into escrow is not a deduction — what the servicer paid out for taxes and insurance is. Put the annual
          amounts on the loan in{' '}
          <Link href="/settings/loans" className="underline">Settings → Loans</Link>, taking them off the servicer's
          year-end escrow analysis.
          {data.rows
            .filter((r) => r.scheduleE.unallocatedEscrowCents > 0)
            .map((r) => (
              <span key={r.propertyId} className="ml-2 whitespace-nowrap">
                {r.propertyName}: <Money cents={r.scheduleE.unallocatedEscrowCents} />
              </span>
            ))}
        </Note>
      ) : null}

      {data.crossesEntities ? (
        <Note tone="muted">
          These properties are held by more than one entity, and each files separately. Use the entity filter above
          before handing anything over.
        </Note>
      ) : null}

      <Panel
        title={`Schedule E · ${year}`}
        description="Rents received less deductible expenses, per property. Mortgage interest comes from the amortization schedules, so only the deductible half of each payment appears."
        actions={<ExportButton filename={`schedule-e-${year}.csv`} rows={exportRows} />}
      >
        {data.rows.length === 0 ? (
          <Empty>No properties to report on.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Line</Th>
                  {data.rows.map((row) => (
                    <Th key={row.propertyId} right>
                      {row.propertyName}
                    </Th>
                  ))}
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>
                    <strong>Rents received</strong>
                  </Td>
                  {data.rows.map((row) => (
                    <Td key={row.propertyId} right>
                      <Money cents={row.scheduleE.grossRentsCents} />
                    </Td>
                  ))}
                  <Td right>
                    <Money cents={data.rows.reduce((s, r) => s + r.scheduleE.grossRentsCents, 0)} />
                  </Td>
                </tr>

                {(data.rows[0]?.scheduleE.lines ?? []).map((line, index) => {
                  const total = data.rows.reduce((s, r) => s + r.scheduleE.lines[index].amountCents, 0);
                  if (total === 0 && line.line !== 'depreciation') return null;
                  return (
                    <tr key={line.line}>
                      <Td>
                        <span className="text-muted">{line.number}</span> {line.label}
                        {line.line === 'depreciation' ? (
                          <span className="ml-1 text-[11px] text-muted">— your accountant computes this</span>
                        ) : null}
                      </Td>
                      {data.rows.map((row) => (
                        <Td key={row.propertyId} right>
                          {row.scheduleE.lines[index].amountCents ? (
                            <Money cents={row.scheduleE.lines[index].amountCents} />
                          ) : (
                            <span className="num text-muted">—</span>
                          )}
                        </Td>
                      ))}
                      <Td right>
                        <Money cents={total} />
                      </Td>
                    </tr>
                  );
                })}

                <tr className="font-medium">
                  <Td>Total expenses</Td>
                  {data.rows.map((row) => (
                    <Td key={row.propertyId} right>
                      <Money cents={row.scheduleE.totalExpensesCents} />
                    </Td>
                  ))}
                  <Td right>
                    <Money cents={data.rows.reduce((s, r) => s + r.scheduleE.totalExpensesCents, 0)} />
                  </Td>
                </tr>
                <tr className="font-medium">
                  <Td>Net income</Td>
                  {data.rows.map((row) => (
                    <Td key={row.propertyId} right>
                      <Money cents={row.scheduleE.netIncomeCents} />
                    </Td>
                  ))}
                  <Td right>
                    <Money cents={data.rows.reduce((s, r) => s + r.scheduleE.netIncomeCents, 0)} />
                  </Td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Not deducted here"
        description="Two things a bank statement makes look like expenses and which are not."
      >
        <table>
          <thead>
            <tr>
              <Th>Property</Th>
              <Th right>Capitalizable spend</Th>
              <Th right>Principal repaid</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.propertyId}>
                <Td>{row.propertyName}</Td>
                <Td right>
                  <Money cents={row.scheduleE.capitalizableTotalCents} />
                </Td>
                <Td right>
                  <Money cents={row.principalPaidCents} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Furnishings and capital spend are depreciated rather than deducted, so they are listed for your accountant to
          set up as assets rather than folded into expenses. Principal repayment is not an expense at all — only the
          interest half of each mortgage payment is, and that is already on line 12.
        </p>
      </Panel>

      <Panel title={`Returns · ${year}`} description="Cap rate measures the property; cash-on-cash and IRR measure your money.">
        {data.rows.length === 0 ? (
          <Empty>Nothing to measure yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th right>NOI</Th>
                  <Th right>Cap rate</Th>
                  <Th right>DSCR</Th>
                  <Th right>Net cash</Th>
                  <Th right>Cash invested</Th>
                  <Th right>Cash on cash</Th>
                  <Th right>Expense ratio</Th>
                  <Th right>IRR</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.propertyId}>
                    <Td>
                      {row.propertyName}
                      <div className="mt-0.5 text-[11px] text-muted">
                        {row.monthsWithData} month{row.monthsWithData === 1 ? '' : 's'} of data
                      </div>
                    </Td>
                    <Td right>
                      <Money cents={row.noiCents} />
                    </Td>
                    <Td right>
                      <Pct value={row.metrics.capRatePercent} />
                      {row.metrics.capRateAnnualised ? <Badge tone="warn">annualised</Badge> : null}
                    </Td>
                    <Td right>
                      <span className={`num ${row.metrics.dscr !== null && row.metrics.dscr < 1 ? 'text-bad' : ''}`}>
                        {row.metrics.dscr !== null ? row.metrics.dscr.toFixed(2) : '—'}
                      </span>
                    </Td>
                    <Td right>
                      <Money cents={row.netCashCents} />
                    </Td>
                    <Td right>
                      {row.cashInvestedCents ? <Money cents={row.cashInvestedCents} muted /> : <span className="num text-muted">not set</span>}
                    </Td>
                    <Td right>
                      <Pct value={row.metrics.cashOnCashPercent} />
                    </Td>
                    <Td right>
                      <Pct value={row.metrics.expenseRatioPercent} />
                    </Td>
                    <Td right>
                      {row.metrics.irr.percent !== null ? (
                        <>
                          <Pct value={row.metrics.irr.percent} />
                          {row.metrics.irr.usesEstimatedExit ? <Badge tone="warn">est. exit</Badge> : null}
                        </>
                      ) : (
                        <span className="num text-muted" title={row.metrics.irr.reason}>—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted">
          <p>
            <strong>Cash invested</strong> is what left your pocket — deposit, closing costs, rehab — not the purchase
            price. Set it per property in Settings; without it, cash-on-cash and IRR have no denominator and stay blank
            rather than guessing.
          </p>
          <p>
            <strong>IRR</strong> here ends in an estimated value rather than a sale, which makes it a projection. It
            only becomes a result when a property actually sells.
          </p>
        </div>
      </Panel>

      <Panel
        title="How categories map"
        description="For your accountant, and for you when a category looks wrong. Nothing here appears while categorizing."
      >
        <div className="max-h-80 overflow-auto">
          <table>
            <thead className="sticky top-0 bg-surface">
              <tr>
                <Th>You choose</Th>
                <Th>Treated as</Th>
                <Th>Schedule E line</Th>
              </tr>
            </thead>
            <tbody>
              {mappingTable(data.catalog).map((row) => (
                <tr key={row.categoryKey}>
                  <Td>{row.label}</Td>
                  <Td>
                    <span className={`text-[12px] ${row.treatment === 'capitalizable' ? 'text-warn' : 'text-muted'}`}>
                      {row.treatment.replace(/_/g, ' ')}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[12px]">{row.line}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Note tone="muted">
        This is a bookkeeping summary, not tax advice, and it is only as complete as what has been imported and
        categorized. Depreciation, basis, placed-in-service dates and how PadSplit’s platform fees are treated are your
        accountant’s calls — the point of this page is to hand them clean figures rather than a shoebox.
      </Note>
    </>
  );
}
