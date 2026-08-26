'use client';

import { useState } from 'react';

/**
 * One concern on a page that has several: its table, and its own way to add to
 * it, in a single box.
 *
 * The property page shows ownership, management, loans, leases, accounts and
 * valuations. Stacking a results panel and a separate add panel for each would
 * be twelve bordered boxes with every form visually detached from the table it
 * belongs to. Here the add toggle sits in the section's own header, so it is
 * unambiguous which table it feeds.
 *
 * Both the form and the table are built on the server and passed in; this owns
 * only whether the form is showing.
 */
export function RecordSection({
  title,
  description,
  addLabel,
  form,
  defaultOpen = false,
  bare = false,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  addLabel: string;
  form: React.ReactNode;
  defaultOpen?: boolean;
  /** Drop the box when something else already supplies one — tabs, say. */
  bare?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={
        bare ? '' : 'mb-5 rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.05)]'
      }
    >
      <div
        className={`flex items-start justify-between gap-4 ${
          bare ? 'pb-3' : 'border-b border-line px-4 py-3'
        }`}
      >
        <div>
          <h2 className="text-[14px] font-medium">{title}</h2>
          {description ? <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-muted">{description}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-text"
        >
          {open ? 'Cancel' : addLabel}
        </button>
      </div>

      {open ? (
        <div className={bare ? 'mb-4 rounded-md bg-surface-2/40 p-4' : 'border-b border-line bg-surface-2/40 p-4'}>
          {form}
        </div>
      ) : null}

      <div className={bare ? '' : 'p-4'}>{children}</div>
    </section>
  );
}
