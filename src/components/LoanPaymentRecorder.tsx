'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordLoanPayment } from '@/lib/payouts-actions';

interface Props {
  loanId: string;
  dueDate: string;
  interestCents: number;
  principalCents: number;
  escrowCents: number;
  totalCents: number;
}

export function LoanPaymentRecorder({ loanId, dueDate, interestCents, principalCents, escrowCents, totalCents }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function record() {
    setError(null);
    startTransition(async () => {
      // Records what the schedule says was owed. Where the amount differed,
      // the loan's own payment form takes the real split.
      const result = await recordLoanPayment({
        loanId,
        date: dueDate,
        totalCents,
        principalCents,
        interestCents,
        escrowCents,
      });
      if (result.ok) router.refresh();
      else setError(result.error ?? 'Could not record');
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={record}
        disabled={pending}
        className="rounded border border-line px-2 py-1 text-[12px] hover:border-accent disabled:opacity-40"
      >
        {pending ? '…' : 'Mark paid'}
      </button>
      {error ? <span className="text-[11px] text-bad">{error}</span> : null}
    </div>
  );
}
