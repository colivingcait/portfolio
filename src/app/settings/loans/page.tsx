import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSelectOptions, todayIso } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { DeleteButton } from '@/components/DeleteButton';
import { Badge, Empty, Explainer, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '../_shared/helpers';
import { balanceAtDate, maturityDateOf } from '@/lib/engine/amortization';
import { toLoanPayment, toLoanTerms } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

export default async function LoansPage() {
  const asOf = todayIso();
  const [loans, options] = await Promise.all([
    prisma.loan.findMany({ include: { property: true, payments: true }, orderBy: { maturityDate: 'asc' } }),
    getSelectOptions(),
  ]);

  const loanFields = withOptions('loan', { propertyId: options.properties });
  const paymentFields = withOptions('loanPayment', { loanId: options.loans });

  return (
    <>
      <PageHeader
        title="Loans"
        subtitle="Build this first: it depends on no import, no statement and no external account. It is arithmetic, it works on day one, and it is the part no off-the-shelf tool does properly for private notes."
      />


      <Explainer title="Why this matters">
        This is the part that works on day one: it needs no import, no statement and no outside account. It is
        arithmetic, and it is what no off-the-shelf tool does properly for private notes.
        <div className="mt-1.5">
          What it buys you: a bank line showing one undivided payment gets split into interest, principal and escrow by
          the schedule, so only the deductible half reaches a tax return and the balance sheet moves correctly every
          month. A maturity ladder shows what comes due when. And <strong>escrow disbursements</strong> — the tax and
          insurance bills the servicer pays out — are the only way those two reach Schedule E at all, since they never
          appear as a bank line of their own.
        </div>
      </Explainer>
      <Note tone="muted">
        Set “personally guaranteed” where it applies. A pro-rata debt share is an economic figure, not a legal one —
        the ladder shows guaranteed exposure at the full balance alongside your share, and those two numbers can
        differ enormously.
      </Note>

      <Panel title="Add a loan">
        <RecordForm modelKey="loan" fields={loanFields} />
      </Panel>

      <Panel title={`${loans.length} loans`}>
        {loans.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Property</Th>
                <Th>Lender</Th>
                <Th>Structure</Th>
                <Th right>Rate</Th>
                <Th right>Original</Th>
                <Th right>Balance</Th>
                <Th>Maturity</Th>
                <Th />
                <Th />
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => {
                const terms = toLoanTerms(loan);
                return (
                  <tr key={loan.id}>
                    <Td>{loan.property.name}</Td>
                    <Td>
                      <Link href={`/debt/${loan.id}`} className="hover:text-accent">
                        {loan.lender}
                      </Link>
                      {loan.personallyGuaranteed ? <Badge tone="bad">guaranteed</Badge> : null}
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">{loan.structure.replace(/_/g, ' ')}</span>
                    </Td>
                    <Td right>{String(loan.ratePercent)}%</Td>
                    <Td right>
                      <Money cents={loan.originalPrincipalCents} />
                    </Td>
                    <Td right>
                      <Money cents={balanceAtDate(terms, asOf, loan.payments.map(toLoanPayment))} />
                    </Td>
                    <Td>
                      <span className="num">{maturityDateOf(terms)}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">{loan.status}</span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3">
                      <Link href={`/settings/loans/${loan.id}`} className="text-[12px] text-muted hover:text-accent">
                        Edit
                      </Link>
                      <DeleteButton modelKey="loan" id={loan.id} />
                    </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {loans.length > 0 ? (
        <Panel
          title="Record a payment"
          description="Actual payments override the derived schedule for their month, so extra principal genuinely shortens the loan."
        >
          <RecordForm modelKey="loanPayment" fields={paymentFields} />
        </Panel>
      ) : null}
    </>
  );
}
