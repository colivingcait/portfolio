import { describe, expect, it } from 'vitest';
import { horizonBounds, matchesKind, obligationsIn, viewedCents } from '../payouts';
import { cents } from '../money';

const row = (dueDate: string, interest: number, principal = 0, escrow = 0, actual = false) => ({
  dueDate,
  interestCents: cents(interest),
  principalCents: cents(principal),
  escrowCents: cents(escrow),
  paymentCents: cents(interest + principal),
  actual,
});

// A private note paid monthly, and a mortgage on autopay.
const NOTE = {
  loanId: 'note',
  lender: 'Laura Beeson',
  propertyId: 'p1',
  propertyName: 'Leland',
  loanType: 'pml',
  schedule: Array.from({ length: 12 }, (_, i) => row(`2026-${String(i + 1).padStart(2, '0')}-01`, 666.67)),
  stillOwedThisYearCents: cents(4_666.71),
  stillOwedToMaturityCents: cents(20_000.12),
  ratePercent: 10,
  borrowedCents: cents(80_000),
  paidToDateCents: 0,
  balanceCents: cents(80_000),
  maturityDate: '2028-11-01',
  daysToMaturity: 800,
  sharePercent: 50,
  guaranteed: false,
};

const MORTGAGE = {
  loanId: 'mortgage',
  lender: 'Shellpoint',
  propertyId: 'p2',
  propertyName: 'Raven',
  loanType: 'mortgage',
  schedule: Array.from({ length: 12 }, (_, i) => row(`2026-${String(i + 1).padStart(2, '0')}-01`, 1_548.02, 154.54, 1_029.33)),
  ratePercent: 10,
  borrowedCents: cents(240_000),
  paidToDateCents: 0,
  balanceCents: cents(240_000),
  maturityDate: '2028-11-01',
  daysToMaturity: 800,
  sharePercent: 50,
  guaranteed: false,
};

const QUARTERLY = {
  loanId: 'quarterly',
  lender: "Kathia's Mom",
  propertyId: 'p2',
  propertyName: 'Raven',
  loanType: 'pml',
  schedule: [row('2026-02-01', 100), row('2026-05-01', 100), row('2026-08-01', 100), row('2026-11-01', 100)],
  ratePercent: 10,
  borrowedCents: cents(12_000),
  paidToDateCents: 0,
  balanceCents: cents(12_000),
  maturityDate: '2028-11-01',
  daysToMaturity: 800,
  sharePercent: 50,
  guaranteed: false,
};

