import 'server-only';
import { prisma } from './db';
import { countMatches, repairMatch, type RuleRepair } from './import/payee';

export interface RuleHealth {
  id: string;
  bankAccountId: string | null;
  accountLabel: string;
  match: string;
  categoryKey: string;
  direction: string;
  priority: number;
  /** Imported transactions this rule's text appears in, on the accounts it covers. */
  catches: number;
  /** How many of those it is currently the winning rule for. */
  applied: number;
  /** Set where the rule catches nothing but can be mended from the statements. */
  repair: RuleRepair | null;
}

/**
 * Every rule with the one number that says whether it works: how many imported
 * lines it actually appears in.
 *
 * A rule is easy to write and impossible to check by eye, so a dead one sits
 * there looking correct while every month's import goes to Review untouched.
 */
export async function getRuleHealth(): Promise<RuleHealth[]> {
  const [rules, transactions] = await Promise.all([
    prisma.payeeRule.findMany({
      include: { bankAccount: { include: { property: true } } },
      orderBy: [{ priority: 'desc' }, { match: 'asc' }],
    }),
    prisma.bankTransaction.findMany({
      select: { description: true, matchedRuleId: true, statement: { select: { bankAccountId: true } } },
    }),
  ]);

  const byAccount = new Map<string, string[]>();
  const appliedCounts = new Map<string, number>();
  for (const transaction of transactions) {
    const accountId = transaction.statement.bankAccountId;
    const list = byAccount.get(accountId) ?? [];
    list.push(transaction.description);
    byAccount.set(accountId, list);
    if (transaction.matchedRuleId) {
      appliedCounts.set(transaction.matchedRuleId, (appliedCounts.get(transaction.matchedRuleId) ?? 0) + 1);
    }
  }
  const everything = transactions.map((t) => t.description);

  return rules.map((rule) => {
    // A rule with no account covers every account, so it is judged against all
    // the imported lines rather than one account's.
    const descriptions = rule.bankAccountId ? (byAccount.get(rule.bankAccountId) ?? []) : everything;
    const catches = countMatches(rule.match, descriptions);

    return {
      id: rule.id,
      bankAccountId: rule.bankAccountId,
      accountLabel: rule.bankAccount
        ? `${rule.bankAccount.property.name} · ${rule.bankAccount.label}`
        : 'All accounts',
      match: rule.match,
      categoryKey: rule.categoryKey,
      direction: rule.direction,
      priority: rule.priority,
      catches,
      applied: appliedCounts.get(rule.id) ?? 0,
      repair: catches === 0 ? repairMatch(rule.match, descriptions) : null,
    };
  });
}
