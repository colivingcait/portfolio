import { describe, expect, it } from 'vitest';
import { assemblePropertyRollup, debtServiceDisagreement, deriveFromBank } from '../assemble';
import { classify, periodTotals, type PayeeRule, type RawTransaction } from '../bank';
import { cents } from '../money';

const rules: PayeeRule[] = [
  { id: '1', bankAccountId: null, match: 'RENT', categoryKey: 'rental_income' },
  { id: '2', bankAccountId: null, match: 'PADSPLIT', categoryKey: 'padsplit_deposit' },
  { id: '3', bankAccountId: null, match: 'GEORGIA POWER', categoryKey: 'electric' },
  { id: '4', bankAccountId: null, match: 'MORTGAGE', categoryKey: 'debt_service' },
  { id: '5', bankAccountId: null, match: 'DEPOSIT HELD', categoryKey: 'security_deposit_received' },
  { id: '6', bankAccountId: null, match: 'TRANSFER', categoryKey: 'transfer_between_own_accounts' },
];

function totalsFor(transactions: RawTransaction[]) {
  return periodTotals(classify(transactions, rules, null));
}

describe('deriving buckets from a bank period', () => {
  it('separates earned revenue from a remittance', () => {
    const derived = deriveFromBank(
      totalsFor([
        { date: '2026-06-01', description: 'RENT UNIT A', amountCents: cents(1_850) },
        { date: '2026-06-02', description: 'PADSPLIT HOST PAYOUT', amountCents: cents(5_100) },
      ]),
    );
    // A PadSplit deposit is revenue the platform already recognised. Counting
    // it here would double-count it once the PadSplit import lands.
    expect(derived.revenueCents).toBe(cents(1_850));
    expect(derived.depositReceivedCents).toBe(cents(5_100));
  });

  it('pulls debt service out of operating expenses', () => {
    const derived = deriveFromBank(
      totalsFor([
        { date: '2026-06-05', description: 'GEORGIA POWER', amountCents: cents(-320) },
        { date: '2026-06-06', description: 'MORTGAGE PAYMENT', amountCents: cents(-1_137.72) },
      ]),
    );
    expect(derived.ownerPaidOpexCents).toBe(cents(320));
    expect(derived.categorizedDebtServiceCents).toBe(cents(1_137.72));
  });

  it('keeps deposits held and transfers out of every operating bucket', () => {
    const derived = deriveFromBank(
      totalsFor([
        { date: '2026-06-01', description: 'DEPOSIT HELD', amountCents: cents(1_850) },
        { date: '2026-06-07', description: 'TRANSFER TO SAVINGS', amountCents: cents(-2_000) },
      ]),
    );
    expect(derived.revenueCents).toBe(0);
    expect(derived.ownerPaidOpexCents).toBe(0);
    expect(derived.depositsHeldDeltaCents).toBe(cents(1_850));
  });

  it('ignores uncategorized rows rather than guessing which bucket they belong in', () => {
    const derived = deriveFromBank(
      totalsFor([{ date: '2026-06-09', description: 'MYSTERY VENDOR', amountCents: cents(-145) }]),
    );
    expect(derived.ownerPaidOpexCents).toBe(0);
  });
});

describe('assembling a direct property month', () => {
  const bank = deriveFromBank(
    totalsFor([
      { date: '2026-06-01', description: 'RENT UNIT A', amountCents: cents(1_850) },
      { date: '2026-06-01', description: 'RENT UNIT B', amountCents: cents(1_650) },
      { date: '2026-06-05', description: 'GEORGIA POWER', amountCents: cents(-320) },
      { date: '2026-06-06', description: 'MORTGAGE PAYMENT', amountCents: cents(-1_137.72) },
    ]),
  );

  const rollup = assemblePropertyRollup({
    propertyId: 'duplex',
    month: '2026-06',
    entityId: 'me',
    bank,
    debtServiceCents: cents(1_137.72),
    debtBalanceCents: cents(175_470.01),
    roomsTotal: 0,
    padsplit: null,
  });

  it('earns what was categorized as income on its own statement', () => {
    expect(rollup.revenueCents).toBe(cents(3_500));
  });

  it('nets income against opex and debt service', () => {
    // 3,500 − 320 − 1,137.72
    expect(rollup.netCashCents).toBe(cents(2_042.28));
  });

  it('reports NOI before debt service', () => {
    expect(rollup.noiCents).toBe(cents(3_180));
  });

  it('leaves the operational figures empty rather than inventing them', () => {
    // Occupancy and collection are not derivable from a bank statement alone.
    expect(rollup.occupancyRate).toBeNull();
    expect(rollup.collectionRate).toBeNull();
    expect(rollup.roomsOccupied).toBe(0);
  });
});

