'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { requireIsoDate } from './mappers';
import { recomputeMonths } from './rollups';
import { monthOf } from './engine/dates';
import { repairMatch } from './import/payee';

export interface RepairResult {
  ok: boolean;
  error?: string;
  repaired: number;
  categorized: number;
}

/**
 * Apply a rule to everything already imported that it covers and that nothing
 * has categorized yet. A rule is retroactive by nature: writing one is a
 * statement about what the payee means, not about when it was noticed.
 */
async function applyRule(ruleId: string): Promise<number> {
  const rule = await prisma.payeeRule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.match.trim() === '') return 0;

  const candidates = await prisma.bankTransaction.findMany({
    where: {
      categoryKey: null,
      ...(rule.bankAccountId ? { statement: { bankAccountId: rule.bankAccountId } } : {}),
    },
    include: { statement: { include: { bankAccount: true } } },
  });

  const needle = rule.match.replace(/\s+/g, ' ').trim().toLowerCase();
  const hits = candidates.filter((t) => {
    if (!t.description.replace(/\s+/g, ' ').trim().toLowerCase().includes(needle)) return false;
    if (rule.direction === 'debit') return t.amountCents < 0;
    if (rule.direction === 'credit') return t.amountCents >= 0;
    return true;
  });
  if (hits.length === 0) return 0;

  await prisma.bankTransaction.updateMany({
    where: { id: { in: hits.map((h) => h.id) } },
    data: { categoryKey: rule.categoryKey, matchedRuleId: rule.id },
  });

  // Rows can span several properties and months, and each rollup they touch
  // has to be rebuilt or the totals silently stay as they were.
  const byProperty = new Map<string, Set<string>>();
  for (const hit of hits) {
    const propertyId = hit.statement.bankAccount.propertyId;
    const months = byProperty.get(propertyId) ?? new Set<string>();
    months.add(monthOf(requireIsoDate(hit.date)));
    byProperty.set(propertyId, months);
  }
  for (const [propertyId, months] of byProperty) {
    await recomputeMonths(propertyId, [...months]);
  }

  return hits.length;
}

/**
 * Mend rules that catch nothing, then apply them.
 *
 * Only rules whose own words appear on the statements are touched, and each is
 * narrowed to the longest run that really is there — never widened. A rule
 * that cannot be mended from the imported lines is left exactly as it is.
 */
export async function repairRules(ruleId?: string): Promise<RepairResult> {
  const rules = await prisma.payeeRule.findMany({
    where: ruleId ? { id: ruleId } : {},
  });

  const transactions = await prisma.bankTransaction.findMany({
    select: { description: true, statement: { select: { bankAccountId: true } } },
  });

  const byAccount = new Map<string, string[]>();
  for (const transaction of transactions) {
    const list = byAccount.get(transaction.statement.bankAccountId) ?? [];
    list.push(transaction.description);
    byAccount.set(transaction.statement.bankAccountId, list);
  }
  const everything = transactions.map((t) => t.description);

  let repaired = 0;
  let categorized = 0;

  for (const rule of rules) {
    const descriptions = rule.bankAccountId ? (byAccount.get(rule.bankAccountId) ?? []) : everything;
    const repair = repairMatch(rule.match, descriptions);
    if (!repair) continue;

    // Two rules on the same account can mend to the same text — a draw and a
    // contribution written as a pair, for instance. That is fine; what is not
    // fine is two rules with the same text AND the same direction.
    const clash = await prisma.payeeRule.findFirst({
      where: {
        id: { not: rule.id },
        bankAccountId: rule.bankAccountId,
        match: repair.match,
        direction: rule.direction,
      },
    });
    if (clash) continue;

    await prisma.payeeRule.update({ where: { id: rule.id }, data: { match: repair.match } });
    repaired += 1;
    categorized += await applyRule(rule.id);
  }

  revalidatePath('/', 'layout');
  return { ok: true, repaired, categorized };
}

/** Run an existing rule over lines that are still uncategorized. */
export async function reapplyRule(ruleId: string): Promise<RepairResult> {
  const categorized = await applyRule(ruleId);
  revalidatePath('/', 'layout');
  return { ok: true, repaired: 0, categorized };
}
