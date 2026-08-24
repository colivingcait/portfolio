'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postStatement, previewStatement, type StatementPreview } from '@/lib/import-actions';
import { formatCents } from '@/lib/engine/money';

interface Props {
  accounts: { value: string; label: string }[];
}

interface Item {
  id: string;
  fileName: string;
  payload: { csvText?: string; pdfBase64?: string };
  state: 'reading' | 'checking' | 'ready' | 'posting' | 'posted' | 'failed';
  preview: StatementPreview | null;
  /** Set only where routing could not decide and a person has to. */
  overrideAccountId: string | null;
  message: string | null;
}

async function toPayload(file: File): Promise<{ csvText?: string; pdfBase64?: string }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return { csvText: await file.text() };

  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 8192) binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  return { pdfBase64: btoa(binary) };
}

export function StatementDropzone({ accounts }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = useCallback((id: string, patch: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const check = useCallback(
    async (item: Item, overrideAccountId: string | null) => {
      update(item.id, { state: 'checking', message: null });
      const preview = await previewStatement({
        ...item.payload,
        fileName: item.fileName,
        bankAccountId: overrideAccountId,
      });
      update(item.id, {
        preview,
        state: preview.ok ? 'ready' : 'failed',
        message: preview.ok ? null : (preview.error ?? 'Could not read that file'),
      });
    },
    [update],
  );

  const accept = useCallback(
    async (files: FileList | File[]) => {
      const incoming: Item[] = [];
      for (const file of Array.from(files)) {
        incoming.push({
          id: `${file.name}-${file.size}-${incoming.length}-${items.length}`,
          fileName: file.name,
          payload: {},
          state: 'reading',
          preview: null,
          overrideAccountId: null,
          message: null,
        });
      }
      setItems((current) => [...current, ...incoming]);

      // Read and check each file as it arrives, rather than making the whole
      // batch wait on the slowest one.
      await Promise.all(
        Array.from(files).map(async (file, index) => {
          const item = incoming[index];
          const payload = await toPayload(file);
          item.payload = payload;
          update(item.id, { payload });
          await check({ ...item, payload }, null);
        }),
      );
    },
    [check, items.length, update],
  );

  function postAll() {
    const ready = items.filter((item) => item.state === 'ready' && item.preview?.match?.accountId);
    startTransition(async () => {
      for (const item of ready) {
        update(item.id, { state: 'posting' });
        const result = await postStatement({
          ...item.payload,
          fileName: item.fileName,
          bankAccountId: item.preview?.match?.accountId ?? item.overrideAccountId,
        });
        update(item.id, {
          state: result.ok ? 'posted' : 'failed',
          message: result.ok
            ? `${result.posted} rows into ${result.accountLabel}${result.unmatched ? ` · ${result.unmatched} need a category` : ''}${result.checked ? '' : ' · not balance-checked'}`
            : (result.error ?? 'Could not post'),
        });
      }
      router.refresh();
    });
  }

  const readyCount = items.filter((i) => i.state === 'ready').length;
  const busy = items.some((i) => i.state === 'reading' || i.state === 'checking' || i.state === 'posting');

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void accept(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-accent bg-accent/5' : 'border-line bg-surface-2/40 hover:border-accent/50'
        }`}
      >
        <p className="text-[14px]">Drop statements here</p>
        <p className="mt-1 text-[12px] text-muted">
          PDF or CSV, as many at once as you like. Each one is read for the account it belongs to, the period it covers
          and the balances to check against — nothing to fill in.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,text/csv,.pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void accept(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {items.length > 0 ? (
        <>
          <div className="mt-4 grid gap-2">
            {items.map((item) => (
              <FileCard
                key={item.id}
                item={item}
                accounts={accounts}
                onOverride={(accountId) => {
                  update(item.id, { overrideAccountId: accountId });
                  void check(item, accountId);
                }}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={postAll}
              disabled={busy || readyCount === 0}
              className="rounded-md border border-good/50 bg-good/10 px-3 py-1.5 text-[13px] text-good hover:border-good disabled:opacity-40"
            >
              {readyCount > 0 ? `Post ${readyCount} statement${readyCount === 1 ? '' : 's'}` : 'Post'}
            </button>
            <button
              type="button"
              onClick={() => setItems([])}
              disabled={busy}
              className="text-[12px] text-muted hover:text-text disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FileCard({
  item,
  accounts,
  onOverride,
}: {
  item: Item;
  accounts: { value: string; label: string }[];
  onOverride: (accountId: string) => void;
}) {
  const preview = item.preview;
  const tie = preview?.tie;
  const needsAccount = preview?.ok === false || (preview?.match && !preview.match.accountId);

  const tone =
    item.state === 'posted'
      ? 'border-good/40 bg-good/5'
      : item.state === 'failed'
        ? 'border-bad/40 bg-bad/5'
        : 'border-line bg-surface';

  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px]">{item.fileName}</span>
        <span className="text-[12px] text-muted">
          {item.state === 'reading' || item.state === 'checking'
            ? 'Reading…'
            : item.state === 'posting'
              ? 'Posting…'
              : item.state === 'posted'
                ? 'Posted'
                : preview?.ok
                  ? `${preview.transactionCount} rows · ${preview.periodStart} → ${preview.periodEnd}`
                  : null}
        </span>
      </div>

      {preview?.ok ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <span>
            <span className="text-muted">To </span>
            {preview.accountLabel}
            {preview.match?.confidence === 'likely' ? <span className="text-warn"> (best guess)</span> : null}
          </span>
          <span className="text-muted">{preview.matchedCount} of {preview.transactionCount} matched a rule</span>
          {tie ? (
            <span className={tie.tied ? 'text-good' : 'text-bad'}>
              {tie.tied
                ? 'Balances tie'
                : `Off by ${formatCents(tie.differenceCents)} — will not post`}
            </span>
          ) : (
            <span className="text-warn">No balances in the file — will post unchecked</span>
          )}
        </div>
      ) : null}

      {preview?.match?.reason && preview.ok ? (
        <p className="mt-1 text-[11px] text-muted">{preview.match.reason}</p>
      ) : null}

      {item.message ? (
        <p className={`mt-1.5 text-[12px] ${item.state === 'posted' ? 'text-good' : 'text-bad'}`}>{item.message}</p>
      ) : null}

      {needsAccount && item.state !== 'posted' ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted">Route to</span>
          <select
            value={item.overrideAccountId ?? ''}
            onChange={(e) => onOverride(e.target.value)}
            className="max-w-xs text-[12px]"
          >
            <option value="">Pick an account…</option>
            {accounts.map((account) => (
              <option key={account.value} value={account.value}>
                {account.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
