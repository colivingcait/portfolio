import Link from 'next/link';
import { getEquity } from '@/lib/equity-queries';
import { todayIso } from '@/lib/queries';
import { Badge, Empty, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

const SOURCE_LABELS: Record<string, string> = {
  appraisal: 'Appraisal',
  broker_opinion: 'Broker opinion',
  contract: 'Under contract',
  sale: 'Sold',
  purchase: 'Purchase price',
  avm: 'Automated estimate',
  owner_estimate: 'Own estimate',
};

const COST_OPTIONS = [0, 6, 8, 10];

export default async function EquityPage({
  searchParams,
}: {
  searchParams: Promise<{ costs?: string }>;
}) {
  const params = await searchParams;
  const sellingCostsPercent = COST_OPTIONS.includes(Number(params.costs)) ? Number(params.costs) : 0;
  const asOf = todayIso();
  const data = await getEquity(asOf, sellingCostsPercent);

  const valued = data.rows.filter((r) => r.valued);

  return (
    <>
      <PageHeader
        title="Equity"
        subtitle="What the portfolio is worth, what it owes, and what a sale would actually put in your pocket once anyone owed capital is repaid."
        actions={<span className="text-[12px] text-muted">as of {asOf}</span>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Estimated value" value={formatCents(data.totals.valueCents)} hint={`${valued.length} of ${data.rows.length} properties valued`} />
        <Stat label="Debt outstanding" value={formatCents(data.totals.debtBalanceCents)} hint={data.totals.ltvPercent !== null ? `${data.totals.ltvPercent.toFixed(1)}% LTV` : undefined} />
        <Stat label="Equity" value={formatCents(data.totals.equityCents)} />
        <Stat
          label="Your share of equity"
          value={data.hasViewer ? formatCents(data.totals.shareOfEquityCents) : '—'}
          hint={data.hasViewer ? 'Before capital is repaid' : 'No entity is marked as you'}
        />
      </div>

      {data.totals.unvaluedCount > 0 ? (
        <Note>
          {data.totals.unvaluedCount} {data.totals.unvaluedCount === 1 ? 'property has' : 'properties have'} no value
          estimate. Their debt is counted in the totals above but their value is not, so equity is understated and LTV
          overstated. Add estimates in{' '}
          <Link href="/settings/valuations" className="underline">Settings → Valuations</Link>.
        </Note>
      ) : null}

      {data.totals.staleCount > 0 ? (
        <Note>
          {data.totals.staleCount} estimate{data.totals.staleCount === 1 ? ' is' : 's are'} more than a year old. An
          appraisal from two years ago is not evidence about today.
        </Note>
      ) : null}

      <Panel
        title="By property"
        description="Equity pro-rates, unlike occupancy — a share of it is a real number. What it is not is what you would walk away with, which the sale view below works out."
      >
        {data.rows.length === 0 ? (
          <Empty>No properties yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Estimate</Th>
                <Th right>Value</Th>
                <Th right>Debt</Th>
                <Th right>Equity</Th>
                <Th right>LTV</Th>
                <Th right>Your share</Th>
                <Th right>Your equity</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.propertyId}>
                  <Td>
                    <Link href={`/properties/${row.propertyId}`} className="hover:text-accent">
                      {row.propertyName}
                    </Link>
                    <div className="mt-0.5 text-[11px] text-muted">{row.entityName}</div>
                  </Td>
                  <Td>
                    {row.valued ? (
                      <>
                        <span className="text-[12px]">{SOURCE_LABELS[row.valuationSource ?? ''] ?? row.valuationSource}</span>
                        <div className="mt-0.5 text-[11px] text-muted">
                          <span className="num">{row.valuationDate}</span>
                          {row.stale ? <Badge tone="warn">stale</Badge> : null}
                        </div>
                      </>
                    ) : (
                      <Badge tone="warn">no estimate</Badge>
                    )}
                  </Td>
                  <Td right>{row.valued ? <Money cents={row.valueCents} /> : <span className="num text-muted">—</span>}</Td>
                  <Td right>
                    <Money cents={row.debtBalanceCents} muted />
                  </Td>
                  <Td right>{row.valued ? <Money cents={row.equityCents} /> : <span className="num text-muted">—</span>}</Td>
                  <Td right>
                    <Pct value={row.ltvPercent} />
                  </Td>
                  <Td right>
                    <Pct value={row.sharePercent} />
                  </Td>
                  <Td right>{row.valued ? <Money cents={row.shareOfEquityCents} /> : <span className="num text-muted">—</span>}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <Td>Total</Td>
                <Td />
                <Td right>
                  <Money cents={data.totals.valueCents} />
                </Td>
                <Td right>
                  <Money cents={data.totals.debtBalanceCents} />
                </Td>
                <Td right>
                  <Money cents={data.totals.equityCents} />
                </Td>
                <Td right>
                  <Pct value={data.totals.ltvPercent} />
                </Td>
                <Td />
                <Td right>
                  <Money cents={data.totals.shareOfEquityCents} />
                </Td>
              </tr>
            </tfoot>
          </table>
        )}
      </Panel>

      <Panel
        title="If it sold today"
        description="Proceeds in the order they are actually paid: selling costs, then debt, then capital back to whoever put it in, then the rest split by ownership."
        actions={
          <div className="flex items-center gap-1 text-[12px]">
            <span className="text-muted">Selling costs</span>
            {COST_OPTIONS.map((option) => (
              <Link
                key={option}
                href={`/equity?costs=${option}`}
                className={`rounded px-2 py-0.5 ${sellingCostsPercent === option ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
              >
                {option}%
              </Link>
            ))}
          </div>
        }
      >
        {valued.length === 0 ? (
          <Empty>No property has a value estimate yet, so there is nothing to work a sale out from.</Empty>
        ) : (
          valued.map((row) => (
            <div key={row.propertyId} className="mb-5 last:mb-0">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-medium">{row.propertyName}</h3>
                <span className="text-[12px] text-muted">
                  {formatCents(row.waterfall.valueCents)}
                  {row.waterfall.sellingCostsCents > 0 ? ` − ${formatCents(row.waterfall.sellingCostsCents)} costs` : ''} −{' '}
                  {formatCents(row.waterfall.debtBalanceCents)} debt ={' '}
                  <span className={row.waterfall.netProceedsCents < 0 ? 'text-bad' : ''}>
                    {formatCents(row.waterfall.netProceedsCents)}
                  </span>{' '}
                  net
                </span>
              </div>

              {row.waterfall.capitalShortfall ? (
                <Note tone="bad">
                  Proceeds of {formatCents(row.waterfall.netProceedsCents)} do not cover the{' '}
                  {formatCents(row.waterfall.capitalOwedCents)} of capital owed. Capital is repaid pro rata and nobody
                  sees profit.
                </Note>
              ) : null}

              <table>
                <thead>
                  <tr>
                    <Th>Who</Th>
                    <Th right>Capital returned</Th>
                    <Th right>Share of what is left</Th>
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {row.waterfall.rows.length === 0 ? (
                    <tr>
                      <Td>
                        <span className="text-[12px] text-muted">No ownership interests recorded for this property.</span>
                      </Td>
                      <Td />
                      <Td />
                      <Td />
                    </tr>
                  ) : (
                    row.waterfall.rows.map((entry) => (
                      <tr key={entry.entityId}>
                        <Td>{entry.name}</Td>
                        <Td right>
                          {entry.capitalReturnedCents ? <Money cents={entry.capitalReturnedCents} /> : <span className="num text-muted">—</span>}
                        </Td>
                        <Td right>
                          <Money cents={entry.profitShareCents} />
                        </Td>
                        <Td right>
                          <Money cents={entry.totalCents} />
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {row.hasCapital ? (
                <p className="mt-2 text-[11px] leading-snug text-muted">
                  {formatCents(row.waterfall.capitalOwedCents)} of capital comes out before anything is split, so a
                  share of equity and a share of proceeds are not the same number.
                </p>
              ) : null}
            </div>
          ))
        )}
      </Panel>

      <Note tone="muted">
        These are estimates, and the interface says which kind. An appraisal, a broker opinion and a Zestimate are
        different evidence, and none of them is a sale price. Nothing here feeds the P&amp;L — value is a balance-sheet
        figure, and no gain is recognised until a property actually sells.
      </Note>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-1 text-left text-[18px]">{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
