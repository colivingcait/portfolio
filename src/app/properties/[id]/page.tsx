import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPropertyDetail, getSelectOptions, currentMonth, todayIso } from '@/lib/queries';
import { Badge, Empty, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { RecordSection } from '@/components/RecordSection';
import { RecordForm } from '@/components/RecordForm';
import { RowActions } from '@/components/RowActions';
import { fieldsFor } from '@/lib/form-helpers';
import { SOURCE_LABELS, valuationAge, type ValuationSource } from '@/lib/engine/equity';
import { requireIsoDate } from '@/lib/mappers';
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

  const [detail, options] = await Promise.all([getPropertyDetail(id, month), getSelectOptions()]);
  if (!detail) notFound();

  const { property, ownership, interests, periods, loans, asOf } = detail;
  const management = managementForMonth(periods, property.id, month);
  const trailingTwelve = monthRange(addMonthsToMonth(month, -11), month);
  const boundaries = managementBoundaries(periods, property.id, trailingTwelve);
  const warning = comparabilityWarning(periods, property.id, trailingTwelve);

  const share = ownership.viewerId
    ? effectiveShare(ownership.interests, ownership.viewerId, property.id, asOf)
    : null;

  // Everything about this house is edited here. Spotting a wrong management
  // period and then having to work out which of four other screens owns it was
  // the single worst thing about the old shape.
  // Everything for this house is entered here with the house already decided,
  // so a select can neither ask nor be answered wrongly. Narrowing the option
  // lists to this property also stops a lease picking another house's unit.
  const back = `/properties/${id}`;
  const scoped = {
    ...options,
    properties: options.properties.filter((option) => option.value === id),
    units: property.units.map((unit) => ({ value: unit.id, label: unit.label })),
  };
  const lockToProperty = { propertyId: id };

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
          <div className="flex items-center gap-3 text-[13px]">
            <Link href={`/edit/property/${id}?back=${encodeURIComponent(back)}`} className="text-muted hover:text-text">
              Edit property
            </Link>
            <Link href="/properties" className="text-muted hover:text-text">
              ← Properties
            </Link>
          </div>
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

      <RecordSection
        title="Ownership"
        description={share && share.paths.length > 1 ? 'Held through more than one path; the effective share is the sum of the products along each.' : 'Who owns this house. Distribution percent is recorded separately where this month\u2019s cash splits differently from the equity.'}
        addLabel="+ Add an owner"
        form={
          <RecordForm
            modelKey="ownershipInterest"
            fields={fieldsFor('ownershipInterest', scoped)}
            lock={{ ...lockToProperty, ownedType: 'property' }}
          />
        }
      >
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
                <Th />
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
                  <Td>
                    <RowActions modelKey="ownershipInterest" id={interest.id} back={back} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RecordSection>

      <RecordSection
        title="Management history"
        description={
          boundaries.length > 0
            ? `${boundaries.length} boundary crossed in the trailing twelve months. A month is priced with whatever was true then, so the dates decide which months carry a PM fee.`
            : 'A dated record, not a setting. A month is priced with whatever was true then, so historical self-managed months carry no fee and no special case is needed anywhere.'
        }
        addLabel="+ Add a period"
        form={<RecordForm modelKey="managementPeriod" fields={fieldsFor('managementPeriod', scoped)} lock={lockToProperty} />}
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
                <Th />
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
                  <Td>
                    <RowActions modelKey="managementPeriod" id={period.id} back={back} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RecordSection>

      <RecordSection
        title="Loans"
        description="Every note against this house. The ladder on Debt is the same records across the whole portfolio, sorted by maturity."
        addLabel="+ Add a loan"
        form={<RecordForm modelKey="loan" fields={fieldsFor('loan', scoped)} lock={lockToProperty} />}
      >
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
                    <div className="flex items-center gap-3">
                      <Link href={`/debt/${loan.id}`} className="text-[12px] text-muted hover:text-accent">
                        Schedule
                      </Link>
                      <RowActions modelKey="loan" id={loan.id} back={back} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RecordSection>

      {property.unitStructure === 'units' ? (
        <RecordSection
          title="Leases"
          description="A direct property has no PadSplit export, so without a lease there is no way to know what should have come in — only what did. Deposit held is a tenant\u2019s money and shows as a liability, never income."
          addLabel="+ Add a lease"
          form={<RecordForm modelKey="lease" fields={fieldsFor('lease', scoped)} lock={lockToProperty} />}
        >
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
                  <Th />
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
                    <Td>
                      <RowActions modelKey="lease" id={lease.id} back={back} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </RecordSection>
      ) : null}

      <RecordSection
        title="Valuations"
        description="Estimates are dated rather than overwritten, so history stays intact and any month can be read as of that month. Without one this house is carried at cost on the balance sheet, and cap rate cannot be computed at all."
        addLabel="+ Add an estimate"
        form={<RecordForm modelKey="valuation" fields={fieldsFor('valuation', scoped)} lock={lockToProperty} />}
      >
        {property.valuations.length === 0 ? (
          <Empty>No estimate on record. This house is carried at cost, and at zero if there is no purchase price either.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>As of</Th>
                <Th right>Value</Th>
                <Th>Source</Th>
                <Th right>Age</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {property.valuations.map((valuation) => {
                const age = valuationAge(
                  { id: valuation.id, propertyId: id, date: requireIsoDate(valuation.date), valueCents: valuation.valueCents, source: valuation.source as ValuationSource },
                  asOf,
                );
                return (
                  <tr key={valuation.id}>
                    <Td>
                      <span className="num">{requireIsoDate(valuation.date)}</span>
                    </Td>
                    <Td right>
                      <Money cents={valuation.valueCents} />
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">
                        {SOURCE_LABELS[valuation.source as ValuationSource] ?? valuation.source}
                      </span>
                    </Td>
                    <Td right>
                      {age?.stale ? (
                        <Badge tone="warn">{age.days}d</Badge>
                      ) : (
                        <span className="num text-muted">{age?.days ?? 0}d</span>
                      )}
                    </Td>
                    <Td>
                      <RowActions modelKey="valuation" id={valuation.id} back={back} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </RecordSection>

      <RecordSection
        title="Bank accounts"
        description="One account per property is what makes an import need no typing: the file is the property. The last four digits are what route an uploaded statement here."
        addLabel="+ Add an account"
        form={<RecordForm modelKey="bankAccount" fields={fieldsFor('bankAccount', scoped)} lock={lockToProperty} />}
      >
        {property.bankAccounts.length === 0 ? (
          <Empty>
            No account, so no statement can be imported for this house — and it shows as a zero balance on the{' '}
            <Link href="/books/balance-sheet" className="underline">balance sheet</Link> rather than as a gap.
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Label</Th>
                <Th>Institution</Th>
                <Th>Last 4</Th>
                <Th>Active</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {property.bankAccounts.map((account) => (
                <tr key={account.id}>
                  <Td>{account.label}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{account.institution ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="num">{account.last4 ?? '—'}</span>
                  </Td>
                  <Td>{account.active ? <Badge tone="good">active</Badge> : <Badge>closed</Badge>}</Td>
                  <Td>
                    <RowActions modelKey="bankAccount" id={account.id} back={back} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RecordSection>

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
