import { describe, expect, it } from 'vitest';
import {
  allocate,
  capitalPositions,
  interestOn,
  paymentsDueIn,
  payoutTotals,
  planDistribution,
  type CapitalEntry,
  reconcileDistributions,
} from '../payouts';
import { buildSchedule, periodInterest, paymentCountOf, type LoanTerms } from '../amortization';
import { cents } from '../money';

const RAVEN = 'property:raven';
const ME = 'entity:me';
const INVESTOR = 'entity:investor';

const fiftyFifty = [
  { entityId: ME, name: 'Owner', sharePercent: 50 },
  { entityId: INVESTOR, name: 'Investor', sharePercent: 50 },
];

describe('splitting a month’s profit', () => {
  it('halves an even amount', () => {
    const plan = planDistribution({ month: '2026-09', propertyId: RAVEN, netCashCents: cents(4_000), owners: fiftyFifty });
    expect(plan.allocations.map((a) => a.amountCents)).toEqual([cents(2_000), cents(2_000)]);
  });

  it('never loses a cent on an odd amount', () => {
    // 50/50 of $1,000.01 cannot be halved evenly; one owner gets the cent.
    const plan = planDistribution({ month: '2026-09', propertyId: RAVEN, netCashCents: cents(1_000.01), owners: fiftyFifty });
    const total = plan.allocations.reduce((sum, a) => sum + a.amountCents, 0);
    expect(total).toBe(cents(1_000.01));
    // $500.00 and $500.01 — the odd cent goes to one of them, not nowhere.
    expect(plan.allocations.map((a) => a.amountCents).sort()).toEqual([cents(500), cents(500.01)]);
  });

  it('keeps thirds summing to the whole', () => {
    const thirds = [
      { entityId: 'a', name: 'A', sharePercent: 33.333 },
      { entityId: 'b', name: 'B', sharePercent: 33.333 },
      { entityId: 'c', name: 'C', sharePercent: 33.334 },
    ];
    const allocations = allocate(cents(1_000), thirds);
    expect(allocations.reduce((sum, a) => sum + a.amountCents, 0)).toBe(cents(1_000));
  });

  it('distributes nothing for a loss-making month', () => {
    const plan = planDistribution({ month: '2026-09', propertyId: RAVEN, netCashCents: cents(-800), owners: fiftyFifty });
    expect(plan.nothingToDistribute).toBe(true);
    expect(plan.allocations.every((a) => a.amountCents === 0)).toBe(true);
  });

  it('holds back a reserve before splitting', () => {
    const plan = planDistribution({
      month: '2026-09',
      propertyId: RAVEN,
      netCashCents: cents(4_000),
      owners: fiftyFifty,
      reserveCents: cents(1_000),
    });
    expect(plan.distributableCents).toBe(cents(3_000));
    expect(plan.allocations.map((a) => a.amountCents)).toEqual([cents(1_500), cents(1_500)]);
  });

  it('lets the amount be set by hand when the split is decided elsewhere', () => {
    const plan = planDistribution({
      month: '2026-09',
      propertyId: RAVEN,
      netCashCents: cents(4_000),
      owners: fiftyFifty,
      overrideDistributableCents: cents(2_500),
    });
    expect(plan.allocations.map((a) => a.amountCents)).toEqual([cents(1_250), cents(1_250)]);
  });

  it('splits by share where it is not even', () => {
    const plan = planDistribution({
      month: '2026-09',
      propertyId: RAVEN,
      netCashCents: cents(10_000),
      owners: [
        { entityId: ME, name: 'Owner', sharePercent: 70 },
        { entityId: INVESTOR, name: 'Investor', sharePercent: 30 },
      ],
    });
    expect(plan.allocations.map((a) => a.amountCents)).toEqual([cents(7_000), cents(3_000)]);
  });
});

