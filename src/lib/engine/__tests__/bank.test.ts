import { describe, expect, it } from 'vitest';
import {
  assertStatementTies,
  checkStatementBalance,
  classify,
  matchRule,
  normalizePayee,
  periodTotals,
  reviewList,
  ruleFromConfirmation,
  StatementDoesNotTieError,
  type PayeeRule,
  type RawTransaction,
} from '../bank';
import { affectsPnl, isIntercompany } from '../categories';
import { cents } from '../money';

const ACCOUNT = 'acct:candace';

const rules: PayeeRule[] = [
  { id: 'r1', bankAccountId: ACCOUNT, match: 'GEORGIA POWER', categoryKey: 'electric' },
  { id: 'r2', bankAccountId: null, match: 'STATE FARM', categoryKey: 'insurance' },
  { id: 'r3', bankAccountId: ACCOUNT, match: 'HOME DEPOT', categoryKey: 'supplies' },
  { id: 'r4', bankAccountId: ACCOUNT, match: 'HOME DEPOT FURNITURE', categoryKey: 'furnishings' },
];

describe('the balance check (§7)', () => {
  const transactions: RawTransaction[] = [
    { date: '2026-06-02', description: 'PADSPLIT DEPOSIT', amountCents: cents(5_100) },
    { date: '2026-06-05', description: 'GEORGIA POWER', amountCents: cents(-320) },
    { date: '2026-06-11', description: 'HOME DEPOT #4412', amountCents: cents(-80) },
  ];

  it('ties when opening + credits − debits equals the closing balance', () => {
    const check = checkStatementBalance({
      openingBalanceCents: cents(1_000),
      closingBalanceCents: cents(5_700),
      transactions,
    });
    expect(check.creditsCents).toBe(cents(5_100));
    expect(check.debitsCents).toBe(cents(400));
    expect(check.tied).toBe(true);
    expect(() => assertStatementTies(check)).not.toThrow();
  });

  it('refuses to post a partial statement rather than silently accepting it', () => {
    const check = checkStatementBalance({
      openingBalanceCents: cents(1_000),
      closingBalanceCents: cents(5_900), // a row is missing from the file
      transactions,
    });
    expect(check.tied).toBe(false);
    expect(check.differenceCents).toBe(cents(-200));
    expect(() => assertStatementTies(check)).toThrow(StatementDoesNotTieError);
  });
});

describe('payee rules (§7)', () => {
  it('matches a substring of the description, case-insensitively', () => {
    expect(matchRule(rules, 'ACH DEBIT georgia power 06/05', ACCOUNT)?.categoryKey).toBe('electric');
  });

  it('prefers the more specific match', () => {
    expect(matchRule(rules, 'HOME DEPOT FURNITURE #22', ACCOUNT)?.categoryKey).toBe('furnishings');
    expect(matchRule(rules, 'HOME DEPOT #4412', ACCOUNT)?.categoryKey).toBe('supplies');
  });

  it('honours priority over specificity', () => {
    const withPriority: PayeeRule[] = [
      ...rules,
      { id: 'r5', bankAccountId: ACCOUNT, match: 'DEPOT', categoryKey: 'capex', priority: 10 },
    ];
    expect(matchRule(withPriority, 'HOME DEPOT #4412', ACCOUNT)?.categoryKey).toBe('capex');
  });

  it('applies an account-scoped rule only to that account', () => {
    expect(matchRule(rules, 'GEORGIA POWER', 'acct:raven')).toBeNull();
    expect(matchRule(rules, 'STATE FARM', 'acct:raven')?.categoryKey).toBe('insurance');
  });

  it('leaves unmatched rows for the review list rather than guessing', () => {
    const classified = classify(
      [
        { date: '2026-06-05', description: 'GEORGIA POWER', amountCents: cents(-320) },
        { date: '2026-06-09', description: 'SOME NEW VENDOR LLC', amountCents: cents(-145) },
      ],
      rules,
      ACCOUNT,
    );
    expect(reviewList(classified)).toHaveLength(1);
    expect(reviewList(classified)[0].description).toBe('SOME NEW VENDOR LLC');
  });

  it('learns a rule from a confirmed row, stripping the volatile parts', () => {
    const rule = ruleFromConfirmation({
      description: 'ACH DEBIT SOME NEW VENDOR LLC 06/09 #883120',
      categoryKey: 'lawn',
      bankAccountId: ACCOUNT,
    });
    expect(rule.match).toBe('ACH DEBIT SOME NEW VENDOR LLC');
    expect(rule.categoryKey).toBe('lawn');
  });

  it('refuses to learn a rule for a category that does not exist', () => {
    expect(() =>
      ruleFromConfirmation({ description: 'X', categoryKey: 'not_a_category', bankAccountId: null }),
    ).toThrow();
  });

  it('normalizes card suffixes and reference numbers out of a payee', () => {
    expect(normalizePayee('POS PURCHASE XXXX1234 KROGER 08/14')).toBe('POS PURCHASE KROGER');
  });
});

