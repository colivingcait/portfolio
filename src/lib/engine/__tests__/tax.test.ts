import { describe, expect, it } from 'vitest';
import { buildScheduleE, mappingTable, type TaxTransaction } from '../tax';
import { isCapitalizable, keyFromLabel, mergeCatalog, taxLineFor, taxTreatmentFor } from '../categories';
import { cents } from '../money';

function tx(categoryKey: string | null, amount: number, date = '2026-03-15'): TaxTransaction {
  return { date, categoryKey, amountCents: cents(amount), description: categoryKey ?? 'unknown' };
}

describe('the mapping stays behind the scenes', () => {
  it('sends every utility to one line without changing what you pick', () => {
    for (const key of ['electric', 'gas', 'water_sewer', 'trash', 'internet']) {
      expect(taxLineFor(key)).toBe('utilities');
    }
  });

  it('separates repairs from cleaning, as the form does', () => {
    expect(taxLineFor('maintenance_repairs')).toBe('repairs');
    expect(taxLineFor('turn_cleaning')).toBe('cleaning_maintenance');
    expect(taxLineFor('lawn')).toBe('cleaning_maintenance');
  });

  it('treats furnishings and capex as depreciable, never deductible', () => {
    expect(isCapitalizable('furnishings')).toBe(true);
    expect(isCapitalizable('capex')).toBe(true);
    expect(isCapitalizable('supplies')).toBe(false);
  });

  it('does not report deposits, transfers or owner cash', () => {
    for (const key of ['security_deposit_received', 'transfer_between_own_accounts', 'owner_draw', 'not_portfolio']) {
      expect(taxTreatmentFor(key)).toBe('not_reportable');
    }
  });

  it('keeps debt service off the form, since only its interest half is deductible', () => {
    expect(taxTreatmentFor('debt_service')).toBe('not_reportable');
  });

  it('gives every category a treatment, so nothing falls through unclassified', () => {
    expect(mappingTable().every((row) => row.treatment !== undefined)).toBe(true);
  });
});

describe('building a year', () => {
  const transactions: TaxTransaction[] = [
    tx('rental_income', 1_850, '2026-02-01'),
    tx('rental_income', 1_850, '2026-03-01'),
    tx('electric', -320, '2026-02-05'),
    tx('gas', -80, '2026-02-06'),
    tx('lawn', -95, '2026-03-12'),
    tx('maintenance_repairs', -450, '2026-03-20'),
    tx('insurance', -1_200, '2026-01-15'),
    tx('property_tax', -2_400, '2026-11-01'),
    tx('furnishings', -3_000, '2026-04-02'),
    tx('security_deposit_received', 1_850, '2026-02-01'),
    tx('transfer_between_own_accounts', -1_000, '2026-05-01'),
    tx('debt_service', -1_137.72, '2026-02-06'),
    tx('rental_income', 1_850, '2025-12-01'), // prior year, must not count
  ];

  const report = buildScheduleE({
    year: 2026,
    propertyId: 'p1',
    transactions,
    mortgageInterestCents: cents(9_500),
  });

  it('counts only the year asked for', () => {
    expect(report.grossRentsCents).toBe(cents(3_700));
  });

  it('rolls the operational categories into their lines', () => {
    const utilities = report.lines.find((l) => l.line === 'utilities')!;
    expect(utilities.amountCents).toBe(cents(400));
    expect(utilities.from.map((f) => f.categoryKey).sort()).toEqual(['electric', 'gas']);

    expect(report.lines.find((l) => l.line === 'cleaning_maintenance')!.amountCents).toBe(cents(95));
    expect(report.lines.find((l) => l.line === 'repairs')!.amountCents).toBe(cents(450));
    expect(report.lines.find((l) => l.line === 'taxes')!.amountCents).toBe(cents(2_400));
  });

  it('takes mortgage interest from the schedule, not from the bank line', () => {
    // The statement shows one $1,137.72 debit; only its interest half is
    // deductible, and the schedule is what knows the split.
    expect(report.lines.find((l) => l.line === 'mortgage_interest')!.amountCents).toBe(cents(9_500));
    expect(report.lines.find((l) => l.line === 'mortgage_interest')!.from[0].label).toContain('amortization');
  });

  it('keeps furnishings out of expenses and lists them for depreciation', () => {
    expect(report.capitalizableTotalCents).toBe(cents(3_000));
    expect(report.totalExpensesCents).not.toContain(cents(3_000));
    expect(report.lines.find((l) => l.line === 'depreciation')!.amountCents).toBe(0);
    expect(report.warnings.some((w) => /depreciated/.test(w))).toBe(true);
  });

  it('nets income against deductible expenses only', () => {
    // 3,700 rents − (400 utilities + 95 + 450 + 1,200 insurance + 2,400 tax + 9,500 interest)
    expect(report.totalExpensesCents).toBe(cents(14_045));
    expect(report.netIncomeCents).toBe(cents(-10_345));
  });

  it('holds deposits, transfers and debt service aside rather than reporting them', () => {
    // The whole mortgage debit sits here, not just its principal half: the
    // deductible interest is added back from the schedule instead.
    expect(report.excludedCents).toBe(cents(1_850) - cents(1_000) - cents(1_137.72));
  });

  it('says plainly when the year is not finished', () => {
    const withGaps = buildScheduleE({
      year: 2026,
      propertyId: 'p1',
      transactions: [...transactions, tx(null, -145, '2026-06-01')],
      mortgageInterestCents: 0,
    });
    expect(withGaps.uncategorizedCount).toBe(1);
    expect(withGaps.warnings.some((w) => /uncategorized/.test(w))).toBe(true);
  });
});

