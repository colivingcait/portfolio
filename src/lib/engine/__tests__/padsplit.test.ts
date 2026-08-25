import { describe, expect, it } from 'vitest';
import {
  collectionRate,
  comparableMonths,
  delinquency,
  earningsMonthOf,
  inFlightMonth,
  metricsFor,
  netBilled,
  trueRoomRate,
  type BilledLine,
  netDuesBilled,
  occupancyFromRoomDays,
  occupancyWindow,
  residentsBilled,
  roomDaysLet,
  roomsLet,
  tenancyEnds,
  turnoverProvisional,
  turnoversByMonth,
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
    roomsLet: 8,
    roomDaysLet: 240,
    roomDaysAvailable: 240,
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
  });

});

describe('outlier rule (§6)', () => {
  it('always excludes a property’s first active month', () => {
    const m = metricsFor(propertyMonth({ activeMonthIndex: 1 }));
    expect(m.outlier).toBe(true);
    expect(m.outlierReason).toBe('first_active_month');
  });

  it('excludes a second active month below 70% occupancy', () => {
    const m = metricsFor(propertyMonth({ activeMonthIndex: 2, roomDaysLet: 150 })); // 62.5%
    expect(m.outlier).toBe(true);
    expect(m.outlierReason).toBe('second_month_low_occupancy');
  });

  it('keeps a second active month at or above 70% occupancy', () => {
    const m = metricsFor(propertyMonth({ activeMonthIndex: 2, roomDaysLet: 180 })); // 75%
    expect(m.outlier).toBe(false);
  });

  it('keeps later months regardless of occupancy', () => {
    expect(metricsFor(propertyMonth({ activeMonthIndex: 3, roomDaysLet: 60 })).outlier).toBe(false);
  });

  it('never rates the in-flight month, so it is never compared to a completed one', () => {
    const m = metricsFor(propertyMonth({ inFlight: true, grossCollectedCents: cents(1_200) }));
    expect(m.collectionRate).toBeNull();
    expect(m.delinquencyCents).toBe(0);
  });

  it('drops both outliers and the in-flight month from comparable months', () => {
    const months = [
      propertyMonth({ earningsMonth: '2026-05', activeMonthIndex: 1 }),
      propertyMonth({ earningsMonth: '2026-06', activeMonthIndex: 2, roomDaysLet: 120 }),
      propertyMonth({ earningsMonth: '2026-07', activeMonthIndex: 3 }),
      propertyMonth({ earningsMonth: '2026-08', activeMonthIndex: 4, inFlight: true }),
    ];
    expect(comparableMonths(months).map((m) => m.earningsMonth)).toEqual(['2026-07']);
  });
});

describe('true room rate (§6)', () => {
  it('is the median of host earnings per occupied room across usable months', () => {
    const months = [
      propertyMonth({ earningsMonth: '2026-04', activeMonthIndex: 3, roomsLet: 8, hostEarningsCents: cents(4_800) }), // 600
      propertyMonth({ earningsMonth: '2026-05', activeMonthIndex: 4, roomsLet: 8, hostEarningsCents: cents(5_600) }), // 700
      propertyMonth({ earningsMonth: '2026-06', activeMonthIndex: 5, roomsLet: 8, hostEarningsCents: cents(6_400) }), // 800
    ];
    expect(trueRoomRate(months)).toBe(cents(700));
  });

  it('excludes divesting months, first months and the in-flight month', () => {
    const months = [
      propertyMonth({ earningsMonth: '2026-04', activeMonthIndex: 1, roomsLet: 8, hostEarningsCents: cents(800) }),
      propertyMonth({ earningsMonth: '2026-05', activeMonthIndex: 4, roomsLet: 8, hostEarningsCents: cents(5_600) }),
      propertyMonth({ earningsMonth: '2026-06', activeMonthIndex: 5, divesting: true, roomsLet: 8, hostEarningsCents: cents(1_600) }),
      propertyMonth({ earningsMonth: '2026-07', activeMonthIndex: 6, inFlight: true, roomsLet: 8, hostEarningsCents: cents(2_400) }),
    ];
    expect(trueRoomRate(months)).toBe(cents(700));
  });

  it('returns null when nothing is usable yet', () => {
    expect(trueRoomRate([propertyMonth({ activeMonthIndex: 1 })])).toBeNull();
  });
});

/**
 * Occupancy and turnover off the billed file (§6).
 *
 * The shapes here are the ones the real export produces, taken from a month of
 * it: a weekly dues charge, a per-day refund when someone leaves mid-week, a
 * booking waived to nothing when it falls through, and a tenancy that ends by
 * simply not being billed again.
 */
