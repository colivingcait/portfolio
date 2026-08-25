/**
 * Bank statement import (§7).
 *
 * One account per property means the file is the property. Payee rules learn
 * the twenty-odd recurring payees each account sees, so after two months the
 * monthly work is a handful of one-offs.
 */

import { daysBetween, type IsoDate } from './dates';
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
  catalog: CategoryCatalog,
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
  catalog: CategoryCatalog,
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

/**
 * A charge and the reversal that cancels it (§7).
 *
 * A fee levied and then refunded is two lines, not one, and the whole question
 * is whether they end up in the same category. Put both under Bank fee and
 * their opposite signs cancel: the line ends at what was actually kept.
 * Categorize the reversal as income instead and the year gains a cost that was
 * never borne AND income that was never earned — the net is right, every
 * figure around it is wrong.
 *
 * Pairing is by exact opposite amount on the same account, which is
 * restrictive on its own, plus evidence that the two lines are about the same
 * thing. Suggested, never applied: only a person can say whether a refund of
 * last month's fee is a reversal or an unrelated credit that happens to match.
 */
export interface ReversalCandidate {
  /** Index into the transactions passed in. */
  index: number;
  /** The row it appears to reverse. */
  originalIndex: number;
  daysApart: number;
  confidence: 'high' | 'medium';
  /** Words the two lines share, which is what the pairing rests on. */
  sharedTerms: string[];
}

/** Words that say a line undoes another one. */
const REVERSAL_WORDS =
  /\b(reversal|reversed|reverse|refund|refunded|returned|return|credit\s*adjustment|adjustment|correction|corrected|waived|waiver|rebate|chargeback|charge\s*back|void|voided|cancelled|canceled)\b/i;

/** Words too common to mean two lines are about the same thing. */
const WEAK_TERMS = new Set([
  'ach', 'the', 'and', 'for', 'from', 'with', 'payment', 'payments', 'debit', 'credit',
  'purchase', 'transaction', 'transfer', 'deposit', 'withdrawal', 'online', 'card',
  'bank', 'account', 'inc', 'llc', 'com', 'www', 'ref', 'usa', 'recurring', 'pending',
  ...[...REVERSAL_WORDS.source.matchAll(/[a-z]{3,}/g)].map((m) => m[0]),
]);

function terms(description: string): Set<string> {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && /[a-z]/.test(word) && !WEAK_TERMS.has(word));
  return new Set(words);
}

export function findReversals(
  transactions: readonly RawTransaction[],
  options: { windowDays?: number } = {},
): ReversalCandidate[] {
  const windowDays = options.windowDays ?? 90;
  const termsByIndex = transactions.map((t) => terms(t.description));
  const taken = new Set<number>();
  const found: ReversalCandidate[] = [];

  // Earliest first, so a charge is paired with the reversal nearest to it
  // rather than with a later one that happens to match as well.
  const order = transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date) || a.index - b.index);

  for (let i = 0; i < order.length; i += 1) {
    const original = order[i];
    if (taken.has(original.index) || original.transaction.amountCents === 0) continue;

    for (let j = i + 1; j < order.length; j += 1) {
      const later = order[j];
      if (taken.has(later.index)) continue;
      if (later.transaction.amountCents !== -original.transaction.amountCents) continue;

      const daysApart = daysBetween(original.transaction.date, later.transaction.date);
      if (daysApart > windowDays) break;

      const shared = [...termsByIndex[later.index]].filter((term) => termsByIndex[original.index].has(term));
      const saysReversal =
        REVERSAL_WORDS.test(later.transaction.description) || REVERSAL_WORDS.test(original.transaction.description);

      // One shared word is enough where a line says outright that it reverses
      // something. Without that, two are needed: an equal and opposite amount
      // sharing a single common word is a coincidence more often than not.
      const confidence: 'high' | 'medium' | null =
        saysReversal && shared.length >= 1 ? 'high' : shared.length >= 2 ? 'medium' : null;
      if (!confidence) continue;

      taken.add(original.index);
      taken.add(later.index);
      found.push({
        index: later.index,
        originalIndex: original.index,
        daysApart,
        confidence,
        sharedTerms: shared.sort(),
      });
      break;
    }
  }

  return found.sort((a, b) => a.index - b.index);
}
