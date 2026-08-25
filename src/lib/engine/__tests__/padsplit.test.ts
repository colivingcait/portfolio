import { describe, expect, it } from 'vitest';
import {
  collectionRate,
  comparableMonths,
  delinquency,
  earningsMonthOf,
  inFlightMonth,
  metricsFor,
  netBilled,
  occupancyRate,
  roomsOccupied,
  trueRoomRate,
  type BilledLine,
  type CollectionLine,
  type PropertyMonth,
} from '../padsplit';
import { cents } from '../money';

function collected(over: Partial<CollectionLine> = {}): CollectionLine {
  return {
    billId: 'b1',
    propertyExternalId: '8299',
    roomExternalId: 'room-1',
    roomNumber: '1',
    memberId: 'm1',
    memberName: 'A Member',
    billType: 'Membership Dues',
    category: 'collected',
    amountCents: cents(700),
    bookingFeeCents: 0,
    serviceFeeCents: cents(-56),
    hostEarningsCents: cents(644),
    payoutMonthRaw: '2026-06',
    createdDate: '2026-06-05',
    ...over,
  };
}

function billed(over: Partial<BilledLine> = {}): BilledLine {
  return {
    billId: 'b1',
    propertyExternalId: '8299',
    roomExternalId: 'room-1',
    roomNumber: '1',
    memberId: 'm1',
    memberName: 'A Member',
    earningsMonth: '2026-06',
    billedDate: '2026-06-01',
    billType: 'billed',
    reason: 'membership_dues',
    kind: 'fee',
    amountCents: cents(-700), // charges are negative in the export
    ...over,
  };
}

function propertyMonth(over: Partial<PropertyMonth> = {}): PropertyMonth {
  return {
    propertyExternalId: '8299',
    earningsMonth: '2026-06',
    roomsTotal: 8,
    roomsOccupied: 8,
    grossCents: cents(6_000),
    feesCents: cents(900),
    adjustmentsCents: 0,
    hostEarningsCents: cents(5_100),
    payoutCents: cents(5_100),
    netBilledCents: cents(6_000),
    grossCollectedCents: cents(6_000),
    activeMonthIndex: 6,
    divesting: false,
    inFlight: false,
    ...over,
  };
}

describe('rules that must not drift (§6)', () => {
  it('reads the earnings month out of the mislabeled "Payout Month" column', () => {
    expect(earningsMonthOf(collected({ payoutMonthRaw: '2026-06', createdDate: '2026-07-03' }))).toBe('2026-06');
  });

  it('falls back to the month in Created when Payout Month is blank (the in-flight month)', () => {
    expect(earningsMonthOf(collected({ payoutMonthRaw: null, createdDate: '2026-08-14' }))).toBe('2026-08');
  });

  it('identifies the in-flight month as the latest present', () => {
    expect(inFlightMonth(['2026-06', '2026-08', '2026-07'])).toBe('2026-08');
    expect(inFlightMonth([])).toBeNull();
  });


});

describe('formulas (§6)', () => {
  it('flips the sign on billed amounts: charges negative, concessions positive', () => {
    const lines = [
      billed({ amountCents: cents(-700) }),
      billed({ amountCents: cents(-700) }),
      billed({ kind: 'concession', amountCents: cents(100) }),
    ];
    expect(netBilled(lines)).toBe(cents(1_300));
  });

  it('computes delinquency as net billed less collected', () => {
    expect(delinquency(cents(6_000), cents(5_400))).toBe(cents(600));
  });

  it('reports a collection rate above 100% when catching up prior arrears', () => {
    expect(collectionRate(cents(6_000), cents(6_600))).toBeCloseTo(110, 10);
  });

  it('returns null rather than dividing by zero', () => {
    expect(collectionRate(0, cents(500))).toBeNull();
    expect(occupancyRate(4, 0)).toBeNull();
  });

  it('counts distinct rooms with collected membership dues', () => {
    const lines = [
      collected({ roomExternalId: 'r1' }),
      collected({ roomExternalId: 'r1' }), // same room paying twice
      collected({ roomExternalId: 'r2' }),
      collected({ roomExternalId: 'r3', billType: 'Late Fee' }), // not dues
      collected({ roomExternalId: 'r4', category: 'adjustment' }), // not collected
    ];
    expect(roomsOccupied(lines)).toBe(2);
    expect(occupancyRate(roomsOccupied(lines), 8)).toBe(25);
  });
});

