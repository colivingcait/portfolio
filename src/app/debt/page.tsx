import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getMaturityLadder, getSelectOptions, todayIso } from '@/lib/queries';
import { Badge, Empty, Explainer, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { AddPanel } from '@/components/AddPanel';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { withOptions } from '@/lib/form-helpers';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

function maturityTone(days: number) {
  if (days < 0) return 'bad' as const;
  if (days <= 90) return 'bad' as const;
  if (days <= 365) return 'warn' as const;
  return 'muted' as const;
}

export default async function DebtPage() {
  const asOf = todayIso();
  const [data, loans, options] = await Promise.all([
    getMaturityLadder(asOf),
    prisma.loan.findMany({ include: { property: true }, orderBy: { maturityDate: 'asc' } }),
    getSelectOptions(),
  ]);

  // The ladder covers active notes. A settled one still belongs on the screen
  // that owns loans, or retiring it would look like losing it.
  const settled = loans.filter((loan) => loan.status !== 'active');
  const rateOf = new Map(loans.map((loan) => [loan.id, Number(loan.ratePercent)]));

  // The caveat is per note, not per portfolio: a single guaranteed note can
  // dwarf your share of it even when the totals happen to look reassuring.
  const overGuaranteed = data.ladder.filter((e) => e.guaranteedExposureCents > e.proRataBalanceCents);
  const overGuaranteedBy = overGuaranteed.reduce(
    (total, e) => total + e.guaranteedExposureCents - e.proRataBalanceCents,
    0,
  );

  return (
    <>
      <PageHeader
        title="Debt"
        subtitle="Every note against every property, sorted by maturity. Private notes mature; that is the risk that actually bites, and nothing off the shelf will show it to you."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Monthly debt service" value={formatCents(data.monthlyDebtServiceCents)} />
        <Stat label="Balance (property level)" value={formatCents(data.totalBalanceCents)} />
        <Stat
          label="Your pro-rata share"
          value={data.hasViewer ? formatCents(data.totalProRataCents) : '—'}
          hint={data.hasViewer ? 'An economic figure.' : 'No entity is marked as you.'}
        />
        <Stat
          label="Guaranteed exposure"
          value={formatCents(data.totalGuaranteedCents)}
          hint="What a lender can come after, undivided."
          tone={overGuaranteed.length > 0 ? 'bad' : 'muted'}
        />
      </div>

      {overGuaranteed.length > 0 ? (
        <Note>
          On {overGuaranteed.length === 1 ? 'one note' : `${overGuaranteed.length} notes`} your guaranteed exposure
          exceeds your pro-rata share — by {formatCents(overGuaranteedBy)} in total. A pro-rata debt share is an
          economic figure, not a legal one: where you personally guarantee a note you are liable for the whole balance
          regardless of the interest you hold, and only one of those two numbers is what a lender will come after.
        </Note>
      ) : null}

      <Explainer title="What this is and why it matters">
        Every note against every property, sorted by maturity. This is the part that works on day one: it needs no
        import, no statement and no outside account — it is arithmetic, and it is what no off-the-shelf tool does
        properly for private notes.
        <div className="mt-1.5">
          What it buys you: a bank line showing one undivided payment gets split into interest, principal and escrow by
          the schedule, so only the deductible half reaches a tax return and the balance sheet moves correctly every
          month. Private notes mature, which is the risk that actually bites, and the ladder is the only place it is
          visible. And <strong>escrow disbursements</strong> — the tax and insurance bills the servicer pays out — are
          the only way those two reach Schedule E at all, since they never appear as a bank line of their own.
        </div>
      </Explainer>

      <Panel title="Maturity ladder">
        {data.ladder.length === 0 ? (
          <Empty>
            No active loans yet. Add one below — this screen needs no import, no statement and no external account.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th>Lender</Th>
                  <Th>Structure</Th>
                  <Th right>Rate</Th>
                  <Th>Maturity</Th>
                  <Th right>Days</Th>
                  <Th right>Balance</Th>
                  <Th right>Balloon</Th>
                  <Th right>Pro-rata</Th>
                  <Th right>Guaranteed</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.ladder.map((entry) => (
                  <tr key={entry.loan.id} className="hover:bg-surface-2/50">
                    <Td>{entry.loan.propertyName}</Td>
                    <Td>
                      {entry.loan.lender}
                      <span className="ml-1.5 text-[11px] text-muted">{entry.loan.type}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">{entry.loan.structure.replace(/_/g, ' ')}</span>
                    </Td>
                    <Td right>
                      <span className="num">{rateOf.get(entry.loan.id)?.toFixed(2) ?? '—'}%</span>
                    </Td>
                    <Td>
                      <span className="num">{entry.maturityDate}</span>
                    </Td>
                    <Td right>
                      <Badge tone={maturityTone(entry.daysRemaining)}>{entry.daysRemaining}</Badge>
                    </Td>
                    <Td right>
                      <Money cents={entry.balanceCents} />
                    </Td>
                    <Td right>
                      {entry.balloonCents > 0 ? <Money cents={entry.balloonCents} /> : <span className="num text-muted">—</span>}
                    </Td>
                    <Td right>
                      <Money cents={entry.proRataBalanceCents} muted />
                    </Td>
                    <Td right>
                      {entry.guaranteedExposureCents > 0 ? (
                        <span className="num text-bad">{formatCents(entry.guaranteedExposureCents)}</span>
                      ) : (
                        <span className="num text-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Link href={`/debt/${entry.loan.id}`} className="text-[12px] text-muted hover:text-accent">
                          Schedule
                        </Link>
                        <Link href={`/debt/${entry.loan.id}/edit`} className="text-[12px] text-muted hover:text-accent">
                          Edit
                        </Link>
                        <DeleteButton modelKey="loan" id={entry.loan.id} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AddPanel
        label="Add a loan"
        description="Set “personally guaranteed” where it applies. A pro-rata debt share is an economic figure, not a legal one — the ladder shows guaranteed exposure at the full balance alongside your share, and those two numbers can differ enormously."
      >
        <RecordForm modelKey="loan" fields={withOptions('loan', { propertyId: options.properties })} />
      </AddPanel>

      {loans.length > 0 ? (
        <AddPanel
          label="Record a payment"
          description="Only for a payment that differs from the schedule — an extra principal payment, a late one, a different amount. Payments that land as scheduled need no entry, and the ones due this month can be marked paid on Payouts."
        >
          <RecordForm modelKey="loanPayment" fields={withOptions('loanPayment', { loanId: options.loans })} />
        </AddPanel>
      ) : null}

      {settled.length > 0 ? (
        <Panel title={`${settled.length} settled`} description="Paid off or refinanced. Kept for history; not in any total above.">
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Lender</Th>
                <Th>Status</Th>
                <Th right>Original</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {settled.map((loan) => (
                <tr key={loan.id}>
                  <Td>{loan.property.name}</Td>
                  <Td>{loan.lender}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{loan.status}</span>
                  </Td>
                  <Td right>
                    <Money cents={loan.originalPrincipalCents} muted />
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Link href={`/debt/${loan.id}`} className="text-[12px] text-muted hover:text-accent">
                        Schedule
                      </Link>
                      <Link href={`/debt/${loan.id}/edit`} className="text-[12px] text-muted hover:text-accent">
                        Edit
                      </Link>
                      <DeleteButton modelKey="loan" id={loan.id} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'muted',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'muted' | 'bad';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1 text-left text-[18px] ${tone === 'bad' ? 'text-bad' : ''}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