describe('categories that need care (§7)', () => {
  it('keeps security deposits out of the P&L so a move-in month shows no phantom revenue', () => {
    const totals = periodTotals(
      classify(
        [
          { date: '2026-06-01', description: 'RENT', amountCents: cents(1_600) },
          { date: '2026-06-01', description: 'DEPOSIT HELD', amountCents: cents(1_600) },
        ],
        [
          { id: 'a', bankAccountId: null, match: 'RENT', categoryKey: 'rental_income' },
          { id: 'b', bankAccountId: null, match: 'DEPOSIT HELD', categoryKey: 'security_deposit_received' },
        ],
        null,
      ),
    );
    expect(totals.incomeCents).toBe(cents(1_600));
    expect(totals.excludedCents).toBe(cents(1_600));
    expect(totals.depositsHeldDeltaCents).toBe(cents(1_600));
  });

  it('keeps a returned deposit out of the P&L so a move-out month shows no phantom loss', () => {
    const totals = periodTotals(
      classify(
        [{ date: '2026-06-30', description: 'DEPOSIT REFUND', amountCents: cents(-1_600) }],
        [{ id: 'a', bankAccountId: null, match: 'DEPOSIT REFUND', categoryKey: 'security_deposit_returned' }],
        null,
      ),
    );
    expect(totals.expenseCents).toBe(0);
    expect(totals.depositsHeldDeltaCents).toBe(cents(-1_600));
  });

  it('lets a foreign charge be flagged rather than force-assigned to the property', () => {
    expect(affectsPnl('not_portfolio')).toBe(false);
    const totals = periodTotals(
      classify(
        [{ date: '2026-06-14', description: 'AUTOPAY WRONG CARD', amountCents: cents(-210) }],
        [{ id: 'a', bankAccountId: null, match: 'AUTOPAY WRONG CARD', categoryKey: 'not_portfolio' }],
        null,
      ),
    );
    expect(totals.expenseCents).toBe(0);
    expect(totals.excludedCents).toBe(cents(-210));
  });

  it('marks an operator management fee as intercompany so it is not both a cost and a receipt', () => {
    expect(isIntercompany('operator_management_fee')).toBe(true);
    expect(isIntercompany('maintenance_repairs')).toBe(false);
  });

  it('nets income against expense for the period', () => {
    const totals = periodTotals(
      classify(
        [
          { date: '2026-06-02', description: 'PADSPLIT', amountCents: cents(5_100) },
          { date: '2026-06-05', description: 'GEORGIA POWER', amountCents: cents(-320) },
          { date: '2026-06-06', description: 'TRANSFER TO SAVINGS', amountCents: cents(-1_000) },
        ],
        [
          { id: 'a', bankAccountId: null, match: 'PADSPLIT', categoryKey: 'padsplit_deposit' },
          { id: 'b', bankAccountId: null, match: 'GEORGIA POWER', categoryKey: 'electric' },
          { id: 'c', bankAccountId: null, match: 'TRANSFER TO SAVINGS', categoryKey: 'transfer_between_own_accounts' },
        ],
        null,
      ),
    );
    expect(totals.incomeCents).toBe(cents(5_100));
    expect(totals.expenseCents).toBe(cents(320));
    expect(totals.netCashCents).toBe(cents(4_780));
  });
});
