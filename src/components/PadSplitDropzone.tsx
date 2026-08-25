'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postPadSplit, previewPadSplit, type PadSplitPreview } from '@/lib/padsplit-actions';
import { formatCents } from '@/lib/engine/money';

const KIND_LABEL: Record<string, string> = {
  summary: 'Monthly summary',
  billed: 'What was charged',
  collected: 'What was collected',
  earnings_table: 'Portfolio totals',
};

interface Item {
  id: string;
  fileName: string;
  text: string;
  state: 'reading' | 'ready' | 'posting' | 'posted' | 'failed';
  preview: PadSplitPreview | null;
  message: string | null;
}

/**
 * The four files of a PadSplit export, dropped together.
 *
 * They are read here rather than sent as files because they are plain CSV and
 * a month of them is a couple of hundred kilobytes of text — well inside what
 * a server action takes, and it means the preview can name the months and the
 * unrecognised columns before anything is stored.
 */
export function PadSplitDropzone() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const take = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = `${file.name}-${file.size}-${Math.round(performance.now())}`;
      setItems((current) => [...current, { id, fileName: file.name, text: '', state: 'reading', preview: null, message: null }]);
      try {
        const text = await file.text();
        const preview = await previewPadSplit(file.name, text);
        update(id, {
          text,
          preview,
          state: preview.ok ? 'ready' : 'failed',
          message: preview.ok ? null : (preview.error ?? 'Could not read that file.'),
        });
      } catch {
        update(id, { state: 'failed', message: 'That file could not be read.' });
      }
    }
  }, []);

  function post(item: Item) {
    update(item.id, { state: 'posting' });
    startTransition(async () => {
      const result = await postPadSplit(item.fileName, item.text);
      if (result.ok) {
        const ties = result.ties.length;
        update(item.id, {
          state: 'posted',
          message:
            `${result.rowsPosted} rows across ${result.months.length} month${result.months.length === 1 ? '' : 's'}.` +
            (ties > 0 ? ` ${ties} month total${ties === 1 ? '' : 's'} disagree — see below.` : ''),
        });
        router.refresh();
      } else {
        update(item.id, { state: 'failed', message: result.error ?? 'Could not import that file.' });
      }
    });
  }

  const ready = items.filter((item) => item.state === 'ready');

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? 'border-accent bg-accent/5' : 'border-line hover:border-accent/60'
        }`}
      >
        <div className="text-[13px]">Drop the PadSplit export here</div>
        <div className="mt-1 text-[12px] text-muted">
          All four files at once — summary, billed, collected and the earnings table. Each is recognised by its own
          columns, so the order and the file names do not matter.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void take(e.target.files)}
        />
      </div>

      {ready.length > 1 ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => ready.forEach(post)}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent"
          >
            Import all {ready.length}
          </button>
          <span className="text-[12px] text-muted">Each file replaces whatever it already covers for those months.</span>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-md border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12.5px]">
                  <span className="font-medium">{item.preview?.kind ? KIND_LABEL[item.preview.kind] : item.fileName}</span>
                  {item.preview?.kind ? <span className="ml-2 text-[11px] text-muted">{item.fileName}</span> : null}
                </div>
                {item.state === 'ready' ? (
                  <button
                    type="button"
                    onClick={() => post(item)}
                    className="rounded border border-line px-2 py-0.5 text-[11px] hover:border-accent"
                  >
                    Import
                  </button>
                ) : (
                  <span className={`text-[11px] ${item.state === 'failed' ? 'text-bad' : item.state === 'posted' ? 'text-good' : 'text-muted'}`}>
                    {item.state === 'reading' ? 'Reading…' : item.state === 'posting' ? 'Importing…' : item.state}
                  </span>
                )}
              </div>

              {item.preview?.ok ? (
                <div className="mt-1.5 text-[11px] leading-relaxed text-muted">
                  {item.preview.rowCount} rows · {item.preview.months.length} months (
                  {item.preview.months[0]} to {item.preview.months[item.preview.months.length - 1]})
                  {item.preview.replaces > 0 ? (
                    <span className="text-warn"> · replaces {item.preview.replaces} rows already stored for these months</span>
                  ) : null}
                  {item.preview.skipped.length > 0 ? (
                    <span className="text-warn"> · {item.preview.skipped.length} rows unreadable</span>
                  ) : null}
                  {item.preview.unknownProperties.length > 0 ? (
                    <div className="mt-0.5 text-bad">
                      No property has PSID {item.preview.unknownProperties.join(', ')}. Those rows will import but
                      belong to nothing — set the PSID on the property first.
                    </div>
                  ) : null}
                  {item.preview.unrecognizedHeaders.length > 0 ? (
                    <div className="mt-0.5">
                      Columns not used: {item.preview.unrecognizedHeaders.join(', ')}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {item.message ? (
                <div className={`mt-1 text-[11px] ${item.state === 'failed' ? 'text-bad' : 'text-good'}`}>{item.message}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function padSplitMoney(cents: number): string {
  return formatCents(cents);
}
