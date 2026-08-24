import { describe, expect, it } from 'vitest';
import { findAccountNumbers, findPeriod, last4FromFilename, matchAccount, readHints, type AccountCandidate } from '../detect';

const accounts: AccountCandidate[] = [
  { id: 'raven', label: 'Raven', propertyName: '466 Raven Springs Trail', propertyAddress: '466 Raven Springs Trail', institution: 'Chase', last4: '0985' },
  { id: 'candace', label: 'Candace', propertyName: '1939 Candace Lane SE', propertyAddress: '1939 Candace Lane SE', institution: 'Chase', last4: '4412' },
];

describe('finding the account a statement is for', () => {
  it('takes the number from the statement header', () => {
    const found = findAccountNumbers('JPMorgan Chase Bank, N.A.\nAccount Number: 000000123450985');
    expect(found.primary).toContain('0985');
  });

  it('keeps a linked account mentioned in the body well away from the header', () => {
    // "Your account ending in 6370 is linked to this account for overdraft
    // protection" is a different account, and routing on it would misfile.
    const found = findAccountNumbers('Account Number: 000000123450985\nYour account ending in 6370 is linked to this account');
    expect(found.primary).toContain('0985');
    expect(found.primary).not.toContain('6370');
    expect(found.secondary).toContain('6370');
  });

  it('reads four digits out of a downloaded filename, ignoring the date in it', () => {
    expect(last4FromFilename('20260731statements0985.pdf')).toContain('0985');
    expect(last4FromFilename('20260731statements0985.pdf')).not.toContain('2026');
  });
});

describe('the period a statement covers', () => {
  it('reads "July 01, 2026 through July 31, 2026"', () => {
    expect(findPeriod('July 01, 2026 through July 31, 2026')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('reads a slashed range', () => {
    expect(findPeriod('Statement period 06/01/2026 - 06/30/2026')).toEqual({ start: '2026-06-01', end: '2026-06-30' });
  });

  it('reports nothing rather than half a period', () => {
    expect(findPeriod('no dates here at all')).toEqual({ start: null, end: null });
  });
});

describe('routing a file to an account', () => {
  it('is certain when the account number matches', () => {
    const match = matchAccount(readHints('Account Number: 000000123450985'), accounts);
    expect(match.accountId).toBe('raven');
    expect(match.confidence).toBe('certain');
  });

  it('falls back to the property named in the body', () => {
    // Chase statements carry the LLC's mailing address, not the property's —
    // but the ACH payer name in a deposit line often names the property.
    const match = matchAccount(readHints('Ind Name:466 Raven Springs LLC Trn: 188'), accounts);
    expect(match.accountId).toBe('raven');
    expect(match.confidence).toBe('likely');
  });

  it('does not route on the institution alone, since several accounts share one', () => {
    const match = matchAccount(readHints('JPMorgan Chase Bank, N.A.'), accounts);
    expect(match.confidence).toBe('ambiguous');
    expect(match.accountId).toBeNull();
  });

  it('says what to fix when the number matches nothing on file', () => {
    const match = matchAccount(readHints('Account Number: 000000123459999'), accounts.map((a) => ({ ...a, last4: null, propertyAddress: null })));
    expect(match.accountId).toBeNull();
    expect(match.reason).toContain('9999');
    expect(match.reason).toContain('Settings');
  });

  it('uses the filename when the document itself is unhelpful', () => {
    const match = matchAccount(readHints('a statement with nothing useful in it', '20260731statements0985.pdf'), accounts);
    expect(match.accountId).toBe('raven');
  });

  it('reports having nowhere to route to when no accounts exist', () => {
    expect(matchAccount(readHints('anything'), []).confidence).toBe('none');
  });
});
