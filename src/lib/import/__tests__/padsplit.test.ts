import { describe, expect, it } from 'vitest';
import { billedKindOf, collectionCategoryOf, detectFileKind, parseMonth } from '../padsplit';
import { cents } from '../../engine/money';

/**
 * These cover the parts that do not depend on PadSplit's exact column names:
 * the month formats, and the two classifications the export has no column for.
 * The header aliases themselves are unverified against a real export and are
 * deliberately not asserted here — a test written from the same guess as the
 * code would only agree with itself.
 */

describe('reading a month from whatever the column holds', () => {
  it('takes an ISO month', () => {
    expect(parseMonth('2026-07')).toBe('2026-07');
    expect(parseMonth('2026-7')).toBe('2026-07');
  });

  it('takes a month and year either way round', () => {
    expect(parseMonth('07/2026')).toBe('2026-07');
    expect(parseMonth('2026/07')).toBe('2026-07');
  });

  it('takes a named month', () => {
    expect(parseMonth('Jul 2026')).toBe('2026-07');
    expect(parseMonth('July 2026')).toBe('2026-07');
  });

  it('takes a full date, since a month column often holds one', () => {
    expect(parseMonth('07/31/2026')).toBe('2026-07');
    expect(parseMonth('2026-07-31')).toBe('2026-07');
  });

  it('reads nothing from a blank, which is what the in-flight month has', () => {
    expect(parseMonth('')).toBeNull();
    expect(parseMonth('   ')).toBeNull();
    expect(parseMonth('n/a')).toBeNull();
  });
});

describe('telling the four files apart by their headers', () => {
  it('knows earnings_table by credits and payout together', () => {
    expect(detectFileKind(['Property ID', 'Month', 'Gross', 'Fees', 'Credits', 'Payout'])).toBe('earnings_table');
  });

  it('knows collected by the payout month column', () => {
    expect(detectFileKind(['Property ID', 'Room ID', 'Bill Type', 'Amount', 'Payout Month', 'Created'])).toBe('collected');
  });

  it('knows summary by host earnings, where nothing says credits', () => {
    expect(detectFileKind(['Property ID', 'Month', 'Gross', 'Fees', 'Host Earnings'])).toBe('summary');
  });

  it('knows billed by a bill type with no created date', () => {
    expect(detectFileKind(['Property ID', 'Room ID', 'Month', 'Bill Type', 'Amount'])).toBe('billed');
  });

  it('refuses a file it does not recognise rather than guessing', () => {
    expect(detectFileKind(['Date', 'Description', 'Amount'])).toBeNull();
    expect(detectFileKind([])).toBeNull();
  });
});

describe('classifying a billed line, which the export has no column for', () => {
  it('reads a concession from the wording', () => {
    expect(billedKindOf('Move-in Concession', cents(-50))).toBe('concession');
    expect(billedKindOf('Rent Discount', cents(-25))).toBe('concession');
  });

  it('reads a fine from the wording', () => {
    expect(billedKindOf('Cleaning Fine', cents(-40))).toBe('fine');
    expect(billedKindOf('Late Fee', cents(-15))).toBe('fine');
  });

  it('falls back to the sign, charges being negative as exported', () => {
    expect(billedKindOf('Membership Dues', cents(-300))).toBe('fee');
    expect(billedKindOf('Something Unfamiliar', cents(75))).toBe('concession');
  });
});

describe('collected against a correction to it', () => {
  it('calls a refund or reversal an adjustment', () => {
    expect(collectionCategoryOf('Membership Dues', 'Refund')).toBe('adjustment');
    expect(collectionCategoryOf('Reversal', '')).toBe('adjustment');
  });

  it('calls ordinary money collected', () => {
    expect(collectionCategoryOf('Membership Dues', 'Paid')).toBe('collected');
    expect(collectionCategoryOf('Membership Dues', '')).toBe('collected');
  });
});
