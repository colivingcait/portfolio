'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { requireIsoDate } from './mappers';
import { recomputeMonths } from './rollups';
import { monthOf } from './engine/dates';
import { getCategoryCatalog } from './categories-queries';
import { category } from './engine/categories';

export interface BooksResult {
  ok: boolean;
  error?: string;
  field?: string;
}

/** Rebuild every rollup a transaction touches, so the reports move with it. */
async function recomputeFor(transactionId: string): Promise<void> {
  const transaction = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    include: { statement: { include: { bankAccount: true } } },
  });
  if (!transaction) return;
  await recomputeMonths(transaction.statement.bankAccount.propertyId, [monthOf(requireIsoDate(transaction.date))]);
}

/**
 * Change a category after the fact.
 *
 * Categorizing is a judgement, and judgements get revised — a repair that
 * turns out to be an improvement, a fee that turns out to be a deposit. The
 * rollups for that month are rebuilt on the spot so no report is left showing
 * the old answer.
 */
export async function recategorize(transactionId: string, categoryKey: string): Promise<BooksResult> {
  const catalog = await getCategoryCatalog();
  if (categoryKey !== '' && !category(categoryKey, catalog)) {
    return { ok: false, error: `Unknown category: ${categoryKey}` };
  }

  const existing = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    include: { splits: { select: { id: true } } },
  });
  if (!existing) return { ok: false, error: 'That transaction no longer exists.' };
  if (existing.splits.length > 0) {
    return {
      ok: false,
      error: 'This one is split. Categorize the pieces, or undo the split first.',
    };
  }

  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { categoryKey: categoryKey === '' ? null : categoryKey, confirmed: categoryKey !== '' },
  });
  await recomputeFor(transactionId);

  revalidatePath('/', 'layout');
  return { ok: true };
}

/** A note on a row. The statement line rarely says what the money was for. */
export async function setMemo(transactionId: string, memo: string): Promise<BooksResult> {
  const trimmed = memo.trim();
  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { memo: trimmed === '' ? null : trimmed.slice(0, 500) },
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}

export interface SplitPiece {
  categoryKey: string;
  /** Signed the same way as the parent: debits negative, credits positive. */
  amountCents: number;
  memo?: string;
}

/**
 * Break one charge into the things it actually paid for.
 *
 * A single Home Depot receipt can be half supplies and half a capital
 * improvement, and those two go to different places on a tax return. The
 * original row is kept exactly as the bank has it so the statement still ties;
 * the pieces hang off it and are what the books count.
 */
export async function splitTransaction(transactionId: string, pieces: SplitPiece[]): Promise<BooksResult> {
  const parent = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    include: { splits: { select: { id: true } } },
  });
  if (!parent) return { ok: false, error: 'That transaction no longer exists.' };
  if (parent.splitParentId) return { ok: false, error: 'A piece of a split cannot itself be split.' };

  const usable = pieces.filter((piece) => piece.amountCents !== 0);
  if (usable.length < 2) return { ok: false, error: 'A split needs at least two pieces with an amount.' };

  const catalog = await getCategoryCatalog();
  for (const piece of usable) {
    if (!category(piece.categoryKey, catalog)) {
      return { ok: false, error: `Unknown category: ${piece.categoryKey}` };
    }
  }

  // The pieces have to add up to the charge. Anything else would silently
  // change what the month spent, and the statement would stop tying.
  const total = usable.reduce((sum, piece) => sum + piece.amountCents, 0);
  if (total !== parent.amountCents) {
    const short = parent.amountCents - total;
    return {
      ok: false,
      error: `The pieces come to ${(total / 100).toFixed(2)} but the charge is ${(parent.amountCents / 100).toFixed(2)} — ${(Math.abs(short) / 100).toFixed(2)} ${short > 0 ? 'short' : 'over'}.`,
    };
  }

  await prisma.$transaction([
    prisma.bankTransaction.deleteMany({ where: { splitParentId: transactionId } }),
    // The container carries no category of its own; the pieces do.
    prisma.bankTransaction.update({
      where: { id: transactionId },
      data: { categoryKey: null, confirmed: true },
    }),
    prisma.bankTransaction.createMany({
      data: usable.map((piece) => ({
        statementId: parent.statementId,
        splitParentId: parent.id,
        date: parent.date,
        description: parent.description,
        amountCents: piece.amountCents,
        categoryKey: piece.categoryKey,
        confirmed: true,
        memo: piece.memo?.trim() || null,
      })),
    }),
  ]);

  await recomputeFor(transactionId);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Put a split back together, leaving the original row uncategorized. */
export async function unsplitTransaction(transactionId: string): Promise<BooksResult> {
  const parent = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    include: { splits: { select: { id: true } } },
  });
  if (!parent) return { ok: false, error: 'That transaction no longer exists.' };
  if (parent.splits.length === 0) return { ok: false, error: 'That one is not split.' };

  await prisma.$transaction([
    prisma.bankTransaction.deleteMany({ where: { splitParentId: transactionId } }),
    prisma.bankTransaction.update({ where: { id: transactionId }, data: { confirmed: false } }),
  ]);

  await recomputeFor(transactionId);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Recategorize several rows at once — a month of one payee misfiled together. */
export async function recategorizeMany(ids: string[], categoryKey: string): Promise<BooksResult & { changed: number }> {
  const catalog = await getCategoryCatalog();
  if (!category(categoryKey, catalog)) return { ok: false, error: `Unknown category: ${categoryKey}`, changed: 0 };
  if (ids.length === 0) return { ok: true, changed: 0 };

  const rows = await prisma.bankTransaction.findMany({
    where: { id: { in: ids }, splits: { none: {} } },
    include: { statement: { include: { bankAccount: true } } },
  });

  await prisma.bankTransaction.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { categoryKey, confirmed: true },
  });

  const byProperty = new Map<string, Set<string>>();
  for (const row of rows) {
    const propertyId = row.statement.bankAccount.propertyId;
    const months = byProperty.get(propertyId) ?? new Set<string>();
    months.add(monthOf(requireIsoDate(row.date)));
    byProperty.set(propertyId, months);
  }
  for (const [propertyId, months] of byProperty) {
    await recomputeMonths(propertyId, [...months]);
  }

  revalidatePath('/', 'layout');
  return { ok: true, changed: rows.length };
}
