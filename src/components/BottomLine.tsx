import Link from 'next/link';
import { Money, Panel, Td, Th } from './ui';
import { formatCents } from '@/lib/engine/money';

export interface WaterfallRow {
  propertyId: string;
  propertyName: string;
  isPadSplit: boolean;
  grossRentCents: number;
  platformFeesCents: number;
  pmFeeCents: number;
  adjustmentsCents: number;
  expectedDepositCents: number;
  depositReceivedCents: number;
  depositVarianceCents: number;
  ownerPaidOpexCents: number;
  debtServiceCents: number;
  bottomLineCents: number;
  hasStatement: boolean;
}

/**
 * Rent, the platform's cut, the costs and the debt, in one chain.
 *
 * This is the join nothing off the shelf makes. A bookkeeping tool sees the
 * deposit that landed and calls it revenue; a property tool sees the rent and
 * never sees the mortgage. Neither can say what the house actually made,
 * because each is missing half the chain — and the half they are missing is
 * where most of the money goes.
 *
 * Every line below is sourced from somewhere different: rent and fees from the
 * platform export, costs from the bank statement, debt service from the
 * amortization schedule. Reading them together is the entire point.
 */
export function BottomLine({ rows, period }: { rows: WaterfallRow[]; period: string }) {
  if (rows.length === 0) return null;

  const total = (pick: (row: WaterfallRow) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const missing = rows.filter((row) => !row.hasStatement);

  const LINES: { label: string; pick: (row: WaterfallRow) => number; source: string; sign: 'in' | 'out' | 'sub' }[] = [
    { label: 'Rent collected', pick: (r) => r.grossRentCents, source: 'PadSplit', sign: 'in' },
    { label: 'PadSplit fees', pick: (r) => -r.platformFeesCents, source: 'PadSplit', sign: 'out' },
    { label: 'Management fee', pick: (r) => -r.pmFeeCents, source: 'derived', sign: 'out' },
    { label: 'Lands in the bank', pick: (r) => r.expectedDepositCents, source: '', sign: 'sub' },
    { label: 'Operating costs', pick: (r) => -r.ownerPaidOpexCents, source: 'statements', sign: 'out' },
    { label: 'Debt service', pick: (r) => -r.debtServiceCents, source: 'schedules', sign: 'out' },
    { label: 'Bottom line', pick: (r) => r.bottomLineCents, source: '', sign: 'sub' },
  ];

  return (
    <Panel
      title={`What the houses actually made · ${period}`}
      description="Rent from PadSplit, costs from the bank, debt from the schedules. Each line comes from a different source, and no single one of them can answer this question alone."
    >
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <Th>Line</Th>
              {rows.map((row) => (
                <Th key={row.propertyId} right>
                  {row.propertyName}
                </Th>
              ))}
              <Th right>Total</Th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((line) => {
              const isSubtotal = line.sign === 'sub';
              const grand = total(line.pick);
              if (!isSubtotal && grand === 0) return null;
              return (
                <tr key={line.label} className={isSubtotal ? 'border-t border-line' : ''}>
                  <Td>
                    {isSubtotal ? <strong>{line.label}</strong> : <span className="pl-3">{line.label}</span>}
                    {line.source ? <span className="ml-2 text-[11px] text-muted">{line.source}</span> : null}
                  </Td>
                  {rows.map((row) => {
                    const value = line.pick(row);
                    return (
                      <Td key={row.propertyId} right>
                        {value === 0 && !isSubtotal ? (
                          <span className="num text-muted">—</span>
                        ) : isSubtotal ? (
                          <strong className={value < 0 ? 'text-bad' : ''}>{formatCents(value)}</strong>
                        ) : (
                          <span className={line.sign === 'out' ? 'text-muted' : ''}>{formatCents(value)}</span>
                        )}
                      </Td>
                    );
                  })}
                  <Td right>
                    {isSubtotal ? (
                      <strong className={grand < 0 ? 'text-bad' : ''}>{formatCents(grand)}</strong>
                    ) : (
                      <span className={line.sign === 'out' ? 'text-muted' : ''}>{formatCents(grand)}</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {missing.length > 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-warn">
          No bank statement imported for {missing.map((row) => row.propertyName).join(', ')} over this period, so{' '}
          {missing.length === 1 ? 'its' : 'their'} operating costs are missing and the bottom line above is
          overstated. <Link href="/imports" className="underline">Import the statement</Link> to close it.
        </p>
      ) : null}

      {rows.some((row) => row.hasStatement && row.depositVarianceCents !== 0) ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Deposit check:{' '}
          {rows
            .filter((row) => row.hasStatement && row.depositVarianceCents !== 0)
            .map((row) => `${row.propertyName} ${formatCents(row.depositVarianceCents)} against what PadSplit said it would pay`)
            .join(', ')}
          . A gap here is a deposit that arrived short, late, or into another account.
        </p>
      ) : null}
    </Panel>
  );
}

/** Money in less money out, from a rollup row. */
export function bottomLineOf(row: {
  expectedDepositCents: number;
  ownerPaidOpexCents: number;
  debtServiceCents: number;
}): number {
  return row.expectedDepositCents - row.ownerPaidOpexCents - row.debtServiceCents;
}