describe('occupancy and turnover, read off what was billed', () => {
  const week = (day: string, over: Partial<BilledLine> = {}) =>
    billed({ billedDate: `2026-06-${day}`, amountCents: cents(-243), ...over });

  it('nets a fallen-through booking to nothing, so it never was a tenancy', () => {
    const lines = [
      week('12', { memberId: 'ghost', roomNumber: '2' }),
      billed({
        billedDate: '2026-06-13',
        memberId: 'ghost',
        roomNumber: '2',
        reason: 'waiving_membership_dues',
        kind: 'concession',
        amountCents: cents(243),
      }),
    ];
    expect(netDuesBilled(lines)).toBe(0);
    expect(roomsLet(lines)).toBe(0);
    expect(residentsBilled(lines)).toBe(0);
  });

  it('keeps a part-week: a day refunded on the way out is a day less occupied', () => {
    // $243 a week is $34.71 a day. One day back means six days held.
    const lines = [
      week('07'),
      billed({ billedDate: '2026-06-10', reason: 'adjustment', kind: 'concession', amountCents: cents(34.71) }),
    ];
    expect(netDuesBilled(lines)).toBe(cents(208.29));
  });

  it('leaves fines out of rent — they say nothing about whether a room was let', () => {
    const lines = [
      week('07'),
      billed({ billedDate: '2026-06-08', reason: 'overdue_balance', kind: 'fine', amountCents: cents(-25) }),
      billed({ billedDate: '2026-06-08', reason: 'administrative', kind: 'fee', amountCents: cents(-15) }),
    ];
    expect(netDuesBilled(lines)).toBe(cents(243));
  });

  it('credits a week raised in the previous month to the days it pays for', () => {
    // The trap the first version fell into: this charge is filed under July
    // but pays for 1-5 August.
    const july = billed({ earningsMonth: '2026-07', billedDate: '2026-07-30', amountCents: cents(-169) });
    const window = occupancyWindow('2026-08', '2026-08-24');
    expect(roomDaysLet([july], window)).toBe(5);
  });

  it('counts a room once when two residents share the month', () => {
    const handover = [
      billed({ billedDate: '2026-06-01', memberId: 'out' }),
      billed({ billedDate: '2026-06-05', memberId: 'in' }), // overlaps by three days
    ];
    const window = occupancyWindow('2026-06', '2026-06-30');
    expect(roomDaysLet(handover, window)).toBe(11); // 1-11 June, not 14
  });

  it('buys no days for a booking that fell through', () => {
    const ghost = [
      billed({ billedDate: '2026-06-01', memberId: 'ghost', roomNumber: '3' }),
      billed({
        billedDate: '2026-06-02',
        memberId: 'ghost',
        roomNumber: '3',
        reason: 'waiving_membership_dues',
        kind: 'concession',
        amountCents: cents(700),
      }),
    ];
    expect(roomDaysLet(ghost, occupancyWindow('2026-06', '2026-06-30'))).toBe(0);
  });

  it('stops the window where the export stops billing, not at month end', () => {
    // Last charge on the 24th pays through the 30th; nothing beyond it is
    // vacant, it is simply unbilled.
    expect(occupancyWindow('2026-08', '2026-08-24')).toEqual({ from: '2026-08-01', to: '2026-08-30', days: 30 });
    expect(occupancyWindow('2026-08', '2026-08-31')).toEqual({ from: '2026-08-01', to: '2026-08-31', days: 31 });
    expect(occupancyWindow('2026-06', null)).toEqual({ from: '2026-06-01', to: '2026-06-30', days: 30 });
  });

  it('measures a partly-let house against the days it could have sold', () => {
    const window = occupancyWindow('2026-08', '2026-08-24'); // 30 days
    expect(occupancyFromRoomDays(203, 8, window)).toBeCloseTo(84.6, 1);
    expect(occupancyFromRoomDays(0, 8, window)).toBe(0);
    expect(occupancyFromRoomDays(240, 0, window)).toBeNull();
  });

  describe('a turnover is a tenancy ending', () => {
    // Two residents of room 1: one stops being billed mid-month, one carries on.
    const leaver = [week('01'), week('08')];
    const stayer = [
      week('01', { memberId: 'm2', roomNumber: '2' }),
      week('08', { memberId: 'm2', roomNumber: '2' }),
      week('15', { memberId: 'm2', roomNumber: '2' }),
      week('22', { memberId: 'm2', roomNumber: '2' }),
    ];

    it('sees the week that was never billed', () => {
      const ends = tenancyEnds([...leaver, ...stayer], '2026-06-24');
      expect(ends.map((e) => e.memberId)).toEqual(['m1']);
      expect(ends[0].lastDuesDate).toBe('2026-06-08');
    });

    it('will not judge a resident whose next charge is not yet due', () => {
      // Horizon four days after the last charge: nothing can be concluded.
      expect(tenancyEnds([...leaver, ...stayer], '2026-06-12')).toEqual([]);
    });

    it('counts a move between rooms, because the room they left had to be re-let', () => {
      const moved = [
        week('01', { roomNumber: '5', roomExternalId: 'room-5' }),
        week('08', { roomNumber: '2', roomExternalId: 'room-2' }),
        week('15', { roomNumber: '2', roomExternalId: 'room-2' }),
        week('22', { roomNumber: '2', roomExternalId: 'room-2' }), // still there at the horizon
      ];
      const ends = tenancyEnds(moved, '2026-06-24');
      expect(ends.map((e) => e.roomNumber)).toEqual(['5']);
    });

    it('does not count a booking that fell through as somebody leaving', () => {
      const ghost = [
        week('01', { memberId: 'ghost', roomNumber: '3' }),
        billed({
          billedDate: '2026-06-02',
          memberId: 'ghost',
          roomNumber: '3',
          reason: 'waiving_membership_dues',
          kind: 'concession',
          amountCents: cents(243),
        }),
      ];
      expect(tenancyEnds(ghost, '2026-06-24')).toEqual([]);
    });

    it('attributes the turnover to the month of the last week billed', () => {
      const counts = turnoversByMonth([...leaver, ...stayer], '2026-06-24');
      expect(counts.get('2026-06')).toBe(1);
    });

    it('takes the horizon from the whole export, not one house’s last day', () => {
      // Left to itself this house would judge nobody as gone.
      expect(turnoversByMonth(leaver).get('2026-06')).toBeUndefined();
      expect(turnoversByMonth(leaver, '2026-06-24').get('2026-06')).toBe(1);
    });

    it('says when the count can still rise', () => {
      expect(turnoverProvisional([...leaver, ...stayer], '2026-06', '2026-06-24')).toBe(true);
      expect(turnoverProvisional(leaver, '2026-06', '2026-06-24')).toBe(false);
    });
  });
});
