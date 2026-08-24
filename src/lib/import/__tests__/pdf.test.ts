import { describe, expect, it } from 'vitest';
import { groupIntoLines, rowsFromLines, type PdfLine, type PdfTextItem } from '../pdf';
import { cents } from '../../engine/money';

/** A line as pdfjs would hand it over: separate items at x positions. */
function line(y: number, items: [string, number][]): PdfLine {
  const built: PdfTextItem[] = items.map(([text, x]) => ({ text, x, y }));
  return {
    page: 1,
    y,
    text: built.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim(),
    items: built,
  };
}

describe('reconstructing lines from positioned glyphs', () => {
  it('groups items sharing a baseline, left to right', () => {
    const items: PdfTextItem[] = [
      { text: 'GEORGIA', x: 120, y: 500 },
      { text: '06/05', x: 60, y: 500 },
      { text: 'POWER', x: 190, y: 500 },
      { text: 'RENT', x: 60, y: 480 },
    ];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('06/05 GEORGIA POWER');
    expect(lines[1].text).toBe('RENT');
  });

  it('tolerates a baseline that wobbles by a point or two', () => {
    const lines = groupIntoLines([
      { text: 'A', x: 10, y: 500 },
      { text: 'B', x: 40, y: 501 },
    ]);
    expect(lines).toHaveLength(1);
  });

  it('orders lines down the page', () => {
    const lines = groupIntoLines([
      { text: 'lower', x: 10, y: 100 },
      { text: 'upper', x: 10, y: 700 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['upper', 'lower']);
  });
});

describe('a statement with a running balance', () => {
  // Deliberately printed as bare positive figures, the way most statements do:
  // direction is conveyed by the balance moving, not by a minus sign.
  const lines = [
    line(760, [['06/01/2026 through 06/30/2026', 60]]),
    line(700, [['Beginning Balance', 60], ['1,000.00', 500]]),
    line(680, [['06/01', 60], ['ACH CREDIT RENT UNIT A', 120], ['1,850.00', 400], ['2,850.00', 500]]),
    line(660, [['06/05', 60], ['GEORGIA POWER', 120], ['320.00', 400], ['2,530.00', 500]]),
    line(640, [['06/06', 60], ['MORTGAGE PMT', 120], ['1,137.72', 400], ['1,392.28', 500]]),
    line(600, [['Ending Balance', 60], ['1,392.28', 500]]),
  ];

  const draft = rowsFromLines(lines);

  it('takes the direction from how the balance moved, not from the printed sign', () => {
    expect(draft.signSource).toBe('running_balance');
    expect(draft.transactions.map((t) => t.amountCents)).toEqual([
      cents(1_850),
      cents(-320),
      cents(-1_137.72),
    ]);
  });

  it('reads the opening and closing balances off the summary lines', () => {
    expect(draft.openingBalanceCents).toBe(cents(1_000));
    expect(draft.closingBalanceCents).toBe(cents(1_392.28));
  });

  it('keeps the description and drops the figures out of it', () => {
    expect(draft.transactions[1].description).toBe('GEORGIA POWER');
  });

  it('carries the running balance through for the tie check', () => {
    expect(draft.transactions[2].runningBalanceCents).toBe(cents(1_392.28));
  });

  it('refuses a row whose printed figure disagrees with the balance movement', () => {
    // 2,530.00 → 1,000.00 is a move of 1,530, but the row claims 137.72.
    const broken = [
      line(760, [['06/01/2026 through 06/30/2026', 60]]),
      line(700, [['Beginning Balance', 60], ['2,850.00', 500]]),
      line(680, [['06/05', 60], ['GEORGIA POWER', 120], ['320.00', 400], ['2,530.00', 500]]),
      line(660, [['06/06', 60], ['MISREAD ROW', 120], ['137.72', 400], ['1,000.00', 500]]),
    ];
    const result = rowsFromLines(broken);
    expect(result.transactions).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('balance moves by');
  });
});

describe('a statement with no running balance', () => {
  // Withdrawals column at x=380, deposits at x=470.
  const lines = [
    line(760, [['06/01/2026 through 06/30/2026', 60]]),
    line(680, [['06/01', 60], ['RENT UNIT A', 120], ['1,850.00', 470]]),
    line(660, [['06/05', 60], ['GEORGIA POWER', 120], ['320.00', 380]]),
    line(640, [['06/12', 60], ['LAWN SERVICE', 120], ['95.00', 380]]),
  ];

  const draft = rowsFromLines(lines);

  it('falls back to the column a figure sits in', () => {
    expect(draft.signSource).toBe('column_position');
    expect(draft.transactions.map((t) => t.amountCents)).toEqual([
      cents(1_850),
      cents(-320),
      cents(-95),
    ]);
  });
});

describe('lines that are not transactions', () => {
  it('ignores headers, page furniture and totals with no date', () => {
    const draft = rowsFromLines([
      line(780, [['06/01/2026 through 06/30/2026', 60]]),
      line(760, [['STATEMENT OF ACCOUNT', 60]]),
      line(740, [['Account number 1234567890', 60]]),
      line(720, [['Date', 60], ['Description', 120], ['Amount', 400]]),
      line(700, [['Page 1 of 3', 60]]),
      line(680, [['06/01', 60], ['RENT', 120], ['1,850.00', 400]]),
    ]);
    expect(draft.transactions).toHaveLength(1);
    expect(draft.transactions[0].description).toBe('RENT');
  });

  it('does not mistake a reference number for an amount', () => {
    const draft = rowsFromLines([
      line(760, [['06/01/2026 through 06/30/2026', 60]]),
      line(680, [['06/01', 60], ['ACH ID 883120 RENT', 120], ['1,850.00', 400]]),
    ]);
    expect(draft.transactions[0].amountCents).toBe(cents(1_850));
  });

  it('returns nothing rather than throwing on a PDF with no transactions in it', () => {
    const draft = rowsFromLines([line(700, [['Nothing here', 60]])]);
    expect(draft.transactions).toEqual([]);
    expect(draft.openingBalanceCents).toBeNull();
  });
});


describe('a statement that conveys direction by section, not by sign', () => {
  // Chase prints every figure as a bare positive under a heading that says
  // which way it runs, and carries no running balance column at all.
  const lines = [
    line(800, [['July 01, 2026 through July 31, 2026', 60]]),
    line(780, [['CHECKING SUMMARY', 60]]),
    line(770, [['Beginning Balance', 60], ['5,000.00', 500]]),
    line(760, [['Ending Balance', 60], ['27', 300], ['3,850.00', 500]]),
    line(740, [['DEPOSITS AND ADDITIONS', 60]]),
    line(730, [['DATE', 60], ['DESCRIPTION', 120], ['AMOUNT', 400]]),
    line(720, [['07/07', 60], ['Orig CO Name:Padsplit, Inc. Orig ID:123', 120], ['1,850.00', 400]]),
    line(710, [['Ind Name:466 Raven Springs LLC Trn: 188', 120]]),
    line(700, [['Total Deposits and Additions', 60], ['1,850.00', 400]]),
    line(680, [['ELECTRONIC WITHDRAWALS', 60]]),
    line(670, [['DATE', 60], ['DESCRIPTION', 120], ['AMOUNT', 400]]),
    line(660, [['07/03', 60], ['Online Transfer To Chk ...0977', 120], ['2,000.00', 400]]),
    line(650, [['07/07', 60], ['Orig CO Name:Dekalb CO GA', 120], ['1,000.00', 400]]),
    line(640, [['Total Electronic Withdrawals', 60], ['3,000.00', 400]]),
    line(600, [['DAILY ENDING BALANCE', 60]]),
    line(590, [['07/01', 60], ['5,905.33', 200], ['07/09', 300], ['5,189.60', 400]]),
    line(580, [['07/17', 60], ['3,850.00', 200]]),
  ];

  const draft = rowsFromLines(lines);

  it('reads direction from the heading each row sits under', () => {
    expect(draft.signSource).toBe('section_heading');
    expect(draft.transactions.map((t) => t.amountCents)).toEqual([
      cents(1_850),
      cents(-2_000),
      cents(-1_000),
    ]);
  });

  it('does not let a column header clear the section its own rows belong to', () => {
    // DATE DESCRIPTION AMOUNT looks like a heading and means nothing.
    expect(draft.transactions[0].amountCents).toBeGreaterThan(0);
  });

  it('ignores the daily ending balance table, which would double the statement', () => {
    expect(draft.transactions).toHaveLength(3);
    expect(draft.transactions.every((t) => t.date !== '2026-07-17')).toBe(true);
  });

  it('reads a closing balance printed after an instance count', () => {
    expect(draft.openingBalanceCents).toBe(cents(5_000));
    expect(draft.closingBalanceCents).toBe(cents(3_850));
  });

  it('ties: opening plus the movements equals closing', () => {
    const movement = draft.transactions.reduce((sum, t) => sum + t.amountCents, 0);
    expect(draft.openingBalanceCents! + movement).toBe(draft.closingBalanceCents);
  });

  it('takes the year from the statement period, not from today', () => {
    expect(draft.periodStart).toBe('2026-07-01');
    expect(draft.transactions.every((t) => t.date.startsWith('2026-07'))).toBe(true);
  });

  it('keeps a continued description, where the payer name usually lands', () => {
    expect(draft.transactions[0].description).toContain('466 Raven Springs');
  });

  it('checks each section against the total the statement printed for it', () => {
    const deposits = draft.sectionChecks.find((c) => /deposits/i.test(c.section));
    expect(deposits?.agrees).toBe(true);
  });

  it('refuses to date a row at all when nothing says which year it is', () => {
    // Guessing the current year would silently misfile an old statement.
    const undated = rowsFromLines([
      line(740, [['DEPOSITS AND ADDITIONS', 60]]),
      line(720, [['07/07', 60], ['SOMETHING', 120], ['100.00', 400]]),
    ]);
    expect(undated.transactions).toHaveLength(0);
  });
});
