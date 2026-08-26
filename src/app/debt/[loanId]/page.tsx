import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLoanDetail, getSelectOptions, todayIso } from '@/lib/queries';
import { Badge, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { AddPanel } from '@/components/AddPanel';
import { RecordForm } from '@/components/RecordForm';
import { withOptions } from '@/lib/form-helpers';
import { balanceAtDate, buildSchedule, maturityDateOf, payoffAmount, daysToMaturity } from '@/lib/engine/amortization';
import { interestSummary, interestYear, interestYears } from '@/lib/engine/interest';
import { formatCents } from '@/lib/engine/money';
import { InterestAdvanceForm } from '@/components/InterestAdvanceForm';
import { DeleteButton } from '@/components/DeleteButton';

export const dynamic = 'force-dynamic';

export default async function LoanPage({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  const [detail, options] = await Promise.all([getLoanDetail(loanId), getSelectOptions()]);
  if (!detail) notFound();

  const asOf = todayIso();
  const thisYear = Number(asOf.slice(0, 4));
  const { loan, terms, payments, records: recorded } = detail;
  const schedule = buildSchedule(terms, payments);
  const balance = balanceAtDate(terms, asOf, payments);
  const payoff = payoffAmount(terms, asOf, payments);
  const remaining = schedule.filter((row) => row.dueDate > asOf);

  // The interest ledger, which is the question a private lender is actually
  // asked: what does the year cost, and having sent them a lump, what is left.
  const interest = interestSummary(terms, payments, asOf);
  const years = interestYears(terms, payments).map((year) => interestYear(terms, payments, year));
  const thisYearRow = years.find((year) => year.year === thisYear);

  return (
    <>
      <PageHeader
        title={`${loan.property.name} · ${loan.lender}`}
        subtitle={
          <>
            {loan.type.replace(/_/g, ' ')} · {loan.structure.replace(/_/g, ' ')} · {String(loan.ratePercent)}% ·
            matures {maturityDateOf(terms)} ({daysToMaturity(terms, asOf)} days)
            {loan.personallyGuaranteed ? <Badge tone="bad">personally guaranteed</Badge> : null}
          </>
        }
        actions={
          <div className="flex items-center gap-3 text-[13px]">
            <Link href={`/debt/${loanId}/edit`} className="text-muted hover:text-text">
              Edit terms
            </Link>
            <Link href="/debt" className="text-muted hover:text-text">
              ← Ladder
            </Link>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Original principal" value={formatCents(loan.originalPrincipalCents)} />
        <Stat label={`Balance at ${asOf}`} value={formatCents(balance)} />
        <Stat label="Payoff estimate" value={formatCents(payoff.payoffCents)} hint={`Includes ${formatCents(payoff.accruedInterestCents)} accrued since the last payment.`} />
        <Stat label="Payments remaining" value={String(remaining.length)} />
      </div>

      <Note tone="muted">
        This schedule is what turns the single mortgage debit on the bank statement into two P&amp;L lines. The bank
        shows one number; the schedule explains it — no categorization required.
      </Note>

      <Panel
        title="Interest"
        description="What the note charges, against what has been paid. A private lender settled in lumps rather than monthly is the case this exists for: money settles the oldest unpaid period first, the way a lender applies it, so a lump against months of arrears clears the arrears rather than claiming the note is paid into next year."
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={`Still owed for ${thisYear}`}
            value={formatCents(thisYearRow?.stillOwedCents ?? 0)}
            hint={`${formatCents(thisYearRow?.chargedCents ?? 0)} charged this year${
              thisYearRow?.broughtForwardCents ? `, plus ${formatCents(thisYearRow.broughtForwardCents)} carried in` : ''
            }.`}
            tone={(thisYearRow?.stillOwedCents ?? 0) > 0 ? 'bad' : 'muted'}
          />
          <Stat
            label="Behind"
            value={interest.arrearsCents > 0 ? formatCents(interest.arrearsCents) : 'up to date'}
            hint={
              interest.paidThrough
                ? `Settled in full through ${interest.paidThrough}.`
                : 'Nothing has been settled in full yet.'
            }
            tone={interest.arrearsCents > 0 ? 'bad' : 'muted'}
          />
          <Stat
            label="Paid ahead"
            value={interest.creditCents > 0 ? formatCents(interest.creditCents) : '—'}
            hint="Paid beyond everything charged so far."
          />
          <Stat
            label="Left to maturity"
            value={formatCents(interest.arrearsCents + interest.remainingToMaturityCents)}
            hint={`Everything still owed between now and ${interest.maturityDate}.`}
          />
        </div>

        <table>
          <thead>
            <tr>
              <Th>Year</Th>
              <Th right>Periods</Th>
              <Th right>Owed coming in</Th>
              <Th right>Charged</Th>
              <Th right>Paid</Th>
              <Th right>Still owed</Th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year.year} className={year.year === thisYear ? '' : 'text-muted'}>
                <Td>
                  <span className="num">{year.year}</span>
                </Td>
                <Td right>
                  <span className="num">{year.periods}</span>
                </Td>
                <Td right>{year.broughtForwardCents ? <Money cents={year.broughtForwardCents} /> : <span className="num text-muted">—</span>}</Td>
                <Td right><Money cents={year.chargedCents} /></Td>
                <Td right>{year.paidCents ? <Money cents={year.paidCents} /> : <span className="num text-muted">—</span>}</Td>
                <Td right>
                  {year.stillOwedCents ? (
                    <span className={year.year <= thisYear ? 'text-bad' : ''}>
                      <Money cents={year.stillOwedCents} />
                    </span>
                  ) : (
                    <span className="num text-muted">nothing owing</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-[11px] leading-relaxed text-muted">
            Record a lump-sum interest payment. It settles the oldest unpaid period first and works forward; whatever
            is left once the past is clear becomes credit against periods still to come. It never pays down principal,
            because prepaying interest does not.
          </p>
          <InterestAdvanceForm loanId={loanId} today={asOf} />
        </div>

        {recorded.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[11px] leading-relaxed text-muted">
              Every payment recorded against this note. Anything mistyped can be corrected in place or removed —
              nothing here is derived, so editing one only moves the months it touches.
            </p>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Kind</Th>
                    <Th right>Total</Th>
                    <Th right>Principal</Th>
                    <Th right>Interest</Th>
                    <Th right>Escrow</Th>
                    <Th right>Extra principal</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {recorded.map((entry) => (
                    <tr key={entry.id} className="hover:bg-surface-2/50">
                      <Td>
                        <span className="num">{entry.date}</span>
                      </Td>
                      <Td>
                        {entry.source === 'advance' ? (
                          <Badge tone="accent">lump</Badge>
                        ) : entry.source === 'scheduled' ? (
                          <Badge tone="muted">scheduled</Badge>
                        ) : (
                          <Badge tone="muted">payment</Badge>
                        )}
                      </Td>
                      <Td right><Money cents={entry.totalCents} /></Td>
                      <Td right>{entry.principalCents ? <Money cents={entry.principalCents} /> : <span className="num text-muted">—</span>}</Td>
                      <Td right>{entry.interestCents ? <Money cents={entry.interestCents} /> : <span className="num text-muted">—</span>}</Td>
                      <Td right>{entry.escrowCents ? <Money cents={entry.escrowCents} /> : <span className="num text-muted">—</span>}</Td>
                      <Td right>{entry.extraPrincipalCents ? <Money cents={entry.extraPrincipalCents} /> : <span className="num text-muted">—</span>}</Td>
                      <Td>
                        <span className="flex items-center gap-3">
                          <Link
                            href={`/edit/loanPayment/${entry.id}?back=${encodeURIComponent(`/debt/${loanId}`)}`}
                            className="text-[12px] text-muted hover:text-text"
                          >
                            Edit
                          </Link>
                          <DeleteButton modelKey="loanPayment" id={entry.id} />
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel title="Amortization schedule" description="Rows marked actual come from recorded payments; the rest are derived from the terms.">
        <div className="max-h-[70vh] overflow-auto">
          <table>
            <thead className="sticky top-0 bg-surface">
              <tr>
                <Th right>#</Th>
                <Th>Due</Th>
                <Th right>Opening</Th>
                <Th right>Payment</Th>
                <Th right>Principal</Th>
                <Th right>Interest</Th>
                <Th right>Extra</Th>
                <Th right>Escrow</Th>
                <Th right>Closing</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {schedule.map((row) => (
                <tr key={row.period} className={row.dueDate <= asOf ? 'text-muted' : ''}>
                  <Td right>{row.period}</Td>
                  <Td>
                    <span className="num">{row.dueDate}</span>
                  </Td>
                  <Td right>
                    <Money cents={row.openingBalanceCents} />
                  </Td>
                  <Td right>
                    <Money cents={row.paymentCents} />
                  </Td>
                  <Td right>
                    <Money cents={row.principalCents} />
                  </Td>
                  <Td right>
                    <Money cents={row.interestCents} />
                  </Td>
                  <Td right>{row.extraPrincipalCents ? <Money cents={row.extraPrincipalCents} /> : <span className="num text-muted">—</span>}</Td>
                  <Td right>{row.escrowCents ? <Money cents={row.escrowCents} /> : <span className="num text-muted">—</span>}</Td>
                  <Td right>
                    <Money cents={row.closingBalanceCents} />
                  </Td>
                  <Td>
                    {row.isBalloon ? <Badge tone="bad">balloon</Badge> : null}
                    {row.actual ? <Badge tone="accent">actual</Badge> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <AddPanel
        label="Record a payment"
        description="Only where a payment differed from the schedule above — an extra principal payment, a late one, a different amount. Payments that landed as scheduled need no entry, and the ones due this month can be marked paid on Payouts."
      >
        <RecordForm
          modelKey="loanPayment"
          fields={withOptions('loanPayment', { loanId: options.loans })}
          initial={{ loanId }}
        />
      </AddPanel>
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
