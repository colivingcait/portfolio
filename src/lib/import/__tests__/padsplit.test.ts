import { describe, expect, it } from 'vitest';
import { billedKindOf, collectionCategoryOf, detectFileKind, parseMonth, parsePadSplitFile } from '../padsplit';

/**
 * The header rows are the real ones, copied from an export. The data rows are
 * invented — the real files carry member names, which have no business in a
 * repository — but every shape below (the four-decimal fees, the padded
 * spaces in the collected headers, the blank payout month on the in-flight
 * month, the adjustment row with no room or bill) is one the real files have.
 */
const SUMMARY_HEADER =
  'Earnings Month,Payout Month,PSID,Address,State,Collection Detail Host,Gross Collected,Booking Fees Amount,Collections Net of Booking Fees,Service Fees,Host Earnings,Adjustments,Total Payout,Payout Account';
const BILLED_HEADER =
  'Bill ID,Created,Street 1,Street 2,Room Number,Property ID,Room ID,Member ID,PadSplit Market,Member First Name,Member Last Name,Amount,Transaction Type,Transaction Reason,Comments,Category,Gross Collected,Booking Fee Amount,Service Fee Rate,Booking Fee Days,Transaction Fee Rate';
const COLLECTED_HEADER =
  'Created,Payout Month,Property ID,Street 1,Street 2,Room Number,Room ID,Member ID,PadSplit Market,Member First Name,Member Last Name,Booking Fee Days,Service Fee Rate,Bill ID,Bill Type, Gross Collected , Booking Fee Amount , Collections Net of Booking Fees , Service Fees , Total Fees , Host Earnings ,Category';
const EARNINGS_HEADER = 'row_type,month,is_in_flight,total_collections,total_expenses,total_adjustments,total_payout';

describe('telling the four exports apart', () => {
  it('recognises each by its own headers', () => {
    expect(detectFileKind(SUMMARY_HEADER.split(','))).toBe('summary');
    expect(detectFileKind(BILLED_HEADER.split(','))).toBe('billed');
    expect(detectFileKind(COLLECTED_HEADER.split(',').map((h) => h.trim()))).toBe('collected');
    expect(detectFileKind(EARNINGS_HEADER.split(','))).toBe('earnings_table');
  });

  it('refuses anything else rather than guessing', () => {
    expect(detectFileKind(['Date', 'Description', 'Amount'])).toBeNull();
    expect(() => parsePadSplitFile('Date,Description,Amount\n2026-01-01,x,1')).toThrow(/does not look like/);
  });
});

describe('summary.csv', () => {
  const text = [
    SUMMARY_HEADER,
    '2026-01,2026-02,8299,1939 Candace Lane Southeast,Georgia,Jasmine Brown,5578.45,-470.01,5108.44,-408.67520,4699.76,0.00,4699.76,"Jpmorgan Chase Bank, Na ***7250"',
    '2026-05,2026-06,8299,1939 Candace Lane Southeast,Georgia,Jasmine Brown,4954.18,0.00,4954.18,-396.33440,4557.85,25.00,4582.85,"Jpmorgan Chase Bank, Na ***7250"',
  ].join('\n');

  it('reads a row whole, keeping the four-decimal service fee', () => {
    const [row] = parsePadSplitFile(text).summary;
    expect(row).toMatchObject({
      propertyExternalId: '8299',
      earningsMonth: '2026-01',
      payoutMonth: '2026-02',
      grossCents: 557_845,
      bookingFeesCents: -47_001,
      netOfBookingFeesCents: 510_844,
      serviceFeesCents: -40_868,
      hostEarningsCents: 469_976,
      adjustmentsCents: 0,
      totalPayoutCents: 469_976,
    });
  });

  it('keeps the payout account, which is how a deposit finds its bank account', () => {
    expect(parsePadSplitFile(text).summary[0].payoutAccount).toContain('***7250');
  });

  it('reads the payout month as stated rather than assuming the next one', () => {
    expect(parsePadSplitFile(text).summary[1].payoutMonth).toBe('2026-06');
  });

  it('keeps adjustments out of gross and in their own column', () => {
    const [, may] = parsePadSplitFile(text).summary;
    expect(may.grossCents).toBe(495_418);
    expect(may.adjustmentsCents).toBe(2_500);
    expect(may.totalPayoutCents).toBe(may.hostEarningsCents + may.adjustmentsCents);
  });
});

describe('billed.csv', () => {
  const text = [
    BILLED_HEADER,
    '7757236,2026-01-01,1939 Candace Lane Southeast,,1,8299,33214,166373,"Atlanta, GA",Ada,Lovelace,-180.00,fee,membership_dues,,billed,,,8.00,10,0',
    '7764995,2026-01-02,1939 Candace Lane Southeast,,3,8299,33216,917599,"Atlanta, GA",Grace,Hopper,9.40,concession,promo_room_discount,,billed,,,8.00,10,0',
    '7764996,2026-01-03,1939 Candace Lane Southeast,,3,8299,33216,917599,"Atlanta, GA",Grace,Hopper,-50.00,fine,unregistered_guest,,billed,,,8.00,10,0',
  ].join('\n');

  it('takes the kind from the file instead of reading the wording', () => {
    expect(parsePadSplitFile(text).billed.map((b) => b.kind)).toEqual(['fee', 'concession', 'fine']);
  });

  it('keeps charges negative and concessions positive, as exported', () => {
    const [fee, concession] = parsePadSplitFile(text).billed;
    expect(fee.amountCents).toBe(-18_000);
    expect(concession.amountCents).toBe(940);
  });

  it('dates the month from Created, there being no month column', () => {
    expect(parsePadSplitFile(text).billed.every((b) => b.earningsMonth === '2026-01')).toBe(true);
  });

  it('keeps the bill id and member, which is what makes ageing possible', () => {
    const [first] = parsePadSplitFile(text).billed;
    expect(first).toMatchObject({ billId: '7757236', memberId: '166373', memberName: 'Ada Lovelace', reason: 'membership_dues' });
  });
});

