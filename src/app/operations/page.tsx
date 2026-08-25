import Link from 'next/link';
import { getOperations } from '@/lib/padsplit-queries';
import { PortfolioTabs } from '@/components/PortfolioTabs';
import { Badge, Empty, Explainer, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { formatCents } from '@/lib/engine/money';
import { RAMP, StackedBar, seriesColor } from '@/components/charts';
import { PortfolioChart } from '@/components/PortfolioChart';
import { PropertyBreakdown, type BreakdownProperty } from '@/components/PropertyBreakdown';
import { METRICS } from '@/lib/engine/metrics-catalog';
import { ViewControls } from '@/components/ViewControls';
import { resolveScope } from '@/lib/view-scope';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; property?: string }>;
}) {
  const params = await searchParams;

  const stored = await prisma.summaryLine.findMany({
    select: { earningsMonth: true },
    distinct: ['earningsMonth'],
    orderBy: { earningsMonth: 'asc' },
  });
  const scope = await resolveScope(params, stored.map((r) => r.earningsMonth));
  const data = await getOperations(scope.period.months, scope.propertyId);

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
  const roomsLetTotal = sum((r) => r.roomsLet);
  const roomsTotal = sum((r) => r.roomsTotal);
  // Occupancy is room-days let against room-days available — never an average
  // of the houses' rates, and never a count of rooms.
  const roomDaysAvailable = sum((r) => r.roomDaysAvailable);
  const occupancy = roomDaysAvailable > 0 ? (sum((r) => r.roomDaysLet) / roomDaysAvailable) * 100 : null;
  const turnoverTotal = sum((r) => r.turnovers);
  const settledRows = data.rows.filter((row) => !row.inFlight);
  const billedSettled = settledRows.reduce((total, row) => total + row.netBilledCents, 0);
  const collectedSettled = settledRows.reduce((total, row) => total + row.grossCollectedCents, 0);
  const collection = billedSettled > 0 ? (collectedSettled / billedSettled) * 100 : null;
  const turnoverProvisional = data.rows.some((r) => r.turnoversProvisional);

  // Colour follows the house, fixed everywhere, so hiding one series never
  // repaints the others.
  const houseNames = [...new Set(data.history.map((row) => row.propertyName))].sort();
  const houses = houseNames.map((name, index) => ({ name, color: seriesColor(index) }));

  // One value per month per house for every metric the chart can show, plus a
  // portfolio line worked out from the underlying rooms and dollars rather than
  // averaged out of the house lines — an average of four occupancy rates is not
  // the portfolio's occupancy.
  const at = (house: string, month: string) =>
    data.history.find((row) => row.propertyName === house && row.earningsMonth === month) ?? null;

  const perHouse = (pick: (row: (typeof data.history)[number]) => number | null) =>
    Object.fromEntries(
      houseNames.map((house) => [house, data.months.map((month) => (at(house, month) ? pick(at(house, month)!) : null))]),
    );

  const monthly = data.months.map((month) => data.history.filter((row) => row.earningsMonth === month));
  const total = (pick: (rows: (typeof data.history)[number][]) => number | null) =>
    monthly.map((rows) => (rows.length === 0 ? null : pick(rows)));
  const add = (rows: (typeof data.history)[number][], pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((running, row) => running + pick(row), 0);
  const settled = (rows: (typeof data.history)[number][]) => rows.every((row) => !row.inFlight);

  const values: Record<string, Record<string, (number | null)[]>> = {
    hostEarnings: perHouse((r) => r.hostEarningsCents),
    grossCollected: perHouse((r) => r.grossCollectedCents),
    platformFees: perHouse((r) => -r.feesCents),
    payout: perHouse((r) => r.payoutCents),
    occupancy: perHouse((r) => r.metrics.occupancyRate),
    turnovers: perHouse((r) => r.turnovers),
    collectionRate: perHouse((r) => (r.inFlight ? null : r.metrics.collectionRate)),
    delinquency: perHouse((r) => (r.inFlight ? null : r.metrics.delinquencyCents)),
    perRoom: perHouse((r) => r.metrics.hostEarningsPerOccupiedRoomCents),
  };

  const totals: Record<string, (number | null)[]> = {
    hostEarnings: total((rows) => add(rows, (r) => r.hostEarningsCents)),
    grossCollected: total((rows) => add(rows, (r) => r.grossCollectedCents)),
    platformFees: total((rows) => add(rows, (r) => -r.feesCents)),
    payout: total((rows) => add(rows, (r) => r.payoutCents)),
    occupancy: total((rows) => {
      const available = add(rows, (r) => r.roomDaysAvailable);
      return available > 0 ? (add(rows, (r) => r.roomDaysLet) / available) * 100 : null;
    }),
    turnovers: total((rows) => add(rows, (r) => r.turnovers)),
    collectionRate: total((rows) => {
      if (!settled(rows)) return null;
      const billed = add(rows, (r) => r.netBilledCents);
      return billed ? (add(rows, (r) => r.grossCollectedCents) / billed) * 100 : null;
    }),
    delinquency: total((rows) => (settled(rows) ? add(rows, (r) => r.metrics.delinquencyCents) : null)),
    perRoom: total((rows) => {
      const filled = add(rows, (r) => r.roomsLet);
      return filled ? add(rows, (r) => r.hostEarningsCents) / filled : null;
    }),
  };

  const breakdown: BreakdownProperty[] = data.rows.map((row) => {
    const colour = houses.find((h) => h.name === row.propertyName)?.color ?? seriesColor(0);
    return {
      id: row.propertyId,
      name: row.propertyName,
      color: colour,
      roomsLet: row.roomsLet,
      roomsTotal: row.roomsTotal,
      occupancyRate: row.metrics.occupancyRate,
      turnovers: row.turnovers,
      turnoversProvisional: row.turnoversProvisional,
      membersActive: row.membersActive,
      netBilledCents: row.netBilledCents,
      grossCollectedCents: row.grossCollectedCents,
      bookingFeesCents: row.bookingFeesCents,
      serviceFeesCents: row.serviceFeesCents,
      feesCents: row.feesCents,
      hostEarningsCents: row.hostEarningsCents,
      adjustmentsCents: row.adjustmentsCents,
      payoutCents: row.payoutCents,
      delinquencyCents: row.metrics.delinquencyCents,
      collectionRate: row.metrics.collectionRate,
      perRoomCents: row.metrics.hostEarningsPerOccupiedRoomCents,
      inFlight: row.inFlight,
      outlierReason: row.metrics.outlierReason,
      rooms: data.rooms
        .filter((room) => room.propertyId === row.propertyId)
        .map((room) => ({
          roomNumber: room.roomNumber,
          byMonth: room.byMonth,
          medianCents: room.medianCents,
          lastCents: [...room.byMonth].reverse().find((value) => value !== null) ?? null,
          people: room.people,
        })),
    };
  });

  return (
    <>
      <PageHeader
        title="Operations"
        subtitle={`${scope.propertyName ?? 'All properties'} · occupancy, collections and what each room earns`}
      />
      <PortfolioTabs />

      <ViewControls
        period={scope.periodKey}
        from={scope.from}
        to={scope.to}
        monthOptions={scope.monthOptions}
        properties={scope.properties}
        propertyId={scope.propertyId}
        summary={scope.summary}
      />

      <Explainer title="What this is">
        Occupancy, collections and turnover from the PadSplit export, keyed to the{' '}
        <strong>earnings month</strong> — the month the rent was for, not the month it arrived. The money side of the
        same rent sits a month later in the{' '}
        <Link href="/books/pnl" className="underline">profit &amp; loss</Link>, on a cash basis.
        <details className="mt-1.5">
          <summary className="cursor-pointer text-muted hover:text-text">How these are measured</summary>
          <div className="mt-1.5 space-y-1.5">
            <p>
              <strong>Occupancy and turnover come off what was billed, never what was paid.</strong> Dues are raised
              weekly in advance, so each charge is spread across the seven days it pays for: occupancy is room-days let
              against room-days available, and a week raised on 30 July counts toward August. A turnover is a tenancy
              ending — found where the next week&apos;s charge fell due before the export was taken and never came.
            </p>
            <p>
              Whether anyone then paid is the <strong>collection rate</strong>, deliberately a separate number. It is
              withheld for a month still collecting, because that figure is not low, it is incomplete. A property&apos;s
              first month is left out of the true room rate for the same reason, and its second if occupancy was under
              70%.
            </p>
          </div>
        </details>
      </Explainer>

      {scope.period.openMonths.length > 0 ? (
        <Note>
          This period includes {scope.period.openMonths.join(', ')}, which has not finished. Rent is still arriving
          against those charges, so collection rate and lost rent are withheld — they are not low, they are
          incomplete. <strong>Last month</strong> is the period to judge on.
        </Note>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Gross collected" value={formatCents(sum((r) => r.grossCollectedCents))} hint={`Billed ${formatCents(sum((r) => r.netBilledCents))}`} />
        <Stat label="Host earnings" value={formatCents(sum((r) => r.hostEarningsCents))} hint="Collected, less both PadSplit fees." />
        <Stat label="PadSplit fees" value={formatCents(-sum((r) => r.feesCents))} hint={`${formatCents(-sum((r) => r.bookingFeesCents))} of it booking fees`} />
        <Stat
          label="Occupancy"
          value={occupancy === null ? '—' : `${occupancy.toFixed(0)}%`}
          hint={`Room-days let against room-days available · ${roomsLetTotal} of ${roomsTotal} rooms let at some point`}
        />
        <Stat
          label="Turnovers"
          value={turnoverProvisional ? `${turnoverTotal}+` : String(turnoverTotal)}
          hint={
            turnoverProvisional
              ? 'Tenancies that ended. Still rising — a move-out in the export’s last week is not yet visible.'
              : 'Tenancies that ended in this period.'
          }
          tone={turnoverTotal > houseNames.length * 2 ? 'bad' : 'muted'}
        />
        <Stat
          label="Collection rate"
          value={collection === null ? '—' : `${collection.toFixed(0)}%`}
          hint={collection === null ? 'Withheld while a month in this period is still collecting.' : 'Cash in against what was billed.'}
        />
      </div>

      <Panel
        title="Portfolio over time"
        description={`History, with its own span — a trend needs more months than the period you are reporting on, so this one ignores the period above rather than collapsing to it. Pick a measure; click a house in the legend to drop it out. ${METRICS.length} measures across ${data.months.length} months.`}
      >
        <PortfolioChart months={data.months} houses={houses} values={values} totals={totals} />
      </Panel>

      <Panel
        title="Property breakdown"
        description="Each house over the selected period. Open one for the full revenue flow and its rooms — the comparison that matters is between rooms under the same roof, where they differ by hundreds a month."
      >
        <PropertyBreakdown properties={breakdown} months={data.months} />
      </Panel>

      {/*
        Lost rent, folded away.
 
        It used to lead with a red "Outstanding" tile and two full panels, which
        put a number nobody can act on in front of the ones they can. Almost none
        of this is a receivable: most is owed by people who have already moved
        out, and the collection data says money either arrives within thirty days
        or never. So it is breakage — revenue that will not come — and it belongs
        here, closed, as a figure to check monthly rather than daily.
      */}
      <details className="mb-5 rounded-lg border border-line bg-surface px-4 py-3">
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[13px] font-medium">Lost rent</span>
          <span className="num text-[13px] text-muted">{formatCents(data.outstandingTotalCents)}</span>
          <span className="text-[11px] text-muted">
            billed and never collected, all time · {formatCents(data.movedOutOwedCents)} of it from people who have
            already left
          </span>
        </summary>

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] leading-relaxed text-muted">
              Aged by the month the charge was raised. Concessions are money given back and are not in here.
            </p>
            <StackedBar
              segments={data.ageing.map((bucket, i) => ({ label: bucket.label, value: bucket.amountCents, color: RAMP[i] }))}
            />
            <table className="mt-3">
              <tbody>
                {data.ageing.map((bucket, i) => (
                  <tr key={bucket.label}>
                    <Td>
                      <span className="mr-2 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: RAMP[i] }} />
                      {bucket.label}
                    </Td>
                    <Td right>
                      <Money cents={bucket.amountCents} />
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

            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Only <Money cents={data.currentOwedCents} /> of it is owed by someone still in a room; the rest is a
              write-off in all but name.
              {data.daysToCollect ? (
                <>
                  {' '}When rent does arrive it arrives fast — a median of {data.daysToCollect.median} days after the
                  charge, {data.daysToCollect.p90} at the ninetieth percentile. Past thirty days it is not slow, it is
                  gone.
                </>
              ) : null}
            </p>
          </div>

          <div>
            <p className="mb-2 text-[11px] leading-relaxed text-muted">Who it is owed by, largest first.</p>
            {data.memberBalances.length === 0 ? (
              <Empty>Nothing written off.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <Th>Member</Th>
                    <Th>Property</Th>
                    <Th right>Lost rent</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.memberBalances.map((member) => (
                    <tr key={member.memberId}>
                      <Td>
                        {member.memberName}
                        {member.roomNumber ? <span className="ml-1.5 text-[11px] text-muted">room {member.roomNumber}</span> : null}
                        {member.movedOut ? <Badge tone="muted">moved out</Badge> : null}
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
          </div>
        </div>
      </details>

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
