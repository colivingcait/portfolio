/**
 * Bank statement import (§7).
 *
 * One account per property means the file is the property. Payee rules learn
 * the twenty-odd recurring payees each account sees, so after two months the
 * monthly work is a handful of one-offs.
 */

import type { IsoDate } from './dates';
import { affectsPnl, category, isExpense, isIncome, type CategoryCatalog } from './categories';
import { sumCents, type Cents } from './money';

export interface RawTransaction {
  date: IsoDate;
  description: string;
  /** Credits positive, debits negative. */
  amountCents: Cents;
  runningBalanceCents?: Cents | null;
}

export type RuleDirection = 'any' | 'debit' | 'credit';

export interface PayeeRule {
  id: string;
  /** Null applies the rule to every account. */
  bankAccountId: string | null;
  /** Case-insensitive substring of the description. */
  match: string;
  categoryKey: string;
  /**
   * Which way the money has to be going for this rule to apply. A transfer to
   * your own account reads identically whether it was a draw or a
   * contribution; the sign is the only thing that distinguishes them.
   */
  direction?: RuleDirection;
  /** Higher wins; ties break on the longer, more specific match. */
  priority?: number;
}

export interface ClassifiedTransaction extends RawTransaction {
  categoryKey: string | null;
  matchedRuleId: string | null;
}

/**
 * Substring match on description → category.
 *
 * Most specific wins: highest priority, then longest match string. Anything
 * unmatched lands in the review list rather than being guessed at.
 */
/** Lowercased with runs of whitespace collapsed, for substring comparison. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function matchRule(
  rules: readonly PayeeRule[],
  description: string,
  bankAccountId: string | null,
  amountCents?: Cents,
): PayeeRule | null {
  // Whitespace is collapsed on both sides: a PDF can put two spaces where the
  // rule has one, and the rule should not care.
  const haystack = collapse(description);
  const movement: RuleDirection | null =
    amountCents === undefined ? null : amountCents < 0 ? 'debit' : 'credit';

  const candidates = rules.filter((r) => {
    if (r.bankAccountId !== null && r.bankAccountId !== bankAccountId) return false;
    if (r.match.trim() === '') return false;
    if (!haystack.includes(collapse(r.match))) return false;
    const direction = r.direction ?? 'any';
    if (direction === 'any' || movement === null) return true;
    return direction === movement;
  });
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    // A rule that names a direction is more specific than one that does not.
    const directed = Number((b.direction ?? 'any') !== 'any') - Number((a.direction ?? 'any') !== 'any');
    if (directed !== 0) return directed;
    const p = (b.priority ?? 0) - (a.priority ?? 0);
    if (p !== 0) return p;
    return b.match.length - a.match.length;
  })[0];
}

export function classify(
  transactions: readonly RawTransaction[],
  rules: readonly PayeeRule[],
  bankAccountId: string | null,
): ClassifiedTransaction[] {
  return transactions.map((t) => {
    const rule = matchRule(rules, t.description, bankAccountId, t.amountCents);
    return {
      ...t,
      categoryKey: rule ? rule.categoryKey : null,
      matchedRuleId: rule ? rule.id : null,
    };
  });
}

/** Rows a human still has to look at. If this list is ever long, the rule table needs work. */
export function reviewList(transactions: readonly ClassifiedTransaction[]): ClassifiedTransaction[] {
  return transactions.filter((t) => t.categoryKey === null);
}

export interface BalanceCheck {
  openingBalanceCents: Cents;
  creditsCents: Cents;
  debitsCents: Cents;
  computedClosingCents: Cents;
  statedClosingCents: Cents;
  differenceCents: Cents;
  tied: boolean;
}

/**
 * opening_balance + Σ credits − Σ debits = closing_balance
 *
 * If it doesn't tie, the import is incomplete or malformed. Refuse to post
 * rather than silently accept a partial statement — this is the correctness
 * guarantee a live transaction feed can't offer, and it's what catches a
 * charge that landed in the wrong account.
 */
