'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { fromIsoDate } from './mappers';
import { parseMoney } from './forms';
import { recomputeMonths } from './rollups';
import { addMonthsToMonth, monthRange } from './engine/dates';

/**
 * Interest paid ahead of when it falls due.
 *
 * Kept apart from an ordinary payment on purpose. A private lender sent a
 * year's interest in one cheque has been paid for twelve periods, not given
 * one enormous one — so this never overwrites a schedule row and never touches
 * principal. The engine consumes it forward against the periods it covers.
 */
export async function recordInterestAdvance(
  loanId: string,
  date: string,
  amount: string,
): Promise<{ ok: boolean; error?: string }> {
  const loan = await prisma.loan.findUnique({ where: { id: loanId }, select: { id: true, propertyId: true } });
  if (!loan) return { ok: false, error: 'That loan no longer exists.' };

  const amountCents = parseMoney(amount);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'Enter the date the payment was made.' };
  }

  await prisma.loanPayment.create({
    data: {
      loanId,
      date: fromIsoDate(date),
      totalCents: amountCents,
      principalCents: 0,
      interestCents: amountCents,
      escrowCents: 0,
      extraPrincipalCents: 0,
      source: 'advance',
    },
  });

  // The cash left the account in the month it was written, and the months it
  // covers no longer owe it — both change net cash, so both are rebuilt.
  await recomputeMonths(loan.propertyId, monthsTouched(date));
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * The month of the payment and three years after it.
 *
 * An advance changes what is owed for every month it reaches, not just its
 * own, so recomputing only its month would leave the ones it settles still
 * showing debt service it has already met.
 */
function monthsTouched(date: string): string[] {
  const month = date.slice(0, 7);
  return monthRange(month, addMonthsToMonth(month, 36));
}
