import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getMaturityLadder, getSelectOptions, todayIso, currentMonth } from '@/lib/queries';
import { getDebtObligations } from '@/lib/debt-queries';
import { DebtFilters } from '@/components/DebtFilters';
import { DEBT_KINDS, DEBT_VIEWS, viewedCents, type DebtKind, type DebtView } from '@/lib/engine/payouts';
import { Badge, Empty, Explainer, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { AddPanel } from '@/components/AddPanel';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { withOptions } from '@/lib/form-helpers';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

/**
 * Colour on the days rather than a badge beside the date.
 *
 * A badge crammed next to a date made the cell the widest thing in the row and
 * the hardest to read. The urgency belongs to the countdown, so that is what
 * carries it.
 */
function maturityText(days: number) {
  if (days <= 90) return 'text-bad';
  if (days <= 365) return 'text-warn';
  return 'text-muted';
}

export default async function DebtPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; view?: string }>;
}) {
  const params = await searchParams;
  const asOf = todayIso();
  const month = currentMonth();
  const kind = (DEBT_KINDS.some((k) => k.key === params.kind) ? params.kind : 'pml') as DebtKind;
  // Whole by default: the company owes what it owes, undivided.
  const view = (DEBT_VIEWS.some((v) => v.key === params.view) ? params.view : 'whole') as DebtView;

  const [data, loans, options, obligations] = await Promise.all([
    getMaturityLadder(asOf),
    prisma.loan.findMany({ include: { property: true }, orderBy: { maturityDate: 'asc' } }),
    getSelectOptions(),
    // A fixed window: no column depends on a span any more, and the interest
    // figures come from the ledger regardless of it.
    getDebtObligations(month, 'year', kind),
  ]);

  const kindLabel = DEBT_KINDS.find((k) => k.key === kind)!.label.toLowerCase();
  const scale = (cents: number, row: (typeof obligations)[number]) => viewedCents(cents, view, row);
  const total = (pick: (row: (typeof obligations)[number]) => number) =>
    obligations.reduce((sum, row) => sum + scale(pick(row), row), 0);
  const guaranteedShown = view === 'prorata' && obligations.some((row) => row.guaranteed);

  // The ladder covers active notes. A settled one still belongs on the screen
  // that owns loans, or retiring it would look like losing it.
  const settled = loans.filter((loan) => loan.status !== 'active');

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
        <Stat label="Monthly debt service" value={formatCents(total((r) => r.periodPaymentCents))} hint={`Across the ${obligations.length} ${kindLabel} shown.`} />
        <Stat label="Borrowed" value={formatCents(total((r) => r.borrowedCents))} hint="Original principal." />
        <Stat
          label="Remaining interest"
          value={formatCents(total((r) => r.stillOwedToMaturityCents))}
          hint="Still to pay between now and maturity."
        />
        <Stat
          label="Guaranteed exposure"
          value={formatCents(data.totalGuaranteedCents)}
          hint="What a lender can come after, undivided."
          tone={overGuaranteed.length > 0 ? 'bad' : 'muted'}
        />
      </div>

      {overGuaranteed.length > 0 && view === 'prorata' ? (
        <Note>
          On {overGuaranteed.length === 1 ? 'one note' : `${overGuaranteed.length} notes`} your guaranteed exposure
          exceeds your pro-rata share — by {formatCents(overGuaranteedBy)} in total. A pro-rata debt share is an
          economic figure, not a legal one: where you personally guarantee a note you are liable for the whole balance
          regardless of the interest you hold, and only one of those two numbers is what a lender will come after.
        </Note>
      ) : null}


      <Panel
        title="Notes"
        description="Interest owed is what the note charges over its whole term. Paid so far is the interest settled against it, by monthly payment or by lump. Remaining balance is the difference — what is still to pay between now and maturity."
      >
        <DebtFilters kind={kind} view={view} />

        {guaranteedShown ? (
          <Note>
            Notes you have personally guaranteed are shown whole even here. A lender comes after the full balance
            regardless of the share you hold, so scaling one down would understate exactly the exposure that matters.
          </Note>
        ) : null}

        {obligations.length === 0 ? (
          <Empty>
            No {kindLabel} on the books. Add one below — this screen needs no import, no statement and no external
            account.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th>Lender</Th>
                  <Th right>Rate</Th>
                  <Th right>Borrowed</Th>
                  <Th>Matures</Th>
                  <Th right>Interest owed</Th>
                  <Th right>Paid so far</Th>
                  <Th right>Remaining balance</Th>
                  <Th right>Monthly</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {obligations.map((row) => (
                  <tr key={row.loanId} className="hover:bg-surface-2/50">
                    <Td>{row.propertyName}</Td>
                    <Td>
                      <Link href={`/debt/${row.loanId}`} className="hover:text-accent">
                        {row.lender}
                      </Link>
                      {row.loanType === 'pml' ? <Badge tone="accent">PML</Badge> : null}
                      {view === 'prorata' && row.guaranteed ? <Badge tone="bad">guaranteed</Badge> : null}
                    </Td>
                    <Td right>
                      <span className="num text-[12px] text-muted">{row.ratePercent}%</span>
                    </Td>
                    <Td right><Money cents={scale(row.borrowedCents, row)} /></Td>
                    <Td>
                      <span className="num text-[12px]">{row.maturityDate}</span>
                      <span className={`mt-0.5 block text-[10px] ${maturityText(row.daysToMaturity)}`}>
                        {row.daysToMaturity < 0
                          ? `matured ${Math.abs(row.daysToMaturity)} days ago`
                          : `${row.daysToMaturity.toLocaleString()} days`}
                      </span>
                    </Td>
                    <Td right><Money cents={scale(row.totalTermInterestCents, row)} /></Td>
                    <Td right>
                      {row.interestPaidCents ? (
                        <Money cents={scale(row.interestPaidCents, row)} />
                      ) : (
                        <span className="num text-muted">—</span>
                      )}
                      {row.totalPaidCents !== row.interestPaidCents ? (
                        <span className="mt-0.5 block text-[10px] text-muted">
                          of {formatCents(scale(row.totalPaidCents, row))} paid in total
                        </span>
                      ) : null}
                    </Td>
                    <Td right>
                      <Money cents={scale(row.stillOwedToMaturityCents, row)} />
                    </Td>
                    <Td right>
                      <Money cents={scale(row.periodPaymentCents, row)} />
                      {row.paymentFrequency !== 'monthly' ? (
                        <span className="mt-0.5 block text-[10px] text-warn">{row.paymentFrequency}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <Link href={`/debt/${row.loanId}`} className="text-[12px] text-muted hover:text-text">
                        Open
                      </Link>
                    </Td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <Td><strong>Total</strong></Td>
                  <Td />
                  <Td />
                  <Td right><strong><Money cents={total((r) => r.borrowedCents)} /></strong></Td>
                  <Td />
                  <Td right><strong><Money cents={total((r) => r.totalTermInterestCents)} /></strong></Td>
                  <Td right><strong><Money cents={total((r) => r.interestPaidCents)} /></strong></Td>
                  <Td right><strong><Money cents={total((r) => r.stillOwedToMaturityCents)} /></strong></Td>
                  <Td right><strong><Money cents={total((r) => r.periodPaymentCents)} /></strong></Td>
                  <Td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {settled.length > 0 ? (
        <Panel title="Paid off" description="Notes that have been settled or refinanced. Kept, because retiring one should not look like losing it.">
          <table>
            <tbody>
              {settled.map((loan) => (
                <tr key={loan.id}>
                  <Td>{loan.property.name}</Td>
                  <Td>
                    <Link href={`/debt/${loan.id}`} className="hover:text-accent">{loan.lender}</Link>
                    <Badge tone="muted">{loan.status.replace(/_/g, ' ')}</Badge>
                  </Td>
                  <Td right><Money cents={loan.originalPrincipalCents} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
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