export function checkStatementBalance(input: {
  openingBalanceCents: Cents;
  closingBalanceCents: Cents;
  transactions: readonly RawTransaction[];
}): BalanceCheck {
  const credits = sumCents(input.transactions.filter((t) => t.amountCents > 0).map((t) => t.amountCents));
  const debits = -sumCents(input.transactions.filter((t) => t.amountCents < 0).map((t) => t.amountCents));
  const computed = input.openingBalanceCents + credits - debits;
  const difference = computed - input.closingBalanceCents;
  return {
    openingBalanceCents: input.openingBalanceCents,
    creditsCents: credits,
    debitsCents: debits,
    computedClosingCents: computed,
    statedClosingCents: input.closingBalanceCents,
    differenceCents: difference,
    tied: difference === 0,
  };
}

export class StatementDoesNotTieError extends Error {
  constructor(readonly check: BalanceCheck) {
    super(
      `Statement does not tie: opening + credits − debits = ${check.computedClosingCents}, statement says ${check.statedClosingCents} (off by ${check.differenceCents}). Refusing to post.`,
    );
    this.name = 'StatementDoesNotTieError';
  }
}

/** Throws unless the statement ties. Call before writing any transaction. */
export function assertStatementTies(check: BalanceCheck): void {
  if (!check.tied) throw new StatementDoesNotTieError(check);
}

export interface PeriodTotals {
  incomeCents: Cents;
  expenseCents: Cents;
  /** Excluded from the P&L: deposits, transfers, owner cash, foreign charges. */
  excludedCents: Cents;
  netCashCents: Cents;
  /** Running balance of tenant deposits held — a liability, not revenue. */
  depositsHeldDeltaCents: Cents;
  byCategory: Record<string, Cents>;
}

export function periodTotals(
  transactions: readonly ClassifiedTransaction[],
  catalog?: CategoryCatalog,
): PeriodTotals {
  const byCategory: Record<string, Cents> = {};
  let income = 0;
  let expense = 0;
  let excluded = 0;
  let depositsDelta = 0;

  for (const t of transactions) {
    const key = t.categoryKey ?? 'uncategorized';
    byCategory[key] = (byCategory[key] ?? 0) + t.amountCents;

    if (t.categoryKey === null) continue;
    if (t.categoryKey === 'security_deposit_received') depositsDelta += t.amountCents;
    if (t.categoryKey === 'security_deposit_returned') depositsDelta += t.amountCents; // negative amount

    if (!affectsPnl(t.categoryKey, catalog)) {
      excluded += t.amountCents;
      continue;
    }
    if (isIncome(t.categoryKey, catalog)) income += t.amountCents;
    else if (isExpense(t.categoryKey, catalog)) expense += -t.amountCents; // debits are negative
  }

  return {
    incomeCents: income,
    expenseCents: expense,
    excludedCents: excluded,
    netCashCents: income - expense,
    depositsHeldDeltaCents: depositsDelta,
    byCategory,
  };
}

/**
 * A rule learned from a confirmed review row. Applies to every future import
 * on that account — that is the whole difference from the Stessa experience.
 */
export function ruleFromConfirmation(
  input: { description: string; categoryKey: string; bankAccountId: string | null },
  catalog?: CategoryCatalog,
): Omit<PayeeRule, 'id'> {
  if (!category(input.categoryKey, catalog)) {
    throw new Error(`Unknown category: ${input.categoryKey}`);
  }
  return {
    bankAccountId: input.bankAccountId,
    match: normalizePayee(input.description),
    categoryKey: input.categoryKey,
    priority: 0,
  };
}

/**
 * Strip the volatile parts of a bank description — dates, trailing reference
 * numbers, card suffixes — leaving the stable payee stem to match on.
 */
export function normalizePayee(description: string): string {
  return description
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\b(?:x{2,}|\*{2,})\d+\b/gi, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
}
