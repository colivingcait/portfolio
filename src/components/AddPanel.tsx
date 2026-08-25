'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * An entry form that sits on the screen showing its results, out of the way
 * until wanted.
 *
 * The reason it exists: a loan is not a setting. Neither is a property, an
 * ownership stake or a valuation — those are the portfolio itself, and putting
 * them in a settings drawer means noticing a wrong figure in one place and
 * having to guess where it is corrected. But an entry form permanently open
 * above a maturity ladder is noise on every visit when you came to read.
 * Collapsed by default resolves both: the results are what you see, and adding
 * is one click away on the same screen.
 *
 * The children are rendered by the server and passed in, so the form itself
 * stays a server-composed tree and this only owns whether it is shown.
 */
export function AddPanel({
  label,
  description,
  children,
  defaultOpen = false,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  const opened = useRef(defaultOpen);

  // Focus the first field on opening, so the form is usable from the keyboard
  // and does not need a second click to start typing.
  useEffect(() => {
    if (!open || opened.current) {
      opened.current = open;
      return;
    }
    opened.current = true;
    const first = bodyRef.current?.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
  }, [open]);

  return (
    <section className="mb-5 rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-surface-2/40"
      >
        <div>
          <h2 className="text-[14px] font-medium">
            <span className="mr-1.5 inline-block w-3 text-muted">{open ? '−' : '+'}</span>
            {label}
          </h2>
          {description && open ? (
            <p className="mt-0.5 max-w-3xl pl-[18px] text-[12px] leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
      </button>
      {open ? (
        <div ref={bodyRef} className="border-t border-line p-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
