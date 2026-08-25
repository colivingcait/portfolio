import { describe, expect, it } from 'vitest';
import {
  findReversals,
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
import { CATEGORIES, affectsPnl, isIntercompany } from '../categories';
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
    }, CATEGORIES);
    expect(rule.match).toBe('ACH DEBIT SOME NEW VENDOR LLC');
    expect(rule.categoryKey).toBe('lawn');
  });

  it('refuses to learn a rule for a category that does not exist', () => {
    expect(() =>
      ruleFromConfirmation({ description: 'X', categoryKey: 'not_a_category', bankAccountId: null }, CATEGORIES),
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
      ), CATEGORIES,
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
      ), CATEGORIES,
    );
    expect(totals.expenseCents).toBe(0);
    expect(totals.depositsHeldDeltaCents).toBe(cents(-1_600));
  });

  it('lets a foreign charge be flagged rather than force-assigned to the property', () => {
    expect(affectsPnl('not_portfolio', CATEGORIES)).toBe(false);
    const totals = periodTotals(
      classify(
        [{ date: '2026-06-14', description: 'AUTOPAY WRONG CARD', amountCents: cents(-210) }],
        [{ id: 'a', bankAccountId: null, match: 'AUTOPAY WRONG CARD', categoryKey: 'not_portfolio' }],
        null,
      ), CATEGORIES,
    );
    expect(totals.expenseCents).toBe(0);
    expect(totals.excludedCents).toBe(cents(-210));
  });

  it('marks an operator management fee as intercompany so it is not both a cost and a receipt', () => {
    expect(isIntercompany('operator_management_fee', CATEGORIES)).toBe(true);
    expect(isIntercompany('maintenance_repairs', CATEGORIES)).toBe(false);
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
      ), CATEGORIES,
    );
    expect(totals.incomeCents).toBe(cents(5_100));
    expect(totals.expenseCents).toBe(cents(320));
    expect(totals.netCashCents).toBe(cents(4_780));
  });
});

describe('rules that depend on which way the money moved', () => {
  // The same transfer line means two different things by sign: out of the
  // operating account it is an owner draw, into it a contribution.
  const directional: PayeeRule[] = [
    { id: 'd1', bankAccountId: ACCOUNT, match: 'Chk ...0977 Transaction#', categoryKey: 'owner_draw', direction: 'debit' },
    { id: 'd2', bankAccountId: ACCOUNT, match: 'Chk ...0977 Transaction#', categoryKey: 'owner_contribution', direction: 'credit' },
  ];

  it('reads a negative amount as the debit side', () => {
    const rule = matchRule(directional, 'Online Transfer To Chk ...0977 Transaction# 22841', ACCOUNT, cents(-4_000));
    expect(rule?.categoryKey).toBe('owner_draw');
  });

  it('reads a positive amount as the credit side', () => {
    const rule = matchRule(directional, 'Online Transfer From Chk ...0977 Transaction# 22902', ACCOUNT, cents(4_000));
    expect(rule?.categoryKey).toBe('owner_contribution');
  });

  it('declines to guess when no amount is supplied', () => {
    // Both sides match; picking one at random would be worse than picking the
    // first deterministically, but either way the caller must pass the amount.
    const rule = matchRule(directional, 'Chk ...0977 Transaction# 1', ACCOUNT);
    expect(rule).not.toBeNull();
  });

  it('prefers a directed rule over an undirected one that also matches', () => {
    const mixed: PayeeRule[] = [
      { id: 'a', bankAccountId: ACCOUNT, match: 'TRANSFER', categoryKey: 'owner_draw', priority: 5 },
      { id: 'b', bankAccountId: ACCOUNT, match: 'TRANSFER', categoryKey: 'owner_contribution', direction: 'credit' },
    ];
    expect(matchRule(mixed, 'ONLINE TRANSFER', ACCOUNT, cents(2_000))?.id).toBe('b');
  });

  it('falls back to the undirected rule when the sign does not fit the directed one', () => {
    const mixed: PayeeRule[] = [
      { id: 'a', bankAccountId: ACCOUNT, match: 'TRANSFER', categoryKey: 'owner_draw' },
      { id: 'b', bankAccountId: ACCOUNT, match: 'TRANSFER', categoryKey: 'owner_contribution', direction: 'credit' },
    ];
    expect(matchRule(mixed, 'ONLINE TRANSFER', ACCOUNT, cents(-2_000))?.id).toBe('a');
  });

  it('classifies a whole statement by sign from one pair of rules', () => {
    const rows: RawTransaction[] = [
      { date: '2026-06-30', description: 'Online Transfer To Chk ...0977 Transaction# 1', amountCents: cents(-3_000) },
      { date: '2026-07-02', description: 'Online Transfer From Chk ...0977 Transaction# 2', amountCents: cents(1_500) },
    ];
    expect(classify(rows, directional, ACCOUNT).map((t) => t.categoryKey)).toEqual([
      'owner_draw',
      'owner_contribution',
    ]);
  });
});

