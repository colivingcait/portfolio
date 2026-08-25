import Link from 'next/link';
import { getOperations } from '@/lib/padsplit-queries';
import { PortfolioTabs } from '@/components/PortfolioTabs';
import { Badge, Empty, Explainer, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { formatCents } from '@/lib/engine/money';
import { RAMP, StackedBar, seriesColor } from '@/components/charts';
import { PortfolioChart } from '@/components/PortfolioChart';
import { PropertyBreakdown, type BreakdownProperty } from '@/components/PropertyBreakdown';
import { METRICS } from '@/lib/engine/metrics-catalog';

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
  const roomsLetTotal = sum((r) => r.roomsLet);
  const roomsTotal = sum((r) => r.roomsTotal);
  // Occupancy is room-days let against room-days available — never an average
  // of the houses' rates, and never a count of rooms.
  const roomDaysAvailable = sum((r) => r.roomDaysAvailable);
  const occupancy = roomDaysAvailable > 0 ? (sum((r) => r.roomDaysLet) / roomDaysAvailable) * 100 : null;
  const turnoverTotal = sum((r) => r.turnovers);
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
        <div className="mt-1.5">
          <strong>Occupancy and turnover are read off what was billed, never off what was paid.</strong> PadSplit
          raises dues weekly in advance, so each charge is spread across the seven days it pays for and occupancy is
          room-days let against room-days available — a room let for nine days of a month counts as nine days, and a
          week raised on 30 July is credited to August rather than to July. The most recent month is measured only to
          the last day the export has billed, because days nobody has been charged for yet are not vacant days. A
          turnover is a tenancy ending, found where the next week&apos;s charge was due before the export was taken and
          never came; that catches a resident who left with nobody lined up, which counting people per room could not.
          Whether anyone then paid is the collection rate&apos;s job, and is deliberately a separate number.
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
              : 'Tenancies that ended this month.'
          }
          tone={turnoverTotal > houseNames.length * 2 ? 'bad' : 'muted'}
        />
        <Stat
          label="Outstanding"
          value={formatCents(data.outstandingTotalCents)}
          hint="Charged and never collected, all months."
          tone={data.outstandingTotalCents > 0 ? 'bad' : 'muted'}
        />
      </div>

      <Panel
        title="Portfolio over time"
        description={`One chart, pointed wherever you need it. Pick a measure and a span; click a house in the legend to drop it out of the comparison. ${METRICS.length} measures across ${data.months.length} months.`}
      >
        <PortfolioChart months={data.months} houses={houses} values={values} totals={totals} />
      </Panel>

      <Panel
        title={`Property breakdown · ${data.month}`}
        description="Each house for the selected month. Open one for the full revenue flow and its rooms — the comparison that matters is between rooms under the same roof, where they differ by hundreds a month."
      >
        <PropertyBreakdown properties={breakdown} months={data.months} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="What is still owed"
          description="Charges raised and never collected, aged by the month they were raised. Concessions are money given back and are not in here."
        >
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
            <Money cents={data.movedOutOwedCents} /> of that is owed by people who have already left — money that
            almost never arrives, and is better read as a write-off than a receivable. Only{' '}
            <Money cents={data.currentOwedCents} /> is owed by someone still in a room.
            {data.daysToCollect ? (
              <>
                {' '}When cash does come it comes fast: a median of {data.daysToCollect.median} days after the charge,
                {' '}{data.daysToCollect.p90} at the ninetieth percentile. Past thirty days it is stuck, not slow.
              </>
            ) : null}
          </p>
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
        </Panel>
      </div>

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