describe('categories added later', () => {
  it('turns a label into a stable key', () => {
    expect(keyFromLabel('Pest control')).toBe('pest_control');
    expect(keyFromLabel('Turn & Cleaning')).toBe('turn_and_cleaning');
    expect(keyFromLabel('  Pool / Spa  ')).toBe('pool_spa');
  });

  it('behaves exactly like a built-in at year end', () => {
    const catalog = mergeCatalog([
      { key: 'pool_service', label: 'Pool service', class: 'expense', taxTreatment: 'deductible', taxLine: 'cleaning_maintenance' },
    ]);
    const report = buildScheduleE({
      year: 2026,
      propertyId: 'p1',
      transactions: [tx('pool_service', -220, '2026-05-01'), tx('lawn', -95, '2026-05-02')],
      mortgageInterestCents: 0,
      catalog,
    });
    // Both land on the same line, from the same code path.
    expect(report.lines.find((l) => l.line === 'cleaning_maintenance')!.amountCents).toBe(cents(315));
  });

  it('lets a custom entry replace a built-in it shares a key with', () => {
    const catalog = mergeCatalog([
      { key: 'home_warranty', label: 'Home warranty', class: 'expense', taxTreatment: 'deductible', taxLine: 'insurance' },
    ]);
    const report = buildScheduleE({
      year: 2026,
      propertyId: 'p1',
      transactions: [tx('home_warranty', -680, '2026-07-12')],
      mortgageInterestCents: 0,
      catalog,
    });
    // Built in it goes to repairs; overridden here it goes to insurance.
    expect(report.lines.find((l) => l.line === 'insurance')!.amountCents).toBe(cents(680));
    expect(report.lines.find((l) => l.line === 'repairs')!.amountCents).toBe(0);
  });

  it('keeps borrowed money out of income', () => {
    // A loan funding a repair is not revenue; the repair is classified on its
    // own merits and the interest is deductible as it is paid.
    const report = buildScheduleE({
      year: 2026,
      propertyId: 'p1',
      transactions: [tx('loan_proceeds', 18_000, '2026-04-01'), tx('capex', -18_000, '2026-04-08')],
      mortgageInterestCents: 0,
    });
    expect(report.grossRentsCents).toBe(0);
    expect(report.excludedCents).toBe(cents(18_000));
    expect(report.capitalizableTotalCents).toBe(cents(18_000));
    expect(report.totalExpensesCents).toBe(0);
  });
});

describe('escrow inside a mortgage payment', () => {
  const base = { year: 2026, propertyId: 'p1', transactions: [], mortgageInterestCents: 0 };

  it('puts what the servicer disbursed on the taxes and insurance lines', () => {
    const report = buildScheduleE({
      ...base,
      escrowPaidCents: cents(4_200),
      escrowTaxCents: cents(2_400),
      escrowInsuranceCents: cents(1_800),
    });
    const taxes = report.lines.find((l) => l.line === 'taxes');
    const insurance = report.lines.find((l) => l.line === 'insurance');
    expect(taxes?.amountCents).toBe(cents(2_400));
    expect(insurance?.amountCents).toBe(cents(1_800));
    expect(report.unallocatedEscrowCents).toBe(0);
  });

  it('deducts nothing and says so when the split is unknown', () => {
    // Paying into escrow is not a deduction; guessing the split would put a
    // made-up number on a tax return.
    const report = buildScheduleE({ ...base, escrowPaidCents: cents(4_200) });
    expect(report.lines.find((l) => l.line === 'taxes')?.amountCents ?? 0).toBe(0);
    expect(report.unallocatedEscrowCents).toBe(cents(4_200));
    expect(report.warnings.some((w) => w.includes('escrow'))).toBe(true);
    expect(report.totalExpensesCents).toBe(0);
  });

  it('reports only the remainder when the split covers part of what went in', () => {
    const report = buildScheduleE({
      ...base,
      escrowPaidCents: cents(4_200),
      escrowTaxCents: cents(2_400),
    });
    expect(report.unallocatedEscrowCents).toBe(cents(1_800));
  });

  it('never reports negative escrow when disbursements exceed payments in', () => {
    // A shortage the servicer covered, then billed for. Not a memo item.
    const report = buildScheduleE({
      ...base,
      escrowPaidCents: cents(4_200),
      escrowTaxCents: cents(3_000),
      escrowInsuranceCents: cents(2_000),
    });
    expect(report.unallocatedEscrowCents).toBe(0);
  });

  it('keeps escrow out of the interest line', () => {
    const report = buildScheduleE({
      ...base,
      mortgageInterestCents: cents(9_000),
      escrowPaidCents: cents(4_200),
      escrowTaxCents: cents(2_400),
    });
    expect(report.lines.find((l) => l.line === 'mortgage_interest')?.amountCents).toBe(cents(9_000));
  });
});
