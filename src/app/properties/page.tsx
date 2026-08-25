import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions, todayIso } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { AddPanel } from '@/components/AddPanel';
import { RowActions } from '@/components/RowActions';
import { PortfolioTabs } from '@/components/PortfolioTabs';
import { Badge, Empty, Explainer, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '@/lib/form-helpers';
import { valuationAge, type ValuationSource } from '@/lib/engine/equity';
import { requireIsoDate } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function PropertiesPage() {
  const asOf = todayIso();
  const [properties, options] = await Promise.all([
    prisma.property.findMany({
      include: {
        titleEntity: true,
        bankAccounts: { where: { active: true }, select: { id: true } },
        managementPeriods: { orderBy: { startDate: 'desc' } },
        valuations: { orderBy: { date: 'desc' }, take: 1 },
      },
      orderBy: { name: 'asc' },
    }),
    getSelectOptions(),
  ]);

  const unverified = properties.filter((p) => !p.dataVerified).length;

  // The gaps that only show up across the whole portfolio. Each of these used
  // to be flagged on its own settings screen; with entry moved onto each
  // property, this list is the only place left that can say which houses are
  // missing what — so it has to, or the information is simply lost.
  const rows = properties.map((property) => {
    const current = property.managementPeriods.find(
      (period) => requireIsoDate(period.startDate) <= asOf && (!period.endDate || requireIsoDate(period.endDate) >= asOf),
    );
    const latest = property.valuations[0];
    return {
      property,
      management: current ? (current.mode === 'pm' ? (current.managerName ?? 'PM') : 'Self') : null,
      valuation: latest
        ? {
            date: requireIsoDate(latest.date),
            age: valuationAge(
              { id: latest.id, propertyId: property.id, date: requireIsoDate(latest.date), valueCents: latest.valueCents, source: latest.source as ValuationSource },
              asOf,
            ),
          }
        : null,
      hasAccount: property.bankAccounts.length > 0,
    };
  });

  const noManagement = rows.filter((row) => row.management === null);
  const noValuation = rows.filter((row) => row.valuation === null);
  const noAccount = rows.filter((row) => !row.hasAccount);

  return (
    <>
      <PageHeader title="Properties" subtitle="Every house, and what each one is still missing." />
      <PortfolioTabs />

      <Explainer title="What this is and why it matters">
        Four things on a property change how every number for it is computed: where revenue comes from, whether it is
        rented by the room or the unit, who manages it, and which entity holds title. They are not labels — the engine
        branches on them.
        <div className="mt-1.5">
          <strong>Purchase price</strong> and <strong>cash invested</strong> are two different figures and both matter.
          Purchase price is the starting point for basis and what a balance sheet carries at cost. Cash invested is the
          money that actually left your pocket — deposit, closing costs, rehab — and it is the denominator of
          cash-on-cash. Financing the rest is the whole point, so they should not match.
        </div>
        <div className="mt-1.5">
          Everything else about a house — its owners, loans, management history, leases, accounts and valuations — is
          entered on that property&apos;s own page. The last three columns here are what is still missing.
        </div>
      </Explainer>

      {unverified > 0 ? (
        <Note>
          {unverified} {unverified === 1 ? 'property is' : 'properties are'} unverified. The coliving rows in the build
          spec were carried from an earlier document — addresses, room counts and statuses need confirming.
        </Note>
      ) : null}

      {noManagement.length > 0 ? (
        <Note tone="bad">
          {noManagement.map((r) => r.property.name).join(', ')} {noManagement.length === 1 ? 'has' : 'have'} no
          management period covering today, so no month for {noManagement.length === 1 ? 'it' : 'them'} can be priced —
          the PM fee has nothing to derive from.
        </Note>
      ) : null}

      {noValuation.length > 0 ? (
        <Note>
          {noValuation.map((r) => r.property.name).join(', ')} {noValuation.length === 1 ? 'has' : 'have'} no estimate,
          so {noValuation.length === 1 ? 'it is' : 'they are'} carried at cost on the balance sheet — at zero if there
          is no purchase price either — and cap rate cannot be computed at all.
        </Note>
      ) : null}

      {noAccount.length > 0 ? (
        <Note>
          {noAccount.map((r) => r.property.name).join(', ')} {noAccount.length === 1 ? 'has' : 'have'} no active bank
          account, so no statement can be imported for {noAccount.length === 1 ? 'it' : 'them'}.
        </Note>
      ) : null}

      <Panel title={`${properties.length} properties`}>
        {properties.length === 0 ? (
          <Empty>Nothing yet. Add the first one below.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Entity</Th>
                  <Th>Revenue</Th>
                  <Th>Structure</Th>
                  <Th>Status</Th>
                  <Th>Management</Th>
                  <Th>Valued</Th>
                  <Th>Account</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ property, management, valuation, hasAccount }) => (
                  <tr key={property.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/properties/${property.id}`} className="hover:text-accent">
                        {property.name}
                      </Link>
                      {property.externalId ? (
                        <span className="ml-1.5 text-[11px] text-muted">PSID {property.externalId}</span>
                      ) : null}
                      {!property.dataVerified ? <Badge tone="warn">unverified</Badge> : null}
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">{property.titleEntity.name}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px]">{property.revenueSource === 'padsplit' ? 'PadSplit' : 'Direct'}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">
                        {property.unitStructure === 'rooms'
                          ? `${property.roomCount ?? '?'} rooms`
                          : `${property.unitCount ?? '?'} units`}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">{property.status}</span>
                    </Td>
                    <Td>
                      {management ? (
                        <span className="text-[12px]">{management}</span>
                      ) : (
                        <Badge tone="bad">none</Badge>
                      )}
                    </Td>
                    <Td>
                      {valuation ? (
                        valuation.age?.stale ? (
                          <Badge tone="warn">stale</Badge>
                        ) : (
                          <span className="num text-[12px] text-muted">{valuation.date}</span>
                        )
                      ) : (
                        <Badge tone="warn">none</Badge>
                      )}
                    </Td>
                    <Td>{hasAccount ? <Badge tone="good">yes</Badge> : <Badge tone="warn">none</Badge>}</Td>
                    <Td>
                      <RowActions modelKey="property" id={property.id} back="/properties" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {options.entities.length === 0 ? (
        <Note tone="bad">
          Add an entity first — a property needs an owner of title.{' '}
          <Link href="/owners/entities" className="underline">Owners → Entities</Link>
        </Note>
      ) : (
        <AddPanel label="Add a property">
          <RecordForm modelKey="property" fields={withOptions('property', { titleEntityId: options.entities })} />
        </AddPanel>
      )}
    </>
  );
}
