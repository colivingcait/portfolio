'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { fromIsoDate } from './mappers';
import { monthEnd, type MonthKey } from './engine/dates';

export interface PayoutActionResult {
  ok: boolean;
  error?: string;
  recorded?: number;
}

/**
 * Record a month's profit distributions.
 *
 * Written as capital-account entries of kind `distribution`, tagged with the
 * earnings month they relate to — a September split paid in October belongs to
 * September, or the month's payout can never be checked against the month's
 * cash. Profit does not reduce what is owed back on sale; only a return of
 * capital does that.
 */
export async function recordDistributions(input: {
  propertyId: string;
  month: MonthKey;
  date?: string;
  rows: { entityId: string; amountCents: number }[];
  memo?: string;
}): Promise<PayoutActionResult> {
  const rows = input.rows.filter((row) => row.entityId && row.amountCents !== 0);
  if (rows.length === 0) return { ok: false, error: 'Nothing to record — every amount is zero.' };
  if (rows.some((row) => row.amountCents < 0)) {
    return { ok: false, error: 'A distribution cannot be negative. A loss is not a call on the partners.' };
  }

  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : monthEnd(input.month);

  // Re-recording a month replaces it rather than paying twice.
  await prisma.$transaction([
    prisma.capitalAccountEntry.deleteMany({
      where: { propertyId: input.propertyId, month: input.month, kind: 'distribution' },
    }),
    ...rows.map((row) =>
      prisma.capitalAccountEntry.create({
        data: {
          entityId: row.entityId,
          propertyId: input.propertyId,
          kind: 'distribution',
          date: fromIsoDate(date),
          month: input.month,
          amountCents: row.amountCents,
          memo: input.memo ?? `Profit distribution for ${input.month}`,
        },
      }),
    ),
  ]);

  revalidatePath('/', 'layout');
  return { ok: true, recorded: rows.length };
}

/**
 * Record a payment made against a loan.
 *
 * The schedule says what was owed; this says what actually went out, and the
 * schedule defers to it for that period.
 */
export async function recordLoanPayment(input: {
  loanId: string;
  date: string;
  totalCents: number;
  principalCents: number;
  interestCents: number;
  escrowCents?: number;
  extraPrincipalCents?: number;
}): Promise<PayoutActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: 'A payment needs a date.' };
  if (input.totalCents <= 0) return { ok: false, error: 'A payment has to be more than nothing.' };

  const loan = await prisma.loan.findUnique({ where: { id: input.loanId } });
  if (!loan) return { ok: false, error: 'That loan no longer exists.' };

  const escrow = input.escrowCents ?? 0;
  const parts = input.principalCents + input.interestCents + escrow + (input.extraPrincipalCents ?? 0);
  if (parts !== input.totalCents) {
    return {
      ok: false,
      error: `Principal, interest, escrow and extra principal come to ${(parts / 100).toFixed(2)}, but the total says ${(input.totalCents / 100).toFixed(2)}.`,
    };
  }

  await prisma.loanPayment.create({
    data: {
      loanId: input.loanId,
      date: fromIsoDate(input.date),
      totalCents: input.totalCents,
      principalCents: input.principalCents,
      interestCents: input.interestCents,
      escrowCents: escrow,
      extraPrincipalCents: input.extraPrincipalCents ?? 0,
      source: 'actual',
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true, recorded: 1 };
}

