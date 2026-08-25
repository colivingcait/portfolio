import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../categories';
import { buildBalanceSheet, buildPnl, type LedgerLine } from '../statements';
import { cents } from '../money';

const MONTHS = ['2026-06', '2026-07'];
const P = 'property:raven';

const line = (month: string, categoryKey: string | null, dollars: number): LedgerLine => ({
  month,
  propertyId: P,
  categoryKey,
  amountCents: cents(dollars),
});

describe('the profit and loss', () => {
  it('splits income from cost and nets them per month', () => {
    const pnl = buildPnl(
      [
        line('2026-06', 'rental_income', 5_000),
        line('2026-06', 'electric', -300),
        line('2026-07', 'rental_income', 5_200),
        line('2026-07', 'electric', -280),
        line('2026-07', 'lawn', -120),
      ],
      MONTHS, { catalog: CATEGORIES },
    );

    expect(pnl.incomeByMonth['2026-06']).toBe(cents(5_000));
    expect(pnl.expenseByMonth['2026-07']).toBe(cents(400));
    expect(pnl.netByMonth['2026-06']).toBe(cents(4_700));
    expect(pnl.netCents).toBe(cents(9_500));
  });

  it('shows expenses as positive figures, the section carrying the sign', () => {
    const pnl = buildPnl([line('2026-06', 'electric', -300)], MONTHS, { catalog: CATEGORIES });
    expect(pnl.expenses[0]).toMatchObject({ categoryKey: 'electric', label: 'Electric', totalCents: cents(300) });
  });

  it('keeps a security deposit out of income', () => {
    // Cash in the account, not a penny of it earned. Counting it would make a
    // good month out of a quiet one.
    const pnl = buildPnl(
      [line('2026-06', 'rental_income', 1_000), line('2026-06', 'security_deposit_received', 1_500)],
      MONTHS, { catalog: CATEGORIES },
    );
    expect(pnl.totalIncomeCents).toBe(cents(1_000));
    expect(pnl.excludedCents).toBe(cents(1_500));
  });

  it('keeps owner draws and transfers out of both sides', () => {
    const pnl = buildPnl(
      [line('2026-06', 'owner_draw', -2_000), line('2026-06', 'transfer_between_own_accounts', -500)],
      MONTHS, { catalog: CATEGORIES },
    );
    expect(pnl.totalExpenseCents).toBe(0);
    expect(pnl.excludedCents).toBe(cents(-2_500));
  });

  it('counts uncategorized rows apart, so a total is never quietly short', () => {
    const pnl = buildPnl([line('2026-06', null, -400)], MONTHS, { catalog: CATEGORIES });
    expect(pnl.uncategorizedCount).toBe(1);
    expect(pnl.uncategorizedCents).toBe(cents(-400));
    expect(pnl.totalExpenseCents).toBe(0);
  });

  it('drops an intercompany fee from a consolidated view', () => {
    const lines = [line('2026-06', 'rental_income', 5_000), line('2026-06', 'operator_management_fee', -500)];
    expect(buildPnl(lines, MONTHS, { catalog: CATEGORIES }).totalExpenseCents).toBe(cents(500));
    expect(buildPnl(lines, MONTHS, { catalog: CATEGORIES, consolidated: true }).totalExpenseCents).toBe(0);
  });

  it('ignores months outside the range asked for', () => {
    const pnl = buildPnl([line('2025-12', 'rental_income', 9_999), line('2026-06', 'rental_income', 100)], MONTHS, { catalog: CATEGORIES });
    expect(pnl.totalIncomeCents).toBe(cents(100));
  });

  it('sorts the biggest lines to the top', () => {
    const pnl = buildPnl(
      [line('2026-06', 'lawn', -100), line('2026-06', 'electric', -900), line('2026-06', 'trash', -300)],
      MONTHS, { catalog: CATEGORIES },
    );
    expect(pnl.expenses.map((r) => r.categoryKey)).toEqual(['electric', 'trash', 'lawn']);
  });
});

describe('the balance sheet', () => {
  const base = {
    properties: [{ propertyId: P, propertyName: 'Raven', costCents: cents(200_000), valueCents: cents(260_000), debtCents: cents(145_000) }],
    cash: [{ accountId: 'a1', label: 'Operating', balanceCents: cents(8_000), asOf: '2026-07-31' }],
    depositsHeldCents: cents(1_500),
    contributionsCents: cents(120_000),
    distributionsCents: cents(30_000),
  };

  it('carries a property at its valuation on a market basis', () => {
    const sheet = buildBalanceSheet(base, 'market');
    expect(sheet.totalAssetsCents).toBe(cents(268_000));
    expect(sheet.totalLiabilitiesCents).toBe(cents(146_500));
    expect(sheet.netWorthCents).toBe(cents(121_500));
  });

  it('carries it at cost on a cost basis, which is what a tax return uses', () => {
    expect(buildBalanceSheet(base, 'cost').totalAssetsCents).toBe(cents(208_000));
  });

  it('treats a deposit held as a liability, because it is someone else’s money', () => {
    expect(buildBalanceSheet(base).liabilities.some((l) => l.label === 'Security deposits held')).toBe(true);
  });

  it('balances by construction: contributions less distributions plus retained equals net worth', () => {
    const sheet = buildBalanceSheet(base);
    const equity = sheet.equity.reduce((sum, line) => sum + line.amountCents, 0);
    expect(equity).toBe(sheet.netWorthCents);
  });

  it('says out loud when a property is carried at zero', () => {
    const sheet = buildBalanceSheet({
      ...base,
      properties: [{ propertyId: 'p2', propertyName: 'Unpriced', costCents: null, valueCents: null, debtCents: 0 }],
    });
    expect(sheet.warnings.join(' ')).toContain('Unpriced');
    expect(sheet.warnings.join(' ')).toContain('understated');
  });

  it('falls back to cost where no valuation exists, and says so on the line', () => {
    const sheet = buildBalanceSheet({
      ...base,
      properties: [{ propertyId: P, propertyName: 'Raven', costCents: cents(200_000), valueCents: null, debtCents: 0 }],
    });
    expect(sheet.assets[0]).toMatchObject({ amountCents: cents(200_000), detail: 'no valuation — shown at cost' });
    expect(sheet.warnings).toEqual([]);
  });

  it('flags an account with no statement rather than showing a confident zero', () => {
    const sheet = buildBalanceSheet({
      ...base,
      cash: [{ accountId: 'a2', label: 'Reserve', balanceCents: 0, asOf: null }],
    });
    expect(sheet.warnings.join(' ')).toContain('no posted statement');
  });
});
