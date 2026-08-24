'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordDistributions } from '@/lib/payouts-actions';
import { formatCents } from '@/lib/engine/money';

interface Props {
  propertyId: string;
  propertyName: string;
  month: string;
  owners: { entityId: string; name: string; sharePercent: number; amountCents: number; alreadyPaidCents: number }[];
  netCashCents: number;
}

export function DistributionRecorder({ propertyId, propertyName, month, owners, netCashCents }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(owners.map((o) => [o.entityId, (o.amountCents / 100).toFixed(2)])),
  );
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const total = owners.reduce((sum, o) => sum + (Number(amounts[o.entityId]?.replace(/[$,]/g, '')) || 0), 0);
  const alreadyPaid = owners.reduce((sum, o) => sum + o.alreadyPaidCents, 0);

  function record() {
    setMessage(null);
    startTransition(async () => {
      const result = await recordDistributions({
        propertyId,
        month,
        rows: owners.map((owner) => ({
          entityId: owner.entityId,
          amountCents: Math.round((Number(amounts[owner.entityId]?.replace(/[$,]/g, '')) || 0) * 100),
        })),
      });
      if (result.ok) {
        setMessage({ tone: 'good', text: `Recorded ${result.recorded} distributions for ${month}.` });
        router.refresh();
      } else {
        setMessage({ tone: 'bad', text: result.error ?? 'Could not record' });
      }
    });
  }

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th className="border-b border-line px-2 py-1.5">Owner</th>
            <th className="border-b border-line px-2 py-1.5 text-right">Share</th>
            <th className="border-b border-line px-2 py-1.5 text-right">Owed for {month}</th>
            <th className="border-b border-line px-2 py-1.5 text-right">Pay</th>
            <th className="border-b border-line px-2 py-1.5 text-right">Already recorded</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((owner) => (
            <tr key={owner.entityId}>
              <td className="border-b border-line/60 px-2 py-1.5">{owner.name}</td>
              <td className="border-b border-line/60 px-2 py-1.5 num text-muted">{owner.sharePercent}%</td>
              <td className="border-b border-line/60 px-2 py-1.5 num">{formatCents(owner.amountCents)}</td>
              <td className="border-b border-line/60 px-2 py-1.5">
                <input
                  value={amounts[owner.entityId] ?? ''}
                  onChange={(e) => setAmounts((current) => ({ ...current, [owner.entityId]: e.target.value }))}
                  inputMode="decimal"
                  className="text-right"
                />
              </td>
              <td className="border-b border-line/60 px-2 py-1.5 num text-muted">
                {owner.alreadyPaidCents ? formatCents(owner.alreadyPaidCents) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={record}
          disabled={pending || owners.length === 0}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-40"
        >
          {pending ? 'Recording…' : alreadyPaid > 0 ? 'Replace recorded distributions' : 'Record distributions'}
        </button>
        <span className="text-[12px] text-muted">
          Paying {formatCents(Math.round(total * 100))} of {formatCents(Math.max(0, netCashCents))} net cash
          {total * 100 > netCashCents && netCashCents > 0 ? ' — more than the month generated' : ''}
        </span>
        {message ? (
          <span className={`text-[12px] ${message.tone === 'good' ? 'text-good' : 'text-bad'}`}>{message.text}</span>
        ) : null}
      </div>
      {alreadyPaid > 0 ? (
        <p className="mt-2 text-[11px] text-muted">
          {formatCents(alreadyPaid)} already recorded for {propertyName} in {month}. Recording again replaces those
          entries rather than paying twice.
        </p>
      ) : null}
    </div>
  );
}
