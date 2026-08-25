import Link from 'next/link';
import { getOperations } from '@/lib/padsplit-queries';
import { PortfolioTabs } from '@/components/PortfolioTabs';
import { Badge, Empty, Explainer, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const data = await getOperations(monthParam);

  if (!data.hasData) {
    return (
      <>
        <PageHeader title="Operations" subtitle="Occupancy, collections and what each room actually earns." />
        <PortfolioTabs />
        <Panel>
          <Empty>
            Nothing imported yet. Drop a PadSplit export into{' '}
            <Link href="/imports" className="underline">Imports</Link> — all four files at once.
          </Empty>
        </Panel>
      </>
    );
  }

  const sum = (pick: (row: (typeof data.rows)[number]) => number) => data.rows.reduce((total, row) => total + pick(row), 0);
  const roomsOccupied = sum((r) => r.roomsOccupied);
  const roomsTotal = sum((r) => r.roomsTotal);
  const netBilled = sum((r) => r.netBilledCents);
  const gross = sum((r) => r.grossCollectedCents);

  return (
    <>
      <PageHeader
        title="Operations"
        subtitle={`${data.month}${data.inFlight ? ' · still collecting' : ''} · occupancy, collections and what each room actually earns`}
      />
      <PortfolioTabs />

      <Explainer title="What this is and why it matters">
        The operating view of the coliving houses, from the PadSplit export. Everything here is keyed to the{' '}
        <strong>earnings month</strong> — the month the rent was for — which is deliberately not the month the money
        arrives. PadSplit pays a month in arrears, so August&apos;s rent lands in September; the income belongs to
        September on a cash basis and shows there in the{' '}
        <Link href="/books/pnl" className="underline">profit &amp; loss</Link>, while occupancy and collections stay
        here on August, where they mean something.
        <div className="mt-1.5">
          A month still collecting is marked <strong>in flight</strong>. Its collection rate and delinquency are
          withheld rather than shown low, because they are not low — they are incomplete. A property&apos;s first month
          is excluded from the true room rate for the same reason, and its second if occupancy was under 70%: a
          half-filled ramp-up month would drag down a figure meant to describe the house running normally.
        </div>
      </Explainer>

      <div className="mb-5 flex flex-wrap items-center gap-1 text-[12px]">
        <span className="mr-2 text-muted">Earnings month</span>
        {data.months.map((m) => (
          <Link
            key={m}
            href={`/operations?month=${m}`}
            className={`rounded px-2 py-0.5 ${m === data.month ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
          >
            {m}
          </Link>
        ))}
      </div>

      {data.inFlight ? (
        <Note>
          {data.month} is still collecting, so collection rate and delinquency are not shown for it. Money is still
          arriving against these charges.
        </Note>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Gross collected" value={formatCents(gross)} />
        <Stat label="Host earnings" value={formatCents(sum((r) => r.hostEarningsCents))} hint={`${formatCents(-sum((r) => r.feesCents))} kept by PadSplit`} />
        <Stat label="Payout" value={formatCents(sum((r) => r.payoutCents))} hint="What hits the bank next month." />
        <Stat label="Occupancy" value={roomsTotal ? `${((roomsOccupied / roomsTotal) * 100).toFixed(0)}%` : '—'} hint={`${roomsOccupied} of ${roomsTotal} rooms`} />
        <Stat
          label="Outstanding"
          value={formatCents(data.outstandingTotalCents)}
          hint="Charged and never collected, all months."
          tone={data.outstandingTotalCents > 0 ? 'bad' : 'muted'}
        />
      </div>

      <Panel title={`${data.month} by property`}>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th right>Rooms</Th>
                <Th right>Occupancy</Th>
                <Th right>Members</Th>
                <Th right>Billed</Th>
                <Th right>Collected</Th>
                <Th right>Delinquency</Th>
                <Th right>Collection</Th>
                <Th right>PadSplit fees</Th>
                <Th right>Host earnings</Th>
                <Th right>Misc income</Th>
                <Th right>Payout</Th>
                <Th right>Per room</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.propertyId} className="hover:bg-surface-2/50">
                  <Td>
                    <Link href={`/properties/${row.propertyId}`} className="hover:text-accent">
                      {row.propertyName}
                    </Link>
                    {row.metrics.outlier ? (
                      <Badge tone="warn">{row.metrics.outlierReason === 'first_active_month' ? 'first month' : 'ramping'}</Badge>
                    ) : null}
                  </Td>
                  <Td right>
                    <span className="num">{row.roomsOccupied}/{row.roomsTotal}</span>
                  </Td>
                  <Td right><Pct value={row.metrics.occupancyRate} digits={0} /></Td>
                  <Td right><span className="num">{row.membersActive}</span></Td>
                  <Td right><Money cents={row.netBilledCents} muted /></Td>
                  <Td right><Money cents={row.grossCollectedCents} /></Td>
                  <Td right>
                    {row.inFlight ? (
                      <span className="num text-muted">—</span>
                    ) : row.metrics.delinquencyCents > 0 ? (
                      <span className="text-bad">
                        <Money cents={row.metrics.delinquencyCents} />
                      </span>
                    ) : (
                      // Negative delinquency is a house catching up on arrears.
                      // Rendering it red would read as a problem; it is the
                      // opposite of one.
                      <span className="num text-muted" title="Collected more than was billed this month — catching up on arrears">
                        caught up
                      </span>
                    )}
                  </Td>
                  <Td right>{row.inFlight ? <span className="num text-muted">—</span> : <Pct value={row.metrics.collectionRate} digits={0} />}</Td>
                  <Td right><Money cents={row.feesCents} muted /></Td>
                  <Td right><Money cents={row.hostEarningsCents} /></Td>
                  <Td right>{row.adjustmentsCents ? <Money cents={row.adjustmentsCents} /> : <span className="num text-muted">—</span>}</Td>
                  <Td right><Money cents={row.payoutCents} /></Td>
                  <Td right><Money cents={row.metrics.hostEarningsPerOccupiedRoomCents ?? 0} muted /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="What a room earns"
        description="The median of host earnings per occupied room, across months where the house was running normally. Median rather than mean, so one catch-up month does not move it."
      >
        <table>
          <thead>
            <tr>
              <Th>Property</Th>
              <Th right>True room rate</Th>
              <Th right>Months used</Th>
              <Th>Per month</Th>
            </tr>
          </thead>
          <tbody>
            {data.trueRoomRates.map((rate) => {
              const own = data.history.filter((row) => row.propertyId === rate.propertyId);
              return (
                <tr key={rate.propertyId}>
                  <Td>{rate.propertyName}</Td>
                  <Td right>{rate.rateCents === null ? <span className="num text-muted">—</span> : <Money cents={rate.rateCents} />}</Td>
                  <Td right><span className="num">{rate.monthsUsed}</span></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {own.map((row) => (
                        <span
                          key={row.earningsMonth}
                          title={`${row.earningsMonth} · ${formatCents(row.metrics.hostEarningsPerOccupiedRoomCents ?? 0)} per room`}
                          className={`num rounded px-1 py-0.5 text-[10px] ${
                            row.inFlight ? 'bg-surface-2 text-muted' : row.metrics.outlier ? 'bg-warn/10 text-warn' : 'bg-surface-2'
                          }`}
                        >
                          {formatCents(row.metrics.hostEarningsPerOccupiedRoomCents ?? 0).replace('$', '')}
                        </span>
                      ))}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="What is still owed"
          description="Charges raised and never collected, aged by the month they were raised. Concessions are money given back and are not in here."
        >
          <table>
            <thead>
              <tr>
                <Th>Age</Th>
                <Th right>Outstanding</Th>
                <Th right>Share</Th>
              </tr>
            </thead>
            <tbody>
              {data.ageing.map((bucket) => (
                <tr key={bucket.label}>
                  <Td>{bucket.label}</Td>
                  <Td right>
                    <span className={bucket.label === 'Over 90 days' && bucket.amountCents > 0 ? 'text-bad' : ''}>
                      <Money cents={bucket.amountCents} />
                    </span>
                  </Td>
                  <Td right>
                    <Pct value={data.outstandingTotalCents ? (bucket.amountCents / data.outstandingTotalCents) * 100 : null} digits={0} />
                  </Td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <Td><strong>Total</strong></Td>
                <Td right><strong><Money cents={data.outstandingTotalCents} /></strong></Td>
                <Td right />
              </tr>
            </tbody>
          </table>
          {data.daysToCollect ? (
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              When cash does arrive it arrives quickly: a median of {data.daysToCollect.median} days after the charge
              is raised, {data.daysToCollect.p90} days at the ninetieth percentile, across{' '}
              {data.daysToCollect.count} collections. Anything past thirty days is stuck rather than slow.
            </p>
          ) : null}
        </Panel>

        <Panel title="Who owes it" description="Outstanding by member, across every month.">
          {data.memberBalances.length === 0 ? (
            <Empty>Nothing outstanding.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Property</Th>
                  <Th right>Outstanding</Th>
                </tr>
              </thead>
              <tbody>
                {data.memberBalances.map((member) => (
                  <tr key={member.memberId}>
                    <Td>
                      {member.memberName}
                      {member.roomNumber ? <span className="ml-1.5 text-[11px] text-muted">room {member.roomNumber}</span> : null}
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">{member.propertyName}</span>
                    </Td>
                    <Td right><Money cents={member.outstandingCents} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="What the arrears are for" description="Outstanding by the reason the charge was raised.">
        <table>
          <thead>
            <tr>
              <Th>Reason</Th>
              <Th right>Outstanding</Th>
            </tr>
          </thead>
          <tbody>
            {data.outstandingByReason.map((row) => (
              <tr key={row.reason}>
                <Td>{row.reason.replace(/_/g, ' ')}</Td>
                <Td right><Money cents={row.amountCents} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Every month" description="Each property across every month imported. In-flight and ramp-up months are marked.">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Month</Th>
                <Th right>Occupancy</Th>
                <Th right>Collection</Th>
                <Th right>Delinquency</Th>
                <Th right>Host earnings</Th>
                <Th right>Per room</Th>
                <Th right>Cohort recovered</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.history.map((row) => (
                <tr key={`${row.propertyId}-${row.earningsMonth}`} className="hover:bg-surface-2/50">
                  <Td>{row.propertyName}</Td>
                  <Td><span className="num">{row.earningsMonth}</span></Td>
                  <Td right><Pct value={row.metrics.occupancyRate} digits={0} /></Td>
                  <Td right>{row.inFlight ? <span className="num text-muted">—</span> : <Pct value={row.metrics.collectionRate} digits={0} />}</Td>
                  <Td right>
                    {row.inFlight ? (
                      <span className="num text-muted">—</span>
                    ) : row.metrics.delinquencyCents > 0 ? (
                      <Money cents={row.metrics.delinquencyCents} />
                    ) : (
                      <span className="num text-muted">caught up</span>
                    )}
                  </Td>
                  <Td right><Money cents={row.hostEarningsCents} /></Td>
                  <Td right><Money cents={row.metrics.hostEarningsPerOccupiedRoomCents ?? 0} muted /></Td>
                  <Td right>
                    <Pct value={row.cohortChargedCents ? (row.cohortCollectedCents / row.cohortChargedCents) * 100 : null} digits={0} />
                  </Td>
                  <Td>
                    {row.inFlight ? <Badge>in flight</Badge> : row.metrics.outlier ? <Badge tone="warn">ramping</Badge> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Note tone="muted">
        Collection rate is money collected against what was billed <em>in that month</em>, and can exceed 100% when a
        house catches up on arrears. Cohort recovered follows each charge to the cash that settled it instead, so it
        never exceeds 100% and is the fairer measure of whether a month was actually paid — but it reads low on recent
        months, which are still being collected.
      </Note>
    </>
  );
}

function Stat({ label, value, hint, tone = 'muted' }: { label: string; value: string; hint?: string; tone?: 'muted' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1 text-[18px] ${tone === 'bad' ? 'text-bad' : ''}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
