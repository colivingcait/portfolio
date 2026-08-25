import { describe, expect, it } from 'vitest';
import { achOriginator, cardMerchant, countMatches, stripNoise, suggestPayee,
  asLiteralFragment,
  repairMatch,
} from '../payee';

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

describe('a suggestion has to appear in the line it came from', () => {
  // The rule that broke this: stripping noise from the MIDDLE of a line left
  // words that were never adjacent joined together, and the rule matched
  // nothing — not even the transaction it was written from. Every shape here
  // is one where a word gets removed from between two words worth keeping.
  const LINES = [
    'Zelle Payment To Jessica Wood 23482748291',
    'Zelle Payment To Jessica Wood JPM99AB3XYZ',
    'Zelle Payment From Jessica Wood 23482748291',
    'Online Transfer To Jessica Wood 12345678',
    'ACH Debit DEKALB CO GA WATER SEWER 073126',
    'Orig CO Name:Gas South Orig ID:9999999999 Desc Date:0731 CO Entry Descr:UTILITY',
    'Card Purchase 06/30 Amazon.Com*Is6Tv3Bn3 Amzn.Com/Bill WA Card 2804',
    'Recurring Card Purchase 07/01 Ahs Ahs.Com 888-4297400 TN Card 2804',
    'GEORGIA POWER PAYMENT 073126 WEB ID 1234567',
    'Online Transfer To Chk ...0977 Transaction# 22841',
    'PADSPLIT INC PAYOUT 07/31 TRACE#123456789',
    '07/15 ATM WITHDRAWAL 000012345 SOME ST ATLANTA GA',
  ];

  it.each(LINES)('is a literal substring of %s', (line) => {
    const { match } = suggestPayee(line);
    expect(match.length).toBeGreaterThan(0);
    expect(line.toLowerCase().replace(/\s+/g, ' ')).toContain(match.toLowerCase());
  });

  it('names the person on a Zelle payment, not Zelle', () => {
    expect(suggestPayee('Zelle Payment To Jessica Wood 23482748291').match).toBe('Jessica Wood');
  });

  it('gives the same rule for money out and money in to the same person', () => {
    // Otherwise a refund from Jessica needs its own rule, and the pair of
    // directional rules written on confirmation would not line up.
    expect(suggestPayee('Zelle Payment To Jessica Wood 23482748291').match).toBe(
      suggestPayee('Zelle Payment From Jessica Wood 99887766').match,
    );
  });

  it('survives a reference code changing between months', () => {
    expect(suggestPayee('Zelle Payment To Jessica Wood JPM99AB3XYZ').match).toBe(
      suggestPayee('Zelle Payment To Jessica Wood JPM40ZZ9QQQ').match,
    );
  });
});

describe('reducing a candidate to something literal', () => {
  it('keeps a candidate that already appears in the line', () => {
    expect(asLiteralFragment('Gas South', 'Orig CO Name:Gas South Orig ID:1')).toBe('Gas South');
  });

  it('drops back to the longest run that does appear', () => {
    expect(asLiteralFragment('Zelle Jessica Wood', 'Zelle Payment To Jessica Wood 1')).toBe('Jessica Wood');
  });

  it('returns null when not one word of the candidate is in the line', () => {
    expect(asLiteralFragment('Georgia Power', 'AHS HOME WARRANTY')).toBeNull();
  });

  it('ignores how the whitespace was spaced', () => {
    expect(asLiteralFragment('Gas South', 'ACH   Gas   South   Payment')).toBe('Gas South');
  });
});

describe('mending a rule that catches nothing', () => {
  const lines = [
    'Zelle Payment To Jessica Wood 23482748291',
    'Zelle Payment To Jessica Wood 99887766554',
    'Zelle Payment From Jessica Wood 11223344556',
    'GEORGIA POWER PAYMENT 073126',
  ];

  it('reduces the words to the run that really is on the statement', () => {
    expect(repairMatch('Zelle Jessica Wood', lines)).toEqual({ match: 'Jessica Wood', catches: 3 });
  });

  it('leaves a rule that already catches something alone', () => {
    expect(repairMatch('GEORGIA POWER', lines)).toBeNull();
  });

  it('will not guess at a rule whose words are nowhere on the account', () => {
    // Nothing to mend it from. A wrong repair is worse than a dead rule the
    // person can see and fix themselves.
    expect(repairMatch('DEKALB WATER', lines)).toBeNull();
  });

  it('prefers the fragment that catches the most lines', () => {
    const mixed = [
      'Zelle Payment To Jessica Wood 1',
      'Zelle Payment To Jessica Wood 2',
      'Card Purchase Wood Supply Co 3',
    ];
    expect(repairMatch('Zelle Jessica Wood', mixed)?.match).toBe('Jessica Wood');
  });

  it('says nothing about an empty match', () => {
    expect(repairMatch('   ', lines)).toBeNull();
  });
});