describe('an investor’s capital account', () => {
  const entries: CapitalEntry[] = [
    { entityId: INVESTOR, propertyId: RAVEN, kind: 'contribution', date: '2025-04-01', amountCents: cents(120_000) },
    { entityId: INVESTOR, propertyId: RAVEN, kind: 'distribution', date: '2026-07-05', amountCents: cents(2_000) },
    { entityId: INVESTOR, propertyId: RAVEN, kind: 'distribution', date: '2026-08-05', amountCents: cents(2_150) },
  ];

  it('still owes the whole contribution back after profit has been paid', () => {
    // Netting profit against capital would quietly write off the obligation.
    const [position] = capitalPositions(entries, RAVEN);
    expect(position.contributedCents).toBe(cents(120_000));
    expect(position.profitDistributedCents).toBe(cents(4_150));
    expect(position.outstandingCents).toBe(cents(120_000));
  });

  it('reduces the outstanding balance only when capital is handed back', () => {
    const [position] = capitalPositions(
      [...entries, { entityId: INVESTOR, propertyId: RAVEN, kind: 'return_of_capital', date: '2027-01-15', amountCents: cents(50_000) }],
      RAVEN,
    );
    expect(position.returnedCents).toBe(cents(50_000));
    expect(position.outstandingCents).toBe(cents(70_000));
  });

  it('keeps each property’s capital separate', () => {
    const mixed: CapitalEntry[] = [
      ...entries,
      { entityId: INVESTOR, propertyId: 'property:other', kind: 'contribution', date: '2026-01-01', amountCents: cents(40_000) },
    ];
    expect(capitalPositions(mixed, RAVEN)[0].contributedCents).toBe(cents(120_000));
    expect(capitalPositions(mixed)[0].contributedCents).toBe(cents(160_000));
  });
});

describe('a quarterly private note', () => {
  const quarterly: LoanTerms = {
    originalPrincipalCents: cents(200_000),
    annualRatePercent: 12,
    startDate: '2026-01-01',
    firstPaymentDate: '2026-04-01',
    termMonths: 24,
    structure: 'interest_only_balloon',
    paymentFrequency: 'quarterly',
  };

  it('charges a quarter of a year’s interest per payment', () => {
    // 12% on 200,000 is 24,000 a year — 6,000 a quarter, not 2,000 a month.
    expect(periodInterest(cents(200_000), 12, 4)).toBe(cents(6_000));
    expect(buildSchedule(quarterly)[0].interestCents).toBe(cents(6_000));
  });

  it('has eight payments over two years, not twenty-four', () => {
    expect(paymentCountOf(quarterly)).toBe(8);
    expect(buildSchedule(quarterly)).toHaveLength(8);
  });

  it('falls due every third month', () => {
    const dates = buildSchedule(quarterly).map((r) => r.dueDate);
    expect(dates.slice(0, 4)).toEqual(['2026-04-01', '2026-07-01', '2026-10-01', '2027-01-01']);
  });

  it('appears only in the months it is actually due', () => {
    const schedule = buildSchedule(quarterly);
    const loan = {
      loanId: 'l1',
      lender: 'Private lender',
      propertyId: RAVEN,
      propertyName: 'Raven Springs',
      loanType: 'pml',
      schedule,
    };
    expect(paymentsDueIn('2026-04', [loan])).toHaveLength(1);
    expect(paymentsDueIn('2026-05', [loan])).toHaveLength(0);
    expect(paymentsDueIn('2026-07', [loan])).toHaveLength(1);
  });

  it('agrees with interest computed straight off the original sum lent', () => {
    expect(interestOn(cents(200_000), 12, 4)).toBe(buildSchedule(quarterly)[0].interestCents);
  });
});

