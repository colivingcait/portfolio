import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions, todayIso } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Badge, Empty, Explainer, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { fieldsFor } from '../_shared/helpers';
import { SOURCE_CONFIDENCE, valuationAge, type ValuationSource } from '@/lib/engine/equity';
import { requireIsoDate } from '@/lib/mappers';

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

export default async function ValuationsPage() {
  const asOf = todayIso();
  const [valuations, options, properties] = await Promise.all([
    prisma.valuation.findMany({ include: { property: true }, orderBy: [{ date: 'desc' }] }),
    getSelectOptions(),
    prisma.property.findMany({ include: { valuations: true } }),
  ]);

  const withoutValue = properties.filter((p) => p.valuations.length === 0);

  return (
    <>
      <PageHeader
        title="Valuations"
        subtitle="What each property is worth, and where that number came from. Estimates are dated rather than overwritten, so the history is kept and a value can be read as of any month."
      />


      <Explainer title="Why this matters">
        Estimates are dated rather than overwritten, so the history stays intact and any month can be read as of
        that month. Overwriting would make last year&apos;s equity silently restate itself.
        <div className="mt-1.5">
          A property with no valuation is carried at cost on the balance sheet, and at zero if there is no cost either —
          which understates everything. Cap rate needs a value too; without one it cannot be computed at all.
        </div>
      </Explainer>
      {withoutValue.length > 0 ? (
        <Note>
          No estimate yet for {withoutValue.map((p) => p.name).join(', ')}. Their debt still counts against portfolio
          equity, so the totals understate leverage until a value is entered.
        </Note>
      ) : null}

      <Panel title="Add an estimate">
        <RecordForm modelKey="valuation" fields={fieldsFor('valuation', options)} />
      </Panel>

      <Panel title={`${valuations.length} estimates`}>
        {valuations.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>As of</Th>
                <Th right>Value</Th>
                <Th>Source</Th>
                <Th>Age</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {valuations.map((valuation) => {
                const age = valuationAge(
                  { id: valuation.id, propertyId: valuation.propertyId, date: requireIsoDate(valuation.date), valueCents: valuation.valueCents, source: valuation.source as ValuationSource },
                  asOf,
                );
                const confidence = SOURCE_CONFIDENCE[valuation.source as ValuationSource];
                return (
                  <tr key={valuation.id}>
                    <Td>{valuation.property.name}</Td>
                    <Td>
                      <span className="num">{requireIsoDate(valuation.date)}</span>
                    </Td>
                    <Td right>
                      <Money cents={valuation.valueCents} />
                    </Td>
                    <Td>
                      <span className="text-[12px]">{SOURCE_LABELS[valuation.source] ?? valuation.source}</span>
                      {confidence === 'low' ? <Badge tone="warn">soft</Badge> : null}
                    </Td>
                    <Td>
                      {age?.stale ? (
                        <Badge tone="warn">{Math.round(age.days / 30)} months old</Badge>
                      ) : (
                        <span className="text-[12px] text-muted">{age ? `${age.days} days` : '—'}</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Link href={`/settings/valuations/${valuation.id}`} className="text-[12px] text-muted hover:text-accent">
                          Edit
                        </Link>
                        <DeleteButton modelKey="valuation" id={valuation.id} />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