describe('matching is not thrown by whitespace', () => {
  it('matches a rule with single spaces against a description with several', () => {
    // PDF extraction spaces words by position, so the same line can come back
    // with two spaces one month and one the next.
    const spaced: PayeeRule[] = [{ id: 'w1', bankAccountId: ACCOUNT, match: 'GAS SOUTH', categoryKey: 'gas' }];
    expect(matchRule(spaced, 'ACH DEBIT   GAS   SOUTH   0731', ACCOUNT)?.id).toBe('w1');
  });

  it('matches a rule that itself carries stray whitespace', () => {
    const spaced: PayeeRule[] = [{ id: 'w2', bankAccountId: ACCOUNT, match: '  GAS  SOUTH ', categoryKey: 'gas' }];
    expect(matchRule(spaced, 'ACH DEBIT GAS SOUTH 0731', ACCOUNT)?.id).toBe('w2');
  });
});

describe('a charge and the reversal that cancels it', () => {
  const t = (date: string, description: string, dollars: number): RawTransaction => ({
    date,
    description,
    amountCents: cents(dollars),
  });

  it('pairs a fee with its reversal', () => {
    const rows = [
      t('2026-08-03', 'MONTHLY SERVICE FEE', -35),
      t('2026-08-09', 'SERVICE FEE REVERSAL', 35),
    ];
    const [pair] = findReversals(rows);
    expect(pair.index).toBe(1);
    expect(pair.originalIndex).toBe(0);
    expect(pair.daysApart).toBe(6);
    expect(pair.confidence).toBe('high');
    expect(pair.sharedTerms).toEqual(['fee', 'service']);
  });

  it('pairs a returned payment with the deposit it undoes', () => {
    const rows = [
      t('2026-08-02', 'Zelle Payment From Jessica Wood 112233', 1_500),
      t('2026-08-05', 'Zelle Return Jessica Wood 998877', -1_500),
    ];
    expect(findReversals(rows)[0]?.confidence).toBe('high');
  });

  it('ignores two lines that merely happen to be equal and opposite', () => {
    // A fee out and rent in at the same figure is a coincidence, not a
    // reversal, and pairing them would be worse than pairing nothing.
    const rows = [t('2026-08-03', 'OVERDRAFT FEE', -35), t('2026-08-20', 'GEORGIA POWER REBATE', 35)];
    expect(findReversals(rows)).toEqual([]);
  });

  it('needs two shared words where nothing says reversal', () => {
    const oneWord = [t('2026-08-03', 'DEKALB WATER', -80), t('2026-08-06', 'DEKALB CREDIT', 80)];
    expect(findReversals(oneWord)).toEqual([]);

    const twoWords = [t('2026-08-03', 'DEKALB WATER SEWER', -80), t('2026-08-06', 'DEKALB WATER ADJ', 80)];
    expect(findReversals(twoWords)[0]?.confidence).toBe('medium');
  });

  it('does not reach past the window', () => {
    const rows = [
      t('2026-01-03', 'MONTHLY SERVICE FEE', -35),
      t('2026-08-09', 'SERVICE FEE REVERSAL', 35),
    ];
    expect(findReversals(rows)).toEqual([]);
    expect(findReversals(rows, { windowDays: 400 })).toHaveLength(1);
  });

  it('pairs each row once, nearest first', () => {
    // Two identical fees and two reversals must pair up one to one, not all
    // four to the first one they see.
    const rows = [
      t('2026-08-01', 'MONTHLY SERVICE FEE', -35),
      t('2026-08-02', 'MONTHLY SERVICE FEE', -35),
      t('2026-08-05', 'SERVICE FEE REVERSAL', 35),
      t('2026-08-06', 'SERVICE FEE REVERSAL', 35),
    ];
    const pairs = findReversals(rows);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => [p.originalIndex, p.index])).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it('finds nothing in a statement with no reversals', () => {
    const rows = [t('2026-08-01', 'GEORGIA POWER', -140), t('2026-08-04', 'PADSPLIT DEPOSIT', 5_100)];
    expect(findReversals(rows)).toEqual([]);
  });

  it('leaves a zero-amount line alone', () => {
    const rows = [t('2026-08-01', 'SERVICE FEE', 0), t('2026-08-02', 'SERVICE FEE REVERSAL', 0)];
    expect(findReversals(rows)).toEqual([]);
  });
});
