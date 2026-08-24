import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPropertyDetail, currentMonth } from '@/lib/queries';
import { Badge, Empty, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { effectiveShare } from '@/lib/engine/ownership';
import { comparabilityWarning, managementBoundaries, managementForMonth } from '@/lib/engine/management';
import { addMonthsToMonth, monthRange } from '@/lib/engine/dates';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const { month: monthParam } = await searchParams;
  const month = monthParam ?? currentMonth();

  const detail = await getPropertyDetail(id, month);
  if (!detail) notFound();

  const { property, ownership, interests, periods, loans, asOf } = detail;
  const management = managementForMonth(periods, property.id, month);
  const trailingTwelve = monthRange(addMonthsToMonth(month, -11), month);
  const boundaries = managementBoundaries(periods, property.id, trailingTwelve);
  const warning = comparabilityWarning(periods, property.id, trailingTwelve);

  const share = ownership.viewerId
    ? effectiveShare(ownership.interests, ownership.viewerId, property.id, asOf)
    : null;

  const debtBalance = loans.reduce((t, l) => t + l.balanceCents, 0);
  const debtService = loans.reduce((t, l) => t + l.debtServiceCents, 0);
  const guaranteed = loans.filter((l) => l.guarantor).reduce((t, l) => t + l.balanceCents, 0);

  return (
    <>
      <PageHeader
        title={property.name}
        subtitle={
          <>
            {property.addressLine1 ? `${property.addressLine1}, ${property.city ?? ''} ${property.state ?? ''}` : null}
            {property.addressLine1 ? ' · ' : null}
            {property.titleEntity.name} · {property.revenueSource === 'padsplit' ? 'PadSplit' : 'Direct'} ·{' '}
            {property.unitStructure === 'rooms' ? `${property.roomCount ?? '?'} rooms` : `${property.unitCount ?? '?'} units`}
            {property.externalId ? ` · PSID ${property.externalId}` : null}
          </>
        }
        actions={
          <Link href={`/?month=${month}`} className="text-[13px] text-muted hover:text-text">
            ← Portfolio
          </Link>
        }
      />

      {!property.dataVerified ? (
        <Note>
          This property’s details are not verified. Address, room count and status came from a document that was
          carried forward — confirm them before anything here is treated as fact.
        </Note>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={`Management · ${month}`}
          value={management.effective ? (management.effective.mode === 'pm' ? 'PM-managed' : 'Self-managed') : 'No period'}
          hint={
            management.effective?.mode === 'pm' && management.effective.feePercent
              ? `${management.effective.managerName ?? 'PM'} at ${management.effective.feePercent}% of ${(management.effective.feeBasis ?? 'gross_collected').replace(/_/g, ' ')}`
              : undefined
          }
        />
        <Stat label="Your effective share" value={share ? `${share.percent.toFixed(2)}%` : '—'} />
        <Stat label="Debt balance" value={formatCents(debtBalance)} hint={guaranteed > 0 ? `${formatCents(guaranteed)} personally guaranteed` : undefined} />
        <Stat label={`Debt service · ${month}`} value={formatCents(debtService)} />
      </div>

      {management.transition ? (
        <Note>
          {month} is a transition month — more than one management period touches it. The fee is not prorated: when
          the PM’s statement exists it is the truth for the month.
        </Note>
      ) : null}

      {warning ? <Note tone="muted">{warning}</Note> : null}

      <Panel title="Ownership" description={share && share.paths.length > 1 ? 'Held through more than one path; the effective share is the sum of the products along each.' : undefined}>
        {interests.length === 0 ? (
          <Empty>No interests recorded for this property.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Owner</Th>
                <Th right>Percent</Th>
                <Th right>Distribution</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </thead>
            <tbody>
              {interests.map((interest) => (
                <tr key={interest.id}>
                  <Td>{interest.owner.name}</Td>
                  <Td right>{String(interest.percent)}%</Td>
                  <Td right>
                    <span className="text-muted">
                      {interest.distributionPercent ? `${String(interest.distributionPercent)}%` : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="num">{interest.startDate.toISOString().slice(0, 10)}</span>
                  </Td>
                  <Td>
                    <span className="num text-muted">
                      {interest.endDate ? interest.endDate.toISOString().slice(0, 10) : 'open'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Management history"
        description={boundaries.length > 0 ? `${boundaries.length} boundary crossed in the trailing twelve months.` : undefined}
      >
        {property.managementPeriods.length === 0 ? (
          <Empty>No periods recorded, so no month for this property can be priced yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Mode</Th>
                <Th>Manager</Th>
                <Th right>Fee</Th>
                <Th>From</Th>
                <Th>To</Th>
              </tr>
            </thead>
            <tbody>
              {property.managementPeriods.map((period) => (
                <tr key={period.id}>
                  <Td>
                    <Badge tone={period.mode === 'pm' ? 'accent' : 'muted'}>{period.mode}</Badge>
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">{period.managerName ?? '—'}</span>
                  </Td>
                  <Td right>{period.feePercent ? `${String(period.feePercent)}%` : '—'}</Td>
                  <Td>
                    <span className="num">{period.startDate.toISOString().slice(0, 10)}</span>
                  </Td>
                  <Td>
                    <span className="num text-muted">
                      {period.endDate ? period.endDate.toISOString().slice(0, 10) : 'open'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Loans">
        {loans.length === 0 ? (
          <Empty>No loans recorded.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Lender</Th>
                <Th>Structure</Th>
                <Th right>Balance</Th>
                <Th right>Debt service</Th>
                <Th>Maturity</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr key={loan.id}>
                  <Td>
                    {loan.lender}
                    {loan.guarantor ? <Badge tone="bad">guaranteed</Badge> : null}
                  </Td>
                  <Td>
                    <span className="text-[12px] text-muted">{loan.structure.replace(/_/g, ' ')}</span>
                  </Td>
                  <Td right>
                    <Money cents={loan.balanceCents} />
                  </Td>
                  <Td right>
                    <Money cents={loan.debtServiceCents} />
                  </Td>
                  <Td>
                    <span className="num">{loan.maturityDate}</span>
                  </Td>
                  <Td>
                    <Link href={`/debt/${loan.id}`} className="text-[12px] text-muted hover:text-accent">
                      Schedule
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {property.unitStructure === 'units' ? (
        <Panel title="Leases">
          {property.leases.length === 0 ? (
            <Empty>No leases recorded. Without one, expected-versus-received is not computable for a direct property.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <Th>Tenant</Th>
                  <Th right>Rent</Th>
                  <Th right>Deposit held</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                </tr>
              </thead>
              <tbody>
                {property.leases.map((lease) => (
                  <tr key={lease.id}>
                    <Td>{lease.tenantName}</Td>
                    <Td right>
                      <Money cents={lease.rentCents} />
                    </Td>
                    <Td right>
                      <Money cents={lease.depositHeldCents} muted />
                    </Td>
                    <Td>
                      <span className="num">{lease.startDate.toISOString().slice(0, 10)}</span>
                    </Td>
                    <Td>
                      <span className="num text-muted">
                        {lease.endDate ? lease.endDate.toISOString().slice(0, 10) : 'open'}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      <Note tone="muted">
        The twelve-month trend, room- or unit-level revenue and the occupancy and collection figures arrive with the
        statement and PadSplit importers (build steps 2 and 4). Management boundaries will be marked on every trend
        that crosses one.
      </Note>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-[16px]">{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