describe('how far ahead the debt table looks', () => {
  it('bounds each horizon on the calendar', () => {
    expect(horizonBounds('month', '2026-08')).toEqual({ from: '2026-08', to: '2026-08' });
    expect(horizonBounds('quarter', '2026-08')).toEqual({ from: '2026-07', to: '2026-09' });
    expect(horizonBounds('year', '2026-08')).toEqual({ from: '2026-01', to: '2026-12' });
  });

  it('runs to maturity forward from the month, not from the note’s start', () => {
    // What has already gone is history; a lump sum cannot be aimed at it.
    expect(horizonBounds('maturity', '2026-08')).toEqual({ from: '2026-08', to: null });
  });

  it('takes the whole quarter the month sits in, not the next three months', () => {
    expect(horizonBounds('quarter', '2026-01').from).toBe('2026-01');
    expect(horizonBounds('quarter', '2026-12')).toEqual({ from: '2026-10', to: '2026-12' });
  });

  it('rolls a year of a monthly note into one row', () => {
    const [note] = obligationsIn('year', '2026-08', 'pml', [NOTE]);
    expect(note.periods).toBe(12);
    expect(note.interestCents).toBe(cents(666.67) * 12);
  });

  it('shows one period for a month and none where a quarterly note does not fall', () => {
    expect(obligationsIn('month', '2026-08', 'pml', [QUARTERLY])[0].periods).toBe(1);
    // September is inside Q3 but the note is not due in it. It stays on the
    // list at nought, because a note you still owe is not gone.
    expect(obligationsIn('month', '2026-09', 'pml', [QUARTERLY])[0].periods).toBe(0);
    expect(obligationsIn('quarter', '2026-09', 'pml', [QUARTERLY])[0].periods).toBe(1);
  });

  it('separates the notes paid by hand from the ones on autopay', () => {
    const all = obligationsIn('month', '2026-08', 'all', [NOTE, MORTGAGE]);
    expect(all.map((r) => r.loanId).sort()).toEqual(['mortgage', 'note']);
    expect(all.find((r) => r.loanId === 'note')!.borrowedCents).toBe(cents(80_000));
    expect(obligationsIn('month', '2026-08', 'pml', [NOTE, MORTGAGE]).map((r) => r.loanId)).toEqual(['note']);
    expect(obligationsIn('month', '2026-08', 'mortgage', [NOTE, MORTGAGE]).map((r) => r.loanId)).toEqual(['mortgage']);
  });

  it('counts seller financing as a private note, because it is paid the same way', () => {
    expect(matchesKind('seller_financed', 'pml')).toBe(true);
    expect(matchesKind('seller_financed', 'mortgage')).toBe(false);
    expect(matchesKind('heloc', 'mortgage')).toBe(true);
    expect(matchesKind('heloc', 'all')).toBe(true);
  });

  it('carries escrow and principal through, so a mortgage row still ties', () => {
    const [m] = obligationsIn('quarter', '2026-08', 'mortgage', [MORTGAGE]);
    expect(m.periods).toBe(3);
    expect(m.escrowCents).toBe(cents(1_029.33) * 3);
    expect(m.totalCents).toBe((cents(1_548.02) + cents(154.54) + cents(1_029.33)) * 3);
  });

  it('separates what is due from what is still unpaid', () => {
    const paidJanToJul = {
      ...NOTE,
      schedule: NOTE.schedule.map((r, i) => ({ ...r, actual: i < 7 })),
    };
    const [note] = obligationsIn('year', '2026-08', 'pml', [paidJanToJul]);
    expect(note.totalCents).toBe(cents(666.67) * 12);
    expect(note.unpaidCents).toBe(cents(666.67) * 5);
    expect(note.nextDueDate).toBe('2026-08-01');
  });

  it('keeps the ledger figures alongside, so a lump can be aimed', () => {
    const [note] = obligationsIn('month', '2026-08', 'pml', [NOTE]);
    expect(note.stillOwedThisYearCents).toBe(cents(4_666.71));
    expect(note.stillOwedToMaturityCents).toBe(cents(20_000.12));
  });

  it('orders by what falls due next, then by lender where two land together', () => {
    // Over the year, the two monthly notes both start in January and the
    // quarterly one does not fall until February.
    const rows = obligationsIn('year', '2026-08', 'all', [MORTGAGE, NOTE, QUARTERLY]);
    expect(rows.map((r) => r.lender)).toEqual(['Laura Beeson', 'Shellpoint', "Kathia's Mom"]);

    // From August all three fall on the first, so the tie-break decides alone.
    const fromAugust = obligationsIn('maturity', '2026-08', 'all', [MORTGAGE, NOTE, QUARTERLY]);
    expect(fromAugust.map((r) => r.lender)).toEqual(["Kathia's Mom", 'Laura Beeson', 'Shellpoint']);
  });
});

describe('whose debt is being shown', () => {
  const half = { sharePercent: 50, guaranteed: false };
  const guaranteed = { sharePercent: 50, guaranteed: true };

  it('shows the whole obligation by default, because the company owes it whole', () => {
    expect(viewedCents(cents(80_000), 'whole', half)).toBe(cents(80_000));
    expect(viewedCents(cents(80_000), 'whole', guaranteed)).toBe(cents(80_000));
  });

  it('scales to your share where you have only a share', () => {
    expect(viewedCents(cents(80_000), 'prorata', half)).toBe(cents(40_000));
    expect(viewedCents(cents(80_000), 'prorata', { sharePercent: 0, guaranteed: false })).toBe(0);
  });

  it('never scales a note you have personally guaranteed', () => {
    // The whole point: a lender comes after the lot regardless of the share,
    // so this is the one figure that must not shrink when the view does.
    expect(viewedCents(cents(180_000), 'prorata', guaranteed)).toBe(cents(180_000));
  });
});