describe('outlier rule (§6)', () => {
  it('always excludes a property’s first active month', () => {
    const m = metricsFor(propertyMonth({ activeMonthIndex: 1, roomsOccupied: 8 }));
    expect(m.outlier).toBe(true);
    expect(m.outlierReason).toBe('first_active_month');
  });

  it('excludes a second active month below 70% occupancy', () => {
    const m = metricsFor(propertyMonth({ activeMonthIndex: 2, roomsTotal: 8, roomsOccupied: 5 })); // 62.5%
    expect(m.outlier).toBe(true);
    expect(m.outlierReason).toBe('second_month_low_occupancy');
  });

  it('keeps a second active month at or above 70% occupancy', () => {
    const m = metricsFor(propertyMonth({ activeMonthIndex: 2, roomsTotal: 8, roomsOccupied: 6 })); // 75%
    expect(m.outlier).toBe(false);
  });

  it('keeps later months regardless of occupancy', () => {
    expect(metricsFor(propertyMonth({ activeMonthIndex: 3, roomsOccupied: 2 })).outlier).toBe(false);
  });

  it('never rates the in-flight month, so it is never compared to a completed one', () => {
    const m = metricsFor(propertyMonth({ inFlight: true, grossCollectedCents: cents(1_200) }));
    expect(m.collectionRate).toBeNull();
    expect(m.delinquencyCents).toBe(0);
  });

  it('drops both outliers and the in-flight month from comparable months', () => {
    const months = [
      propertyMonth({ earningsMonth: '2026-05', activeMonthIndex: 1 }),
      propertyMonth({ earningsMonth: '2026-06', activeMonthIndex: 2, roomsOccupied: 4 }),
      propertyMonth({ earningsMonth: '2026-07', activeMonthIndex: 3 }),
      propertyMonth({ earningsMonth: '2026-08', activeMonthIndex: 4, inFlight: true }),
    ];
    expect(comparableMonths(months).map((m) => m.earningsMonth)).toEqual(['2026-07']);
  });
});

describe('true room rate (§6)', () => {
  it('is the median of host earnings per occupied room across usable months', () => {
    const months = [
      propertyMonth({ earningsMonth: '2026-04', activeMonthIndex: 3, roomsOccupied: 8, hostEarningsCents: cents(4_800) }), // 600
      propertyMonth({ earningsMonth: '2026-05', activeMonthIndex: 4, roomsOccupied: 8, hostEarningsCents: cents(5_600) }), // 700
      propertyMonth({ earningsMonth: '2026-06', activeMonthIndex: 5, roomsOccupied: 8, hostEarningsCents: cents(6_400) }), // 800
    ];
    expect(trueRoomRate(months)).toBe(cents(700));
  });

  it('excludes divesting months, first months and the in-flight month', () => {
    const months = [
      propertyMonth({ earningsMonth: '2026-04', activeMonthIndex: 1, roomsOccupied: 8, hostEarningsCents: cents(800) }),
      propertyMonth({ earningsMonth: '2026-05', activeMonthIndex: 4, roomsOccupied: 8, hostEarningsCents: cents(5_600) }),
      propertyMonth({ earningsMonth: '2026-06', activeMonthIndex: 5, divesting: true, roomsOccupied: 8, hostEarningsCents: cents(1_600) }),
      propertyMonth({ earningsMonth: '2026-07', activeMonthIndex: 6, inFlight: true, roomsOccupied: 8, hostEarningsCents: cents(2_400) }),
    ];
    expect(trueRoomRate(months)).toBe(cents(700));
  });

  it('returns null when nothing is usable yet', () => {
    expect(trueRoomRate([propertyMonth({ activeMonthIndex: 1 })])).toBeNull();
  });
});
