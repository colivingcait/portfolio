import { describe, expect, it } from 'vitest';
import { detectColumns, parseAmount, parseCsv, parseDate, parseStatement } from '../csv';
import { cents } from '../../engine/money';

describe('CSV parsing', () => {
  it('handles quoted fields containing commas', () => {
    const rows = parseCsv('Date,Description,Amount\n01/02/2026,"ACME, INC PAYMENT",-45.00\n');
    expect(rows[1]).toEqual(['01/02/2026', 'ACME, INC PAYMENT', '-45.00']);
  });

  it('handles escaped quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿Date,Description\r\n01/02/2026,"SAY ""HI"" LLC"\r\n');
    expect(rows[0][0]).toBe('Date');
    expect(rows[1][1]).toBe('SAY "HI" LLC');
  });

  it('drops entirely blank lines rather than emitting empty rows', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toHaveLength(2);
  });
});

describe('column detection', () => {
  it('finds the usual names', () => {
    const columns = detectColumns(['Posted Date', 'Description', 'Amount', 'Running Balance']);
    expect(columns.date).toBe(0);
    expect(columns.description).toBe(1);
    expect(columns.amount).toBe(2);
    expect(columns.balance).toBe(3);
  });

  it('finds separate debit and credit columns', () => {
    const columns = detectColumns(['Date', 'Payee', 'Withdrawal', 'Deposit', 'Balance']);
    expect(columns.debit).toBe(2);
    expect(columns.credit).toBe(3);
    expect(columns.amount).toBe(-1);
  });

  it('prefers an exact header match over a partial one', () => {
    const columns = detectColumns(['Date', 'Description', 'Transaction Amount', 'Amount']);
    expect(columns.amount).toBe(3);
  });
});

describe('date formats', () => {
  it('reads the formats banks actually emit', () => {
    expect(parseDate('01/02/2026')).toBe('2026-01-02'); // US ordering
    expect(parseDate('1/2/26')).toBe('2026-01-02');
    expect(parseDate('2026-01-02')).toBe('2026-01-02');
    expect(parseDate('02-Jan-2026')).toBe('2026-01-02');
    expect(parseDate('Jan 2, 2026')).toBe('2026-01-02');
  });

  it('returns null rather than guessing at nonsense', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('02-Xxx-2026')).toBeNull();
  });
});

describe('amount formats', () => {
  it('reads currency, separators and both negative conventions', () => {
    expect(parseAmount('$1,234.56')).toBe(cents(1234.56));
    expect(parseAmount('-45.00')).toBe(cents(-45));
    expect(parseAmount('(45.00)')).toBe(cents(-45));
    expect(parseAmount('45.00-')).toBe(cents(-45));
    expect(parseAmount('0')).toBe(0);
  });

  it('returns null for a blank or unreadable cell', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
  });
});

describe('parseStatement', () => {
  const singleAmountColumn = [
    'Posted Date,Description,Amount,Running Balance',
    '06/02/2026,PADSPLIT HOST PAYOUT,"5,100.00","6,100.00"',
    '06/05/2026,GEORGIA POWER 06/05,-320.00,"5,780.00"',
    '06/11/2026,HOME DEPOT #4412,-80.00,"5,700.00"',
  ].join('\n');

  it('normalises to credits positive, debits negative', () => {
    const parsed = parseStatement(singleAmountColumn);
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0].amountCents).toBe(cents(5_100));
    expect(parsed.transactions[1].amountCents).toBe(cents(-320));
  });

  it('derives opening and closing balances from a running balance column', () => {
    const parsed = parseStatement(singleAmountColumn);
    expect(parsed.impliedOpeningBalanceCents).toBe(cents(1_000));
    expect(parsed.impliedClosingBalanceCents).toBe(cents(5_700));
  });

  it('combines separate debit and credit columns', () => {
    const parsed = parseStatement(
      [
        'Date,Description,Withdrawal,Deposit',
        '06/02/2026,PADSPLIT HOST PAYOUT,,5100.00',
        '06/05/2026,GEORGIA POWER,320.00,',
      ].join('\n'),
    );
    expect(parsed.transactions[0].amountCents).toBe(cents(5_100));
    expect(parsed.transactions[1].amountCents).toBe(cents(-320));
  });

  it('reports unreadable rows instead of dropping them silently', () => {
    const parsed = parseStatement(
      [
        'Date,Description,Amount',
        '06/02/2026,GOOD ROW,100.00',
        'Totals,,,',
        ',ORPHAN ROW,50.00',
      ].join('\n'),
    );
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.skipped).toHaveLength(2);
    expect(parsed.skipped[0].reason).toBe('no readable date');
  });

  it('leaves a missing description labelled rather than blank', () => {
    const parsed = parseStatement('Date,Description,Amount\n06/02/2026,,100.00');
    expect(parsed.transactions[0].description).toBe('(no description)');
  });

  it('can flip the sign for exports that state direction elsewhere', () => {
    const parsed = parseStatement('Date,Description,Amount\n06/05/2026,GEORGIA POWER,320.00', { flipSign: true });
    expect(parsed.transactions[0].amountCents).toBe(cents(-320));
  });

  it('returns an empty result for an empty file rather than throwing', () => {
    expect(parseStatement('').transactions).toEqual([]);
  });
});
