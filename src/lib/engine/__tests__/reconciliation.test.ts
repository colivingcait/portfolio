import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PM_FEE_PERCENT,
  checkChargedFee,
  feeAsShareOfHostEarnings,
  pmFee,
  reconcileDirect,
  reconcileMonth,
  reconcilePmPadSplitReduced,
  reconcileSelfManagedPadSplit,
} from '../reconciliation';
import {
  comparabilityWarning,
  crossesBoundary,
  managementBoundaries,
  managementForMonth,
  modeForMonth,
  type ManagementPeriod,
} from '../management';
import { cents } from '../money';

const HOUSE = 'property:candace';

// The coliving houses: self-managed through July 2026, PM-managed from
// August 2026 at 10.5% of gross collected (§4).
const periods: ManagementPeriod[] = [
  {
    id: 'mp-self',
    propertyId: HOUSE,
    startDate: '2023-01-01',
    endDate: '2026-07-31',
    mode: 'self',
    managerName: null,
    feePercent: null,
    feeBasis: null,
  },
  {
    id: 'mp-pm',
    propertyId: HOUSE,
    startDate: '2026-08-01',
    endDate: null,
    mode: 'pm',
    managerName: 'Third-party PM',
    feePercent: 10.5,
    feeBasis: 'gross_collected',
  },
];

describe('management periods (§4)', () => {
  it('resolves the era from the earnings month, with no special case in the code', () => {
    expect(modeForMonth(periods, HOUSE, '2026-06')).toBe('self');
    expect(modeForMonth(periods, HOUSE, '2026-07')).toBe('self');
    expect(modeForMonth(periods, HOUSE, '2026-08')).toBe('pm');
    expect(modeForMonth(periods, HOUSE, '2027-01')).toBe('pm');
  });

  it('returns null before any period starts', () => {
    expect(modeForMonth(periods, HOUSE, '2022-12')).toBeNull();
  });

  it('flags a split month as a transition rather than prorating the fee', () => {
    const split: ManagementPeriod[] = [
      { ...periods[0], endDate: '2026-08-14' },
      { ...periods[1], startDate: '2026-08-15' },
    ];
    const august = managementForMonth(split, HOUSE, '2026-08');
    expect(august.transition).toBe(true);
    // When the PM's statement exists, it is the truth for the month.
    expect(august.effective?.mode).toBe('pm');
  });

  it('marks the boundary on any trend that crosses it', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const boundaries = managementBoundaries(periods, HOUSE, months);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].month).toBe('2026-08');
    expect(boundaries[0].from).toBe('self');
    expect(boundaries[0].to).toBe('pm');
    expect(crossesBoundary(periods, HOUSE, months)).toBe(true);
    expect(comparabilityWarning(periods, HOUSE, months)).toContain('unpriced own labour');
  });

  it('says nothing about comparability where no boundary is crossed', () => {
    expect(comparabilityWarning(periods, HOUSE, ['2026-05', '2026-06'])).toBeNull();
  });
});

describe('the PM fee (§9) — derived, never entered', () => {
  it('is 10.5% of gross collected', () => {
    expect(pmFee({ grossCollectedCents: cents(10_000), hostEarningsCents: cents(8_700), netBilledCents: cents(11_000) }, periods[1])).toBe(cents(1_050));
    expect(DEFAULT_PM_FEE_PERCENT).toBe(10.5);
  });

  it('is zero for months covered by a self-managed period', () => {
    expect(pmFee({ grossCollectedCents: cents(10_000), hostEarningsCents: cents(8_700), netBilledCents: cents(11_000) }, periods[0])).toBe(0);
  });

  it('rides on collected, not billed: delinquency reduces it', () => {
    const billedBasis = pmFee({ grossCollectedCents: cents(8_000), hostEarningsCents: cents(7_000), netBilledCents: cents(10_000) }, periods[1]);
    expect(billedBasis).toBe(cents(840)); // 10.5% of 8,000, not of 10,000
  });

  it('inflates above 10.5% of billings in an arrears catch-up month', () => {
    const fee = pmFee({ grossCollectedCents: cents(12_000), hostEarningsCents: cents(10_400), netBilledCents: cents(10_000) }, periods[1]);
    expect(fee).toBe(cents(1_260));
    expect(fee / cents(10_000)).toBeGreaterThan(0.105);
  });

  it('lands near 12% of host earnings, because PadSplit takes its cut first', () => {
    // Gross 10,000; PadSplit fees ~1,300; host earnings 8,700.
    const fee = pmFee({ grossCollectedCents: cents(10_000), hostEarningsCents: cents(8_700), netBilledCents: cents(10_000) }, periods[1]);
    const share = feeAsShareOfHostEarnings(fee, cents(8_700))!;
    expect(share).toBeGreaterThan(11.5);
    expect(share).toBeLessThan(12.5);
  });

  it('flags a disagreement between the derived fee and the fee charged', () => {
    expect(checkChargedFee(cents(1_050), cents(1_050))).toEqual({ agrees: true, differenceCents: 0 });
    expect(checkChargedFee(cents(1_050), cents(1_100))).toEqual({ agrees: false, differenceCents: cents(50) });
    expect(checkChargedFee(cents(1_050), null)).toBeNull();
  });
});