describe('assembling a PM-managed PadSplit month', () => {
  const bank = deriveFromBank(
    totalsFor([
      { date: '2026-09-04', description: 'PADSPLIT DISBURSEMENT', amountCents: cents(6_900) },
      { date: '2026-09-05', description: 'GEORGIA POWER', amountCents: cents(-420) },
    ]),
  );

  const rollup = assemblePropertyRollup({
    propertyId: 'candace',
    month: '2026-09',
    entityId: 'lustra',
    bank,
    debtServiceCents: cents(2_500),
    debtBalanceCents: cents(250_000),
    roomsTotal: 8,
    padsplit: {
      // The platform collected 9,500 of rent and kept 800 of it.
      grossCollectedCents: cents(9_500),
      platformFeesCents: cents(800),
      adjustmentsCents: cents(0),
      hostEarningsCents: cents(8_700),
      payoutCents: cents(6_900),
      pmFeeCents: cents(1_050),
      pmPaidOpexCents: cents(750),
      roomsOccupied: 7,
      occupancyRate: 87.5,
      collectionRate: 96.4,
      delinquencyCents: cents(400),
      trueRoomRateCents: cents(1_100),
    },
  });

  it('earns the rent collected on its behalf, gross, not the deposit that landed', () => {
    // The platform collecting rent and remitting the balance does not reduce
    // what was earned: 9,500 of rent is income and the 800 it kept is a cost.
    // Reporting 8,700 instead would forfeit the deduction on the 800.
    expect(rollup.revenueCents).toBe(cents(9_500));
    expect(rollup.depositReceivedCents).toBe(cents(6_900));
  });

  it('counts the platform fee alongside the PM fee and the costs the PM fronted', () => {
    // 420 owner-paid + 750 PM-paid + 1,050 PM fee + 800 platform fee
    expect(rollup.operatingExpenseCents).toBe(cents(3_020));
    expect(rollup.noiCents).toBe(cents(6_480));
  });

  it('leaves NOI where it was: the fee moved sides, it did not appear', () => {
    // Gross revenue less the fee is the same figure as net revenue was, which
    // is the point — the change is where it is reported, not what was earned.
    expect(rollup.revenueCents - rollup.platformFeesCents).toBe(cents(8_700));
  });

  it('nets cash from the deposit that actually landed, not from host earnings', () => {
    // Money the PM never remitted was never in the account: 6,900 − 420 − 2,500
    expect(rollup.netCashCents).toBe(cents(3_980));
  });

  it('carries the operational figures through undivided', () => {
    expect(rollup.occupancyRate).toBe(87.5);
    expect(rollup.roomsOccupied).toBe(7);
  });
});

describe('debt service cross-check', () => {
  it('says nothing when no bank row is categorized as debt service', () => {
    expect(debtServiceDisagreement(cents(1_137.72), 0)).toBeNull();
  });

  it('agrees when the statement matches the schedule', () => {
    expect(debtServiceDisagreement(cents(1_137.72), cents(1_137.72))).toEqual({
      agrees: true,
      differenceCents: 0,
    });
  });

  it('reports a difference when they disagree', () => {
    expect(debtServiceDisagreement(cents(1_137.72), cents(1_500))).toEqual({
      agrees: false,
      differenceCents: cents(362.28),
    });
  });
});