describe('collected.csv', () => {
  const text = [
    COLLECTED_HEADER,
    '2026-01-05,2026-01-01,8299,1939 Candace Lane Southeast,,5,33218,864739,"Atlanta, GA",Ada,Lovelace,10,8.00,7740600,Membership Dues,168.33000,0.00000,168.33000,-13.46640,-13.46640,154.86360,collected',
    '2026-06-03,2026-05-01,8299,1939 Candace Lane Southeast,,,,,"Atlanta, GA",,,10,8.00,,,25.00000,0.00000,25.00000,0.00000,0.00000,25.00000,adjustment',
    '2026-08-04,,8299,1939 Candace Lane Southeast,,5,33218,864739,"Atlanta, GA",Ada,Lovelace,10,8.00,7900001,Membership Dues,200.00000,0.00000,200.00000,-16.00000,-16.00000,184.00000,collected',
  ].join('\n');

  it('reads the padded headers the export actually ships', () => {
    // Only columns nothing needs are left over: the address parts, the market,
    // the rate columns, and two totals derivable from the others.
    expect(parsePadSplitFile(text).unrecognizedHeaders).toEqual([
      'Street 1',
      'Street 2',
      'PadSplit Market',
      'Booking Fee Days',
      'Service Fee Rate',
      'Collections Net of Booking Fees',
      'Total Fees',
    ]);
  });

  it('books a collection to the month the mislabelled column names, not when it arrived', () => {
    // Created in June, booked back to May. The column wins wherever it has one.
    const [, adjustment] = parsePadSplitFile(text).collected;
    expect(adjustment.createdDate).toBe('2026-06-03');
    expect(adjustment.payoutMonthRaw).toBe('2026-05');
  });

  it('falls back to the created month only where the column is blank', () => {
    const [, , inFlight] = parsePadSplitFile(text).collected;
    expect(inFlight.payoutMonthRaw).toBeNull();
    expect(parsePadSplitFile(text).months).toContain('2026-08');
  });

  it('marks an adjustment, which carries no room and no bill', () => {
    const [, adjustment] = parsePadSplitFile(text).collected;
    expect(adjustment.category).toBe('adjustment');
    expect(adjustment.roomExternalId).toBeNull();
    expect(adjustment.billId).toBeNull();
    expect(adjustment.serviceFeeCents).toBe(0);
  });

  it('keeps the fee split per line', () => {
    const [first] = parsePadSplitFile(text).collected;
    expect(first).toMatchObject({ amountCents: 16_833, serviceFeeCents: -1_347, hostEarningsCents: 15_486 });
  });
});

describe('earnings_table.csv', () => {
  const text = [
    EARNINGS_HEADER,
    'month,2026-08-01,True,15546.85,-3457.6728,302.30,12391.4772',
    'month,2026-07-01,False,13631.00,-3438.52,754.29,10946.77',
    'year_to_date,2026,,99053.29,-15568.6828,1081.59,84566.1972',
  ].join('\n');

  it('reads the in-flight flag rather than inferring it from the latest month', () => {
    const { monthTotals } = parsePadSplitFile(text);
    expect(monthTotals.map((m) => [m.earningsMonth, m.inFlight])).toEqual([
      ['2026-08', true],
      ['2026-07', false],
    ]);
  });

  it('separates the year-to-date row from the months', () => {
    const parsed = parsePadSplitFile(text);
    expect(parsed.monthTotals).toHaveLength(2);
    expect(parsed.yearToDate).toMatchObject({ year: 2026, collectionsCents: 9_905_329, payoutCents: 8_456_620 });
  });

  it('keeps expenses negative, as exported', () => {
    expect(parsePadSplitFile(text).monthTotals[0].expensesCents).toBe(-345_767);
  });
});

describe('the parts that never depended on a column name', () => {
  it('reads a month from any of the shapes a month column holds', () => {
    expect(parseMonth('2026-07')).toBe('2026-07');
    expect(parseMonth('2026-08-01')).toBe('2026-08');
    expect(parseMonth('07/2026')).toBe('2026-07');
    expect(parseMonth('Jul 2026')).toBe('2026-07');
    expect(parseMonth('')).toBeNull();
  });

  it('takes both classifications straight from the file', () => {
    expect(billedKindOf('concession')).toBe('concession');
    expect(billedKindOf('fine')).toBe('fine');
    expect(billedKindOf('fee')).toBe('fee');
    expect(billedKindOf('something else')).toBe('fee');
    expect(collectionCategoryOf('adjustment')).toBe('adjustment');
    expect(collectionCategoryOf('collected')).toBe('collected');
  });
});
