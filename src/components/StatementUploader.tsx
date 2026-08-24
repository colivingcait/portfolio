'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postStatement, previewStatement, type StatementPreview } from '@/lib/import-actions';
import { formatCents } from '@/lib/engine/money';
import { parseMoney } from '@/lib/forms';

interface Props {
  accounts: { value: string; label: string }[];
}

export function StatementUploader({ accounts }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.value ?? '');
  const [upload, setUpload] = useState<{ csvText?: string; pdfBase64?: string } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [flipSign, setFlipSign] = useState(false);
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const balanceInputs = () => ({
    openingBalanceInput: opening.trim() === '' ? null : parseMoney(opening),
    closingBalanceInput: closing.trim() === '' ? null : parseMoney(closing),
  });

  async function onFile(file: File | null) {
    setPreview(null);
    setMessage(null);
    if (!file) {
      setUpload(null);
      setFileName(null);
      return;
    }

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      // Sent as base64 because a server action takes JSON, not a file body.
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buffer.length; i += 8192) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
      }
      setUpload({ pdfBase64: btoa(binary) });
    } else {
      setUpload({ csvText: await file.text() });
    }
    setFileName(file.name);
  }

  function runPreview(nextFlip = flipSign) {
    if (!upload || !accountId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await previewStatement({
        bankAccountId: accountId,
        ...upload,
        flipSign: nextFlip,
        ...balanceInputs(),
      });
      setPreview(result);
      if (result.ok) {
        if (result.impliedOpening && result.openingBalanceCents !== null) {
          setOpening((result.openingBalanceCents / 100).toFixed(2));
        }
        if (result.impliedClosing && result.closingBalanceCents !== null) {
          setClosing((result.closingBalanceCents / 100).toFixed(2));
        }
      }
    });
  }

  function post() {
    if (!upload || !accountId) return;
    startTransition(async () => {
      const result = await postStatement({
        bankAccountId: accountId,
        ...upload,
        flipSign,
        fileName: fileName ?? undefined,
        ...balanceInputs(),
      });
      if (result.ok) {
        setMessage({
          tone: 'good',
          text: `Posted ${result.posted} transactions.${result.unmatched ? ` ${result.unmatched} need a category — they are in Review.` : ' Everything matched a payee rule.'}`,
        });
        setPreview(null);
        setUpload(null);
        setFileName(null);
        setOpening('');
        setClosing('');
        router.refresh();
      } else {
        setMessage({ tone: 'bad', text: result.error ?? 'Could not post.' });
      }
    });
  }

  const tie = preview?.tie;
  const canPost = Boolean(preview?.ok && tie?.tied);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 sm:col-span-5">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Property account</label>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
            {accounts.map((account) => (
              <option key={account.value} value={account.value}>
                {account.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            The file is the property. Every row in it belongs to this account — the only question left is what kind.
          </p>
        </div>

        <div className="col-span-12 sm:col-span-4">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Statement file</label>
          <input
            type="file"
            accept=".csv,text/csv,.pdf,application/pdf"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-[11px] leading-snug text-muted">
            CSV or PDF. A CSV is the more reliable of the two — if the bank offers one, prefer it.
          </p>
          {fileName ? <p className="mt-1 text-[11px] text-muted">{fileName}</p> : null}
        </div>

        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Sign</label>
          <div className="pt-1.5">
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={flipSign}
                onChange={(e) => { setFlipSign(e.target.checked); runPreview(e.target.checked); }}
              />
              Amounts are reversed
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Opening balance</label>
          <input value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Closing balance</label>
          <input value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </div>
        <div className="col-span-12 sm:col-span-6 flex items-end gap-2">
          <button
            type="button"
            disabled={!upload || pending}
            onClick={() => runPreview()}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-40"
          >
            {pending ? 'Checking…' : 'Check'}
          </button>
          <button
            type="button"
            disabled={!canPost || pending}
            onClick={post}
            className="rounded-md border border-good/50 bg-good/10 px-3 py-1.5 text-[13px] text-good hover:border-good disabled:opacity-40"
          >
            Post
          </button>
        </div>
      </div>

      {message ? (
        <div className={`rounded-md border px-3 py-2 text-[12px] ${message.tone === 'good' ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad'}`}>
          {message.text}
        </div>
      ) : null}

      {preview && !preview.ok ? (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">{preview.error}</div>
      ) : null}

      {preview?.ok ? (
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-[12px]">
            <Fact label="Rows read" value={String(preview.transactionCount)} />
            <Fact label="Matched a rule" value={`${preview.matchedCount} of ${preview.transactionCount}`} />
            <Fact label="Need a category" value={String(preview.unmatchedCount)} tone={preview.unmatchedCount > 0 ? 'warn' : 'muted'} />
            <Fact label="Period" value={preview.periodStart && preview.periodEnd ? `${preview.periodStart} → ${preview.periodEnd}` : '—'} />
          </div>

          {tie ? (
            <div
              className={`rounded-md border px-3 py-2 text-[12px] ${tie.tied ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad'}`}
            >
              {tie.tied ? (
                <>
                  Balances tie: {formatCents(preview.openingBalanceCents ?? 0)} + {formatCents(tie.creditsCents)} credits −{' '}
                  {formatCents(tie.debitsCents)} debits = {formatCents(tie.computedClosingCents)}.
                </>
              ) : (
                <>
                  Does not tie by {formatCents(tie.differenceCents)}. Opening + credits − debits ={' '}
                  {formatCents(tie.computedClosingCents)}, but closing says {formatCents(tie.statedClosingCents)}. This
                  will not post: the file is incomplete, a balance is wrong, or a row was misread.
                </>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
              Enter the opening and closing balances from the statement. The balance check is what makes this import
              trustworthy, so nothing posts without it.
            </div>
          )}

          {preview.signSource ? (
            <p className="mt-3 text-[11px] leading-snug text-muted">
              {preview.signSource === 'running_balance'
                ? 'Read from a PDF. Each amount’s direction came from how the running balance moved, so a figure printed without a minus sign is still recognised as money going out.'
                : preview.signSource === 'column_position'
                  ? 'Read from a PDF with no running balance, so direction was taken from which column each figure sits in — withdrawals left, deposits right. Check a couple of rows below, and use “Amounts are reversed” if it has them backwards.'
                  : 'Read from a PDF. Amounts were taken exactly as printed, including their signs.'}
            </p>
          ) : null}

          {preview.skipped.length > 0 ? (
            <div className="mt-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-warn">
              {preview.skipped.length} row{preview.skipped.length === 1 ? '' : 's'} could not be read and will not be
              imported — usually a totals line or a footer. If a real transaction is among them the balances will not
              tie, which is the point.
              <ul className="mt-1 space-y-0.5 text-[11px] opacity-80">
                {preview.skipped.slice(0, 4).map((row) => (
                  <li key={row.line}>
                    line {row.line}: {row.reason} — {row.raw.slice(0, 70)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.unrecognizedColumns.length > 0 ? (
            <p className="mt-3 text-[11px] text-muted">
              Columns not used: {preview.unrecognizedColumns.join(', ')}.
            </p>
          ) : null}

          {preview.sample.length > 0 ? (
            <table className="mt-3">
              <thead>
                <tr>
                  <th className="border-b border-line px-2 py-1.5">Date</th>
                  <th className="border-b border-line px-2 py-1.5">Description</th>
                  <th className="border-b border-line px-2 py-1.5 text-right">Amount</th>
                  <th className="border-b border-line px-2 py-1.5">Category</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row, i) => (
                  <tr key={i}>
                    <td className="border-b border-line/60 px-2 py-1.5 num">{row.date}</td>
                    <td className="border-b border-line/60 px-2 py-1.5 text-[12px]">{row.description}</td>
                    <td className={`border-b border-line/60 px-2 py-1.5 num ${row.amountCents < 0 ? 'text-bad' : ''}`}>
                      {formatCents(row.amountCents)}
                    </td>
                    <td className="border-b border-line/60 px-2 py-1.5 text-[12px]">
                      {row.categoryKey ? (
                        <span className="text-muted">{row.categoryKey}</span>
                      ) : (
                        <span className="text-warn">needs review</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'muted' | 'warn' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 ${tone === 'warn' ? 'text-warn' : ''}`}>{value}</div>
    </div>
  );
}
