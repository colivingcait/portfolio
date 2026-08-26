import 'server-only';
import { prisma } from './db';
import { toLoanPayment, toLoanTerms } from './mappers';
import { balanceAtDate, buildSchedule, daysToMaturity, maturityDateOf } from './engine/amortization';
import { interestSummary, interestYear } from './engine/interest';
import { obligationsIn, type DebtHorizon, type DebtKind, type LoanObligation } from './engine/payouts';
import { monthEnd, type MonthKey } from './engine/dates';
import { getOwnershipContext } from './queries';

/**
 * Every note, with what it cost, what has been paid and what is left.
 *
 * Lives here rather than inside the payouts query because it belongs to the
 * debt screen. It had been reachable only from Payouts, which is where you go
 * to see money leaving this month — not where anyone looks for a loan.
 */
export async function getDebtObligations(
  month: MonthKey,
  horizon: DebtHorizon,
  kind: DebtKind,
): Promise<LoanObligation[]> {
  const asOf = monthEnd(month);
  const [ownership, loans] = await Promise.all([
    getOwnershipContext(asOf),
    prisma.loan.findMany({
    where: { status: 'active' },
      include: { property: true, payments: true },
      orderBy: { maturityDate: 'asc' },
    }),
  ]);

  return obligationsIn(
    horizon,
    month,
    kind,
    loans.map((loan) => {
      const terms = toLoanTerms(loan);
      const records = loan.payments.map(toLoanPayment);
      const year = interestYear(terms, records, Number(month.slice(0, 4)));
      const summary = interestSummary(terms, records, asOf);

      return {
        loanId: loan.id,
        lender: loan.lender,
        propertyId: loan.propertyId,
        propertyName: loan.property.name,
        loanType: loan.type,
        ratePercent: Number(loan.ratePercent),
        borrowedCents: loan.originalPrincipalCents,
        paidToDateCents: loan.payments.reduce((total, p) => total + p.totalCents, 0),
        balanceCents: balanceAtDate(terms, asOf, records),
        maturityDate: maturityDateOf(terms),
        daysToMaturity: daysToMaturity(terms, asOf),
        sharePercent: ownership.shares.get(loan.propertyId) ?? 0,
        guaranteed: loan.personallyGuaranteed,
        schedule: buildSchedule(terms, records),
        actualPaymentDates: loan.payments.filter((p) => p.source === 'actual').map((p) => p.date.toISOString().slice(0, 10)),
        stillOwedThisYearCents: year.stillOwedCents,
        stillOwedToMaturityCents: summary.arrearsCents + summary.remainingToMaturityCents,
      };
    }),
  );
}
