'use client';

import { useState, useTransition } from 'react';
import { recordInterestAdvance } from '@/lib/loan-actions';

/**
 * One amount and one date, because that is what a lump-sum interest payment
 * is. The generic payment form asks for a principal/interest split and a
 * source, none of which has an answer here: principal is nil by definition,
 * and the split is the whole amount.
 */
export function InterestAdvanceForm({ loanId, today }: { loanId: string; today: string }) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await recordInterestAdvance(loanId, date, amount);
          if (result.ok) setAmount('');
          else setError(result.error ?? 'That did not save.');
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Date paid</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto rounded border border-line px-2 py-1 text-[13px]"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Amount</span>
        <input
          inputMode="decimal"
          placeholder="12,000.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="num w-[160px] rounded border border-line px-2 py-1 text-[13px]"
        />
      </label>

      <button
        type="submit"
        disabled={pending || amount.trim() === ''}
        className="rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? 'Recording…' : 'Record interest payment'}
      </button>

      {error ? <span className="text-[12px] text-bad">{error}</span> : null}
    </form>
  );
}
