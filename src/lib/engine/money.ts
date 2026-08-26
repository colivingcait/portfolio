/**
 * Money is integer cents everywhere in the engine. Never floats.
 *
 * Rationale: this tool exists to tie to a bank statement to the penny (§7).
 * Floating point cannot make that promise, and a reconciliation engine that
 * is off by 1c is worse than no reconciliation engine.
 */

export type Cents = number;

export function cents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function toDollars(c: Cents): number {
  return c / 100;
}

/** Round half away from zero — matches how statements round, not banker's rounding. */
export function roundCents(value: number): Cents {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

/** percent is a whole-number percentage: 10.5 means 10.5%. */
export function pctOf(amount: Cents, percent: number): Cents {
  return roundCents((amount * percent) / 100);
}

export function formatCents(c: Cents, opts: { sign?: boolean } = {}): string {
  const s = (Math.abs(c) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (c < 0) return `-${s}`;
  return opts.sign ? `+${s}` : s;
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Median of a numeric list. Returns null for an empty list rather than NaN. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : roundCents((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Cents from typed dollars, tolerant of $ and commas. Null where unreadable. */
export function parseDollars(text: string): Cents | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/**
 * A piece of a split takes the sign of the charge it came out of.
 *
 * Splitting a $312.99 debit into supplies and a capital improvement is two
 * amounts that read $200.00 and $112.99, and that is what a person types. Read
 * literally those are credits, so the pieces summed to +$312.99 against a
 * −$312.99 charge and the editor said "over" at someone who had done nothing
 * wrong. The magnitude is what is being asked for; the direction was settled by
 * the bank and is not the typist's to change.
 */
export function splitPieceCents(text: string, parentCents: Cents): Cents | null {
  const typed = parseDollars(text);
  if (typed === null) return null;
  return parentCents < 0 ? -Math.abs(typed) : Math.abs(typed);
}