describe('self-managed PadSplit (§5): deposit_to_house = host_earnings', () => {
  it('ties when the deposit equals host earnings', () => {
    const r = reconcileSelfManagedPadSplit({ hostEarningsCents: cents(5_100), actualDepositCents: cents(5_100) });
    expect(r.status).toBe('tied');
    expect(r.differenceCents).toBe(0);
  });

  it('does not tie when something is missing or misfiled', () => {
    const r = reconcileSelfManagedPadSplit({ hostEarningsCents: cents(5_100), actualDepositCents: cents(4_900) });
    expect(r.status).toBe('does_not_tie');
    expect(r.differenceCents).toBe(cents(-200));
  });

  it('does not tie when no deposit has been matched at all', () => {
    expect(reconcileSelfManagedPadSplit({ hostEarningsCents: cents(5_100), actualDepositCents: null }).status).toBe('does_not_tie');
  });
});

describe('PM-managed PadSplit, reduced form (§5)', () => {
  it('posts the residual as a single underived PM opex line', () => {
    // host 8,700 − fee 1,050 = expected 7,650; 6,900 landed.
    const r = reconcilePmPadSplitReduced({
      hostEarningsCents: cents(8_700),
      grossCollectedCents: cents(10_000),
      actualDepositCents: cents(6_900),
      period: periods[1],
    });
    expect(r.pmFeeCents).toBe(cents(1_050));
    expect(r.expectedDepositCents).toBe(cents(7_650));
    expect(r.pmPaidOpexUnderivedCents).toBe(cents(750));
    expect(r.status).toBe('awaiting_pm_statement');
  });

  it('awaits the statement when no deposit has landed', () => {
    const r = reconcilePmPadSplitReduced({
      hostEarningsCents: cents(8_700),
      grossCollectedCents: cents(10_000),
      actualDepositCents: null,
      period: periods[1],
    });
    expect(r.status).toBe('awaiting_pm_statement');
    expect(r.pmPaidOpexUnderivedCents).toBe(0);
  });

  it('ties once itemized detail accounts for the residual, with the identity unchanged', () => {
    const r = reconcilePmPadSplitReduced({
      hostEarningsCents: cents(8_700),
      grossCollectedCents: cents(10_000),
      actualDepositCents: cents(6_900),
      period: periods[1],
      itemizedPmOpexCents: cents(750),
    });
    expect(r.status).toBe('tied');
    expect(r.pmPaidOpexUnderivedCents).toBe(0);
  });

  it('does not tie when the itemization disagrees with the residual', () => {
    const r = reconcilePmPadSplitReduced({
      hostEarningsCents: cents(8_700),
      grossCollectedCents: cents(10_000),
      actualDepositCents: cents(6_900),
      period: periods[1],
      itemizedPmOpexCents: cents(600),
    });
    expect(r.status).toBe('does_not_tie');
    expect(r.pmPaidOpexUnderivedCents).toBe(cents(150));
  });
});

describe('direct, self-managed — the duplex (§5)', () => {
  it('nets categorized income against expense and debt service', () => {
    expect(
      reconcileDirect({ incomeCents: cents(3_200), expenseCents: cents(900), debtServiceCents: cents(1_450) }).netCashCents,
    ).toBe(cents(850));
  });
});

describe('one entry point picks the identity from the month', () => {
  it('applies no PM fee to a historical self-managed month', () => {
    const r = reconcileMonth({
      propertyId: HOUSE,
      month: '2026-06',
      revenueSource: 'padsplit',
      periods,
      hostEarningsCents: cents(5_100),
      grossCollectedCents: cents(6_000),
      actualDepositCents: cents(5_100),
    });
    expect(r.mode).toBe('self');
    expect(r.pmFeeCents).toBe(0);
    expect(r.status).toBe('tied');
  });

  it('applies the PM identity from August onward', () => {
    const r = reconcileMonth({
      propertyId: HOUSE,
      month: '2026-08',
      revenueSource: 'padsplit',
      periods,
      hostEarningsCents: cents(8_700),
      grossCollectedCents: cents(10_000),
      actualDepositCents: cents(6_900),
    });
    expect(r.mode).toBe('pm');
    expect(r.pmFeeCents).toBe(cents(1_050));
    expect(r.pmPaidOpexUnderivedCents).toBe(cents(750));
  });

  it('treats a direct property as categorized income with no remittance to tie', () => {
    const duplexPeriods: ManagementPeriod[] = [
      { id: 'mp-duplex', propertyId: 'property:duplex', startDate: '2024-01-01', endDate: null, mode: 'self', managerName: null, feePercent: null, feeBasis: null },
    ];
    const r = reconcileMonth({
      propertyId: 'property:duplex',
      month: '2026-08',
      revenueSource: 'direct',
      periods: duplexPeriods,
      hostEarningsCents: 0,
      grossCollectedCents: 0,
      actualDepositCents: null,
      incomeCents: cents(3_200),
    });
    expect(r.status).toBe('tied');
    expect(r.pmFeeCents).toBe(0);
    expect(r.expectedDepositCents).toBe(cents(3_200));
  });
});
