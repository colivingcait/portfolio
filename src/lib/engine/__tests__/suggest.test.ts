import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../categories';
import { historyIndex, payeeKey, suggestCategory } from '../suggest';

const catalog = CATEGORIES;

const debit = (description: string, dollars = 100) => ({ description, amountCents: -dollars * 100 });
const credit = (description: string, dollars = 100) => ({ description, amountCents: dollars * 100 });

describe('what a payee obviously is', () => {
  it('reads a mortgage servicer off the description', () => {
    const s = suggestCategory(debit('WELLS FARGO HOME MTG 08/01 XXXXXX1234'), { catalog });
    expect(s.categoryKey).toBe('debt_service');
    expect(s.source).toBe('payee');
  });

  it('recognises the servicers that do not say mortgage', () => {
    for (const payee of ['MR COOPER', 'PENNYMAC LOAN SERVICES', 'SHELLPOINT MTG SERVICING', 'CENLAR FSB']) {
      expect(suggestCategory(debit(payee), { catalog }).categoryKey).toBe('debt_service');
    }
  });

  it('does not call a mortgage refund a payment', () => {
    // Direction is set on this entry because a credit from a servicer is an
    // escrow refund, not a payment going out.
    expect(suggestCategory(credit('MR COOPER ESCROW REFUND'), { catalog }).categoryKey).not.toBe('debt_service');
  });

  it('separates the power company from the electrician', () => {
    expect(suggestCategory(debit('GEORGIA POWER 123456'), { catalog }).categoryKey).toBe('electric');
    expect(suggestCategory(debit('MIKES ELECTRICAL SERVICE'), { catalog }).categoryKey).toBe('maintenance_repairs');
    expect(suggestCategory(debit('ACE ELECTRICIAN LLC'), { catalog }).categoryKey).toBe('maintenance_repairs');
  });

  it('files the utilities a coliving house actually pays', () => {
    expect(suggestCategory(debit('DEKALB CO WATER & SEWER'), { catalog }).categoryKey).toBe('water_sewer');
    expect(suggestCategory(debit('ATLANTA GAS LIGHT'), { catalog }).categoryKey).toBe('gas');
    expect(suggestCategory(debit('WASTE MANAGEMENT WM EZPAY'), { catalog }).categoryKey).toBe('trash');
    expect(suggestCategory(debit('COMCAST XFINITY'), { catalog }).categoryKey).toBe('internet');
  });

  it('knows a hardware run from a repair invoice', () => {
    expect(suggestCategory(debit('THE HOME DEPOT #0121'), { catalog }).categoryKey).toBe('supplies');
    expect(suggestCategory(debit('ROTO ROOTER PLUMBING'), { catalog }).categoryKey).toBe('maintenance_repairs');
  });

  it('reads a PadSplit payout as income only when money came in', () => {
    expect(suggestCategory(credit('PADSPLIT INC PAYOUT'), { catalog }).categoryKey).toBe('padsplit_deposit');
    expect(suggestCategory(debit('PADSPLIT INC CHARGEBACK'), { catalog }).categoryKey).not.toBe('padsplit_deposit');
  });

  it('says why, so a wrong guess can be argued with', () => {
    expect(suggestCategory(debit('GEORGIA POWER'), { catalog }).reason).toContain('power company');
  });
});

describe('falling back on the direction of the money', () => {
  it('keeps the old two guesses when nothing else knows', () => {
    const out = suggestCategory(debit('SQ *UNKNOWN VENDOR 4471'), { catalog });
    expect(out.categoryKey).toBe('maintenance_repairs');
    expect(out.source).toBe('direction');
    expect(out.confidence).toBe('low');

    expect(suggestCategory(credit('ZELLE FROM SOMEBODY'), { catalog }).categoryKey).toBe('rental_income');
  });
});

describe('learning from what has already been filed', () => {
  const history = historyIndex([
    { description: 'CITY UTILITIES DRAFT 08/01', categoryKey: 'water_sewer', count: 5 },
    { description: 'CITY UTILITIES DRAFT 09/01', categoryKey: 'water_sewer', count: 4 },
    { description: 'THE HOME DEPOT #0121 04/12', categoryKey: 'capex', count: 6 },
  ]);

  it('matches on the payee stem, not the whole line', () => {
    // The dates differ on every row; the stem is what recurs.
    expect(payeeKey('CITY UTILITIES DRAFT 08/01')).toBe(payeeKey('CITY UTILITIES DRAFT 11/30'));
  });

  it('beats the lexicon once a payee is settled', () => {
    // Home Depot reads as supplies by name, but this landlord has filed it as
    // capex six times. What you do outranks what the name suggests.
    const out = suggestCategory(debit('THE HOME DEPOT #0121 12/02'), { catalog, history });
    expect(out.categoryKey).toBe('capex');
    expect(out.source).toBe('history');
    expect(out.confidence).toBe('high');
    expect(out.reason).toContain('6');
  });

  it('counts every row behind a stem, not just the last one', () => {
    const out = suggestCategory(debit('CITY UTILITIES DRAFT 12/01'), { catalog, history });
    expect(out.categoryKey).toBe('water_sewer');
    expect(out.reason).toContain('9');
  });

  it('drops to medium and says so when a payee has been filed two ways', () => {
    const split = historyIndex([
      { description: 'AMAZON MKTPL', categoryKey: 'supplies', count: 3 },
      { description: 'AMAZON MKTPL', categoryKey: 'furnishings', count: 2 },
    ]);
    const out = suggestCategory(debit('AMAZON MKTPL'), { catalog, history: split });
    expect(out.confidence).toBe('medium');
    expect(out.reason).toBe('3 of 5 like this were filed as Supplies');
  });

  it('ignores history for a category that no longer exists', () => {
    const stale = historyIndex([{ description: 'GEORGIA POWER', categoryKey: 'deleted_key', count: 9 }]);
    expect(suggestCategory(debit('GEORGIA POWER'), { catalog, history: stale }).categoryKey).toBe('electric');
  });
});

describe('a reversal outranks everything', () => {
  it('puts both halves in the same category so they net to nothing', () => {
    const out = suggestCategory(credit('RETURNED ITEM FEE REVERSAL'), { catalog, reversalKey: 'bank_fee' });
    expect(out.categoryKey).toBe('bank_fee');
    expect(out.source).toBe('reversal');
    expect(out.confidence).toBe('high');
  });

  it('is ignored when the row it points at names a category that is gone', () => {
    const out = suggestCategory(credit('GEORGIA POWER REFUND'), { catalog, reversalKey: 'deleted_key' });
    expect(out.categoryKey).toBe('electric');
  });
});
