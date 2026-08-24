import Link from 'next/link';
import { getPortfolio, currentMonth } from '@/lib/queries';
import { prisma } from '@/lib/db';
import { Badge, Empty, Money, Note, PageHeader, Panel, Pct, Td, Th } from '@/components/ui';
import { VIEW_LABELS, type ViewKind } from '@/lib/engine/rollup';
import { addMonthsToMonth } from '@/lib/engine/dates';

export const dynamic = 'force-dynamic';

const VIEWS: ViewKind[] = ['portfolio', 'my_share', 'entity'];

function statusTone(status: string) {
  switch (status) {
    case 'stabilized':
      return 'good' as const;
    case 'ramping':
      return 'accent' as const;
    case 'divesting':
    case 'sold':
      return 'warn' as const;
    default:
      return 'muted' as const;
  }
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; entity?: string }>;
}) {
  const params = await searchParams;
  const month = params.month ?? currentMonth();
  const view = (VIEWS.includes(params.view as ViewKind) ? params.view : 'portfolio') as ViewKind;
  const entityId = params.entity ?? null;

  const [data, entities] = await Promise.all([
    getPortfolio(month, view, entityId),
    prisma.entity.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const link = (next: Record<string, string | null>) => {
    const query = new URLSearchParams({ month, view, ...(entityId ? { entity: entityId } : {}) });
    for (const [key, value] of Object.entries(next)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    return `/?${query.toString()}`;
  };

  const totals = data.rows.reduce(
    (acc, row) => {
      const scale = row.sharePercent / 100;
      acc.debtBalance += Math.round((row.debt?.balanceCents ?? 0) * scale);
      acc.debtService += Math.round((row.debt?.monthlyDebtServiceCents ?? 0) * scale);
      acc.guaranteed += row.debt?.guaranteedCents ?? 0;
      acc.rooms += row.roomCount ?? 0;
      acc.units += row.unitCount ?? 0;
      return acc;
    },
    { debtBalance: 0, debtService: 0, guaranteed: 0, rooms: 0, units: 0 },
  );

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle={VIEW_LABELS[view].description}
        actions={
          <div className="flex items-center gap-1">
            <Link href={link({ month: addMonthsToMonth(month, -1) })} className="rounded border border-line px-2 py-1 text-[12px] text-muted hover:text-text">
              ←
            </Link>
            <span className="num px-2 text-[13px]">{month}</span>
            <Link href={link({ month: addMonthsToMonth(month, 1) })} className="rounded border border-line px-2 py-1 text-[12px] text-muted hover:text-text">
              →
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        {VIEWS.map((kind) => (
          <Link
            key={kind}
            href={link({ view: kind })}
            className={`rounded-md px-2.5 py-1 ${view === kind ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
          >
            {VIEW_LABELS[kind].label}
          </Link>
        ))}
        <span className="mx-2 text-line">|</span>
        <Link href={link({ entity: null })} className={`rounded-md px-2.5 py-1 ${!entityId ? 'bg-surface-2' : 'text-muted hover:text-text'}`}>
          All entities
        </Link>
        {entities.map((entity) => (
          <Link
            key={entity.id}
            href={link({ entity: entity.id })}
            className={`rounded-md px-2.5 py-1 ${entityId === entity.id ? 'bg-surface-2' : 'text-muted hover:text-text'}`}
          >
            {entity.name}
          </Link>
        ))}
      </div>

      {view === 'my_share' && !data.ownership.viewerId ? (
        <Note tone="bad">
          No entity is marked as you, so there is nothing to compute a share from. Set “This is me” on your own
          entity in <Link href="/settings/entities" className="underline">Settings → Entities</Link>.
        </Note>
      ) : null}

      {data.unverifiedCount > 0 ? (
        <Note>
          {data.unverifiedCount} of {data.rows.length} properties are not marked verified. The property table in the
          build spec was carried from an earlier document — confirm the address, room count and status before treating
          any of it as fact.
        </Note>
      ) : null}

      {data.crossesEntities ? (
        <Note tone="muted">These totals cross entities: {[...new Set(data.rows.map((r) => r.entityName))].join(', ')}.</Note>
      ) : null}

      {view === 'my_share' ? (
        <Note tone="muted">
          Money on these rows is multiplied by your effective share. Occupancy, collection rate and delinquency are
          not — they describe how a property is performing, not how it is split, so they stay at property level.
        </Note>
      ) : null}

      <Panel>
        {data.rows.length === 0 ? (
          <Empty>
            No properties yet. Add entities first, then properties, in{' '}
            <Link href="/settings/entities" className="underline">Settings</Link>.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th>Entity</Th>
                  <Th>Revenue</Th>
                  <Th>Management</Th>
                  <Th right>Share</Th>
                  <Th right>Occupancy</Th>
                  <Th right>Collection</Th>
                  <Th right>Revenue</Th>
                  <Th right>Owner opex</Th>
                  <Th right>Debt service</Th>
                  <Th right>Debt balance</Th>
                  <Th right>Net cash</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const scale = row.sharePercent / 100;
                  return (
                    <tr key={row.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Link href={`/properties/${row.id}?month=${month}`} className="hover:text-accent">
                          {row.name}
                        </Link>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                          {row.unitStructure === 'rooms' ? (
                            <span className="text-[11px] text-muted">{row.roomCount ?? '?'} rooms</span>
                          ) : (
                            <span className="text-[11px] text-muted">{row.unitCount ?? '?'} units</span>
                          )}
                          {!row.dataVerified ? <Badge tone="warn">unverified</Badge> : null}
                        </div>
                      </Td>
                      <Td>
                        <span className="text-[12px] text-muted">{row.entityName}</span>
                      </Td>
                      <Td>
                        <span className="text-[12px]">{row.revenueSource === 'padsplit' ? 'PadSplit' : 'Direct'}</span>
                      </Td>
                      <Td>
                        {row.managementMode ? (
                          <span className="text-[12px]">
                            {row.managementMode === 'pm' ? (
                              <>
                                PM
                                {row.feePercent !== null ? (
                                  <span className="text-muted"> · {row.feePercent}%</span>
                                ) : null}
                              </>
                            ) : (
                              'Self'
                            )}
                            {row.transitionMonth ? <Badge tone="warn">transition</Badge> : null}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted">no period</span>
                        )}
                      </Td>
                      <Td right>{row.sharePercent === 100 ? <span className="text-muted">100%</span> : <Pct value={row.sharePercent} />}</Td>
                      <Td right>
                        <Pct value={row.rollup?.occupancyRate ?? null} />
                      </Td>
                      <Td right>
                        <Pct value={row.rollup?.collectionRate ?? null} />
                      </Td>
                      <Td right>
                        <Money cents={row.rollup ? Math.round(row.rollup.revenueCents * scale) : null} />
                      </Td>
                      <Td right>
                        <Money cents={row.rollup ? Math.round(row.rollup.ownerPaidOpexCents * scale) : null} />
                      </Td>
                      <Td right>
                        <Money cents={row.debt ? Math.round(row.debt.monthlyDebtServiceCents * scale) : null} />
                      </Td>
                      <Td right>
                        <Money cents={row.debt ? Math.round(row.debt.balanceCents * scale) : null} />
                      </Td>
                      <Td right>
                        <Money cents={row.rollup ? Math.round(row.rollup.netCashCents * scale) : null} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <Td>
                    Total
                    <div className="mt-0.5 text-[11px] text-muted">
                      {totals.rooms > 0 ? `${totals.rooms} rooms` : null}
                      {totals.rooms > 0 && totals.units > 0 ? ' · ' : null}
                      {totals.units > 0 ? `${totals.units} units` : null}
                    </div>
                  </Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td right>
                    <Money cents={totals.debtService} />
                  </Td>
                  <Td right>
                    <Money cents={totals.debtBalance} />
                  </Td>
                  <Td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      {!data.hasAnyRollup && data.rows.length > 0 ? (
        <Note tone="muted">
          Occupancy, collection, revenue and net cash are blank because no statements or PadSplit exports have been
          imported yet — those are build steps 2 through 4. Everything derived from the loan terms and the ownership
          graph is live now.
        </Note>
      ) : null}
    </>
  );
}
