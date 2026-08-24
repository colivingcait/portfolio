import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLoanDetail, todayIso } from '@/lib/queries';
import { Badge, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { balanceAtDate, buildSchedule, maturityDateOf, payoffAmount, daysToMaturity } from '@/lib/engine/amortization';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

export default async function LoanPage({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  const detail = await getLoanDetail(loanId);
  if (!detail) notFound();

  const asOf = todayIso();
  const { loan, terms, payments } = detail;
  const schedule = buildSchedule(terms, payments);
  const balance = balanceAtDate(terms, asOf, payments);
  const payoff = payoffAmount(terms, asOf, payments);
  const remaining = schedule.filter((row) => row.dueDate > asOf);

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
          <Link href="/debt" className="text-[13px] text-muted hover:text-text">
            ← Ladder
          </Link>
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
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-1 text-left text-[18px]">{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