describe('what has to go out this month', () => {
  const monthly: LoanTerms = {
    originalPrincipalCents: cents(120_000),
    annualRatePercent: 10,
    startDate: '2026-01-01',
    firstPaymentDate: '2026-02-01',
    termMonths: 36,
    structure: 'interest_only',
  };

  it('adds lender interest to owner distributions', () => {
    const due = paymentsDueIn('2026-09', [
      {
        loanId: 'l1',
        lender: 'Private lender',
        propertyId: RAVEN,
        propertyName: 'Raven Springs',
        loanType: 'pml',
        schedule: buildSchedule(monthly),
      },
    ]);
    const plan = planDistribution({ month: '2026-09', propertyId: RAVEN, netCashCents: cents(4_000), owners: fiftyFifty });
    const totals = payoutTotals(due, plan.allocations);

    expect(totals.lendersCents).toBe(cents(1_000)); // 10% of 120,000 ÷ 12
    expect(totals.ownersCents).toBe(cents(4_000));
    expect(totals.totalCents).toBe(cents(5_000));
    expect(totals.unpaidLendersCents).toBe(cents(1_000));
  });

  it('stops counting a payment as outstanding once it is recorded', () => {
    const due = paymentsDueIn('2026-09', [
      {
        loanId: 'l1',
        lender: 'Private lender',
        propertyId: RAVEN,
        propertyName: 'Raven Springs',
        loanType: 'pml',
        schedule: buildSchedule(monthly),
        actualPaymentDates: ['2026-09-01'],
      },
    ]);
    expect(due[0].paid).toBe(true);
    expect(payoutTotals(due, []).unpaidLendersCents).toBe(0);
  });
});

describe('bank against books on owner distributions', () => {
  const row = (over: Partial<Parameters<typeof reconcileDistributions>[0][number]> = {}) => ({
    propertyId: 'p1',
    propertyName: 'Raven',
    movements: [],
    recordedDistributionsCents: 0,
    recordedContributionsCents: 0,
    ...over,
  });

  it('ties when every transfer out has a distribution recorded against it', () => {
    const [check] = reconcileDistributions([
      row({
        movements: [
          { amountCents: cents(-2_000), categoryKey: 'owner_draw' },
          { amountCents: cents(-2_000), categoryKey: 'owner_draw' },
        ],
        recordedDistributionsCents: cents(4_000),
      }),
    ]);
    expect(check.bankDrawsCents).toBe(cents(4_000));
    expect(check.drawDifferenceCents).toBe(0);
    expect(check.status).toBe('tied');
  });

  it('flags a transfer that never got recorded', () => {
    const [check] = reconcileDistributions([
      row({
        movements: [{ amountCents: cents(-3_500), categoryKey: 'owner_draw' }],
        recordedDistributionsCents: cents(2_000),
      }),
    ]);
    expect(check.drawDifferenceCents).toBe(cents(1_500));
    expect(check.status).toBe('differs');
  });

  it('flags a distribution recorded twice against one transfer', () => {
    const [check] = reconcileDistributions([
      row({
        movements: [{ amountCents: cents(-2_000), categoryKey: 'owner_draw' }],
        recordedDistributionsCents: cents(4_000),
      }),
    ]);
    expect(check.drawDifferenceCents).toBe(cents(-2_000));
    expect(check.status).toBe('differs');
  });

  it('checks contributions on their own, not netted against draws', () => {
    // Netting would let a $2,000 unrecorded draw hide behind a $2,000
    // unrecorded contribution, and the capital position would still be wrong.
    const [check] = reconcileDistributions([
      row({
        movements: [
          { amountCents: cents(-2_000), categoryKey: 'owner_draw' },
          { amountCents: cents(2_000), categoryKey: 'owner_contribution' },
        ],
      }),
    ]);
    expect(check.drawDifferenceCents).toBe(cents(2_000));
    expect(check.contributionDifferenceCents).toBe(cents(2_000));
    expect(check.status).toBe('differs');
  });

  it('says there is nothing to check when neither side moved', () => {
    expect(reconcileDistributions([row()])[0].status).toBe('nothing_to_check');
  });

  it('ignores categories that are not owner movements', () => {
    const [check] = reconcileDistributions([
      row({ movements: [{ amountCents: cents(-800), categoryKey: 'electric' }] }),
    ]);
    expect(check.bankDrawsCents).toBe(0);
    expect(check.status).toBe('nothing_to_check');
  });
});
