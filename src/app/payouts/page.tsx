import Link from 'next/link';
import { OwnersTabs } from '@/components/OwnersTabs';
import { getPayouts } from '@/lib/payouts-queries';
import { currentMonth } from '@/lib/queries';
import { Badge, Empty, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { DistributionRecorder } from '@/components/DistributionRecorder';
import { LoanPaymentRecorder } from '@/components/LoanPaymentRecorder';
import { addMonthsToMonth } from '@/lib/engine/dates';
import { formatCents } from '@/lib/engine/money';


export const dynamic = 'force-dynamic';

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = params.month ?? currentMonth();
  const data = await getPayouts(month);

  const withOwners = data.properties.filter((p) => p.owners.length > 0);
  const unpaid = data.due.filter((d) => !d.paid);

  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle="What leaves the business this month, and to whom. Lenders are owed interest whether or not the property earned anything; owners are owed a share of profit, and nothing when there is none."
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/payouts?month=${addMonthsToMonth(month, -1)}`} className="rounded border border-line px-2 py-1 text-[12px] text-muted hover:text-text">←</Link>
            <span className="num px-2 text-[13px]">{month}</span>
            <Link href={`/payouts?month=${addMonthsToMonth(month, 1)}`} className="rounded border border-line px-2 py-1 text-[12px] text-muted hover:text-text">→</Link>
          </div>
        }
      />

      <OwnersTabs />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Due to lenders" value={formatCents(data.totals.lendersCents)} hint={`${data.due.length} payment${data.due.length === 1 ? '' : 's'} scheduled`} />
        <Stat label="Still unpaid" value={formatCents(data.totals.unpaidLendersCents)} tone={data.totals.unpaidLendersCents > 0 ? 'bad' : 'muted'} hint={`${unpaid.length} outstanding`} />
        <Stat label="Owner distributions" value={formatCents(data.totals.ownersCents)} hint="Share of net cash" />
        <Stat label="Total out" value={formatCents(data.totals.totalCents)} />
      </div>

      <Note tone="muted">
        Lenders are owed {formatCents(data.totals.lendersCents)} this month
        {data.totals.unpaidLendersCents > 0
          ? `, ${formatCents(data.totals.unpaidLendersCents)} of it still unpaid`
          : ', all of it recorded as paid'}
        . Notes, what is still owed on each and where to aim a lump sum live in{' '}
        <Link href="/debt" className="underline">Debt</Link> — this page is what goes out to owners.
      </Note>

      {withOwners.length === 0 ? (
        <Panel title="Owner distributions">
          <Empty>
            No property has ownership interests recorded yet. Add them in{' '}
            <Link href="/owners/ownership" className="underline">Owners → Ownership</Link> — the split follows the
            distribution percentage where one is set, and equity otherwise.
          </Empty>
        </Panel>
      ) : (
        withOwners.map((property) => (
          <Panel
            key={property.propertyId}
            title={property.propertyName}
            description={
              property.hasRollup
                ? `Net cash for ${month}: ${formatCents(property.netCashCents)}. Split by each owner's share of distributions.`
                : `No statement imported for ${month} yet, so net cash is unknown and the split below is zero. Import the month first, or enter the amounts by hand.`
            }
            actions={<span className="num text-[13px] text-muted">{formatCents(property.distributableCents)}</span>}
          >
            <DistributionRecorder
              propertyId={property.propertyId}
              propertyName={property.propertyName}
              month={month}
              owners={property.owners}
              netCashCents={property.netCashCents}
            />
          </Panel>
        ))
      )}

      <Panel
        title="Distribution check"
        description="What the statements show leaving for owners this month, against what the capital accounts recorded. Matched on the date the money moved, so a September split paid in October is checked against October."
      >
        {data.distributionCheck.length === 0 ? (
          <Empty>
            No owner draws or contributions on the imported statements for {month}, and nothing recorded against it
            either. Nothing to check.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th right>Draws on statement</Th>
                <Th right>Distributions recorded</Th>
                <Th right>Contributions on statement</Th>
                <Th right>Contributions recorded</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.distributionCheck.map((row) => (
                <tr key={row.propertyId ?? row.propertyName}>
                  <Td>{row.propertyName}</Td>
                  <Td right>
                    <Money cents={row.bankDrawsCents} />
                  </Td>
                  <Td right>
                    <Money cents={row.recordedDistributionsCents} muted={row.drawDifferenceCents === 0} />
                  </Td>
                  <Td right>
                    <Money cents={row.bankContributionsCents} />
                  </Td>
                  <Td right>
                    <Money cents={row.recordedContributionsCents} muted={row.contributionDifferenceCents === 0} />
                  </Td>
                  <Td>
                    {row.status === 'tied' ? (
                      <Badge tone="good">Ties</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.drawDifferenceCents !== 0 && (
                          <Badge tone="warn">
                            Draws {formatCents(Math.abs(row.drawDifferenceCents))}{' '}
                            {row.drawDifferenceCents > 0 ? 'unrecorded' : 'over-recorded'}
                          </Badge>
                        )}
                        {row.contributionDifferenceCents !== 0 && (
                          <Badge tone="warn">
                            Contributions {formatCents(Math.abs(row.contributionDifferenceCents))}{' '}
                            {row.contributionDifferenceCents > 0 ? 'unrecorded' : 'over-recorded'}
                          </Badge>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.distributionCheck.some((r) => r.status === 'differs') && (
          <Note tone="warn">
            A gap here means the two records of the same event disagree. Money that left the account without a
            distribution recorded overstates what an investor is still owed back on sale; a distribution recorded
            without a transfer understates it. Either record the missing entry in{' '}
            <Link href="/owners/capital" className="underline">Owners → Capital</Link>, or fix the category on the
            statement row in <Link href="/review" className="underline">Review</Link>.
          </Note>
        )}
      </Panel>

      <Panel
        title="Capital accounts"
        description="Money an investor put in, and what is still owed back. A profit distribution does not reduce it — only capital handed back does."
      >
        {data.capital.length === 0 ? (
          <Empty>
            Nothing recorded. An investor who put money in without it being a loan belongs here: add a contribution in{' '}
            <Link href="/owners/capital" className="underline">Owners → Capital</Link>.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Investor</Th>
                <Th>Property</Th>
                <Th right>Contributed</Th>
                <Th right>Profit paid</Th>
                <Th right>Capital returned</Th>
                <Th right>Owed back on sale</Th>
              </tr>
            </thead>
            <tbody>
              {data.capital.map((position) => (
                <tr key={`${position.entityId}-${position.propertyName ?? 'all'}`}>
                  <Td>{position.entityName}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{position.propertyName ?? 'Portfolio-wide'}</span>
                  </Td>
                  <Td right>
                    <Money cents={position.contributedCents} />
                  </Td>
                  <Td right>
                    <Money cents={position.profitDistributedCents} muted />
                  </Td>
                  <Td right>
                    {position.returnedCents ? <Money cents={position.returnedCents} /> : <span className="num text-muted">—</span>}
                  </Td>
                  <Td right>
                    <Money cents={position.outstandingCents} />
                  </Td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <Td><strong>Total</strong></Td>
                <Td />
                <Td />
                <Td right>
                  <strong><Money cents={data.due.reduce((sum, d) => sum + d.interestCents, 0)} /></strong>
                </Td>
                <Td />
                <Td />
                <Td right>
                  <strong><Money cents={data.totals.lendersCents} /></strong>
                </Td>
                <Td right>
                  <strong className="num text-[12px]">
                    {formatCents(data.due.reduce((sum, d) => sum + d.stillOwedThisYearCents, 0))}
                  </strong>
                  <span className="mt-0.5 block text-[10px] font-normal text-muted">
                    {formatCents(data.due.reduce((sum, d) => sum + d.stillOwedToMaturityCents, 0))} to maturity
                  </span>
                </Td>
                <Td />
                <Td />
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      <Note tone="muted">
        An investor who put in capital for a share of profit is not a lender: the money accrues no interest and appears
        in no maturity ladder, but it is still owed back when the property sells. That is what the outstanding column
        tracks. If a partner is instead owed interest on a fixed sum, record it as a loan and it will show under debt
        payments above.
      </Note>
    </>
  );
}

function Stat({ label, value, hint, tone = 'muted' }: { label: string; value: string; hint?: string; tone?: 'muted' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1 text-left text-[18px] ${tone === 'bad' ? 'text-bad' : ''}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
