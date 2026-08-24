import { describe, expect, it } from 'vitest';
import { achOriginator, cardMerchant, countMatches, stripNoise, suggestPayee } from '../payee';

/**
 * These are the shapes a real Chase statement produces. The whole problem is
 * that none of them read the same twice: the vendor is constant and everything
 * around it changes.
 */
describe('ACH debits, where the payer name is buried mid-line', () => {
  it('finds a county water bill', () => {
    const line = 'Orig CO Name:Dekalb CO GA Orig ID:9999999999 Desc Date:0731 CO Entry Descr:Utl Wtrswrsec:CCD Trace#:021000029999 Eed:260731 Ind ID:12345';
    expect(achOriginator(line)).toBe('Dekalb CO GA');
  });

  it('finds the platform on a deposit', () => {
    const line = 'Orig CO Name:Padsplit, Inc. Orig ID:945440567 Desc Date: CO Entry Descr:Padsplit, Sec:CCD Trace#:111 Eed:260707';
    // The trailing period goes; it is punctuation, and matching is substring.
    expect(achOriginator(line)).toBe('Padsplit, Inc');
  });

  it('matches the same vendor next month, when every number has changed', () => {
    const july = 'Orig CO Name:Gas South LLC Orig ID:1111 Desc Date:0715 Trace#:9999 Eed:260715';
    const august = 'Orig CO Name:Gas South LLC Orig ID:2222 Desc Date:0814 Trace#:8888 Eed:260814';
    const rule = achOriginator(july)!;
    expect(august.toLowerCase()).toContain(rule.toLowerCase());
  });
});

describe('card purchases, where the order reference changes every time', () => {
  it('keeps the merchant and drops the order id', () => {
    expect(cardMerchant('Card Purchase 06/30 Amazon.Com*Is6Tv3Bn3 Amzn.Com/Bill WA Card 2804')).toBe('Amazon.Com');
  });

  it('handles a recurring charge', () => {
    expect(cardMerchant('Recurring Card Purchase 07/12 Ahs Ahs.Com Ahs.Com TN Card 2804')).toBe('Ahs');
  });

  it('matches the same merchant on a different day with a different reference', () => {
    const first = 'Card Purchase 06/30 Amazon.Com*Is6Tv3Bn3 Amzn.Com/Bill WA Card 2804';
    const second = 'Card Purchase 07/08 Amazon.Com*125Hw2963 Amzn.Com/Bill WA Card 2804';
    const rule = cardMerchant(first)!;
    expect(second.toLowerCase()).toContain(rule.toLowerCase());
  });

  it('keeps a multi-word merchant', () => {
    expect(cardMerchant('Card Purchase 07/18 Prime Corporate Servic 855-1234567 UT Card 2796')).toBe(
      'Prime Corporate Servic',
    );
  });
});

describe('stripping the parts that never repeat', () => {
  it('removes dates, trace numbers and card suffixes', () => {
    const cleaned = stripNoise('POS DEBIT 07/14 KROGER #482 XXXX2804 GA');
    expect(cleaned).not.toMatch(/07\/14|2804|#482/);
    expect(cleaned).toContain('KROGER');
  });
});

describe('what a rule should match on', () => {
  it('prefers the ACH originator over anything else on the line', () => {
    const suggestion = suggestPayee('Orig CO Name:Dekalb CO GA Orig ID:999 Trace#:111');
    expect(suggestion.match).toBe('Dekalb CO GA');
    expect(suggestion.confidence).toBe('high');
  });

  it('falls back to the distinctive words, skipping the mechanism', () => {
    // "Online Transfer To" describes how, not who.
    const suggestion = suggestPayee('07/03 Online Transfer To Chk ...0977 Transaction#: 22334455');
    expect(suggestion.match.toLowerCase()).not.toMatch(/^online|^transfer/);
  });

  it('never suggests an empty rule', () => {
    expect(suggestPayee('07/14 ###').match.length).toBeGreaterThan(0);
  });
});

describe('showing what a rule would catch', () => {
  it('counts the other rows it would also match', () => {
    const descriptions = [
      'Orig CO Name:Gas South LLC Orig ID:1111',
      'Orig CO Name:Gas South LLC Orig ID:2222',
      'Orig CO Name:Dekalb CO GA Orig ID:3333',
    ];
    expect(countMatches('Gas South', descriptions)).toBe(2);
    expect(countMatches('', descriptions)).toBe(0);
  });
});
