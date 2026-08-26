'use client';

import { useState } from 'react';

/**
 * Several panels in one place, one shown at a time.
 *
 * A property has ownership, management, loans, leases, valuations and bank
 * accounts behind it. Stacked, that is six screens of scrolling to reach the
 * one you came for, and no way to see at a glance which of them are even
 * populated. As tabs it is one screen, and the counts say where there is
 * something to look at before you click.
 *
 * Every section is rendered by the server and passed in; this owns only which
 * is visible, so nothing has to be fetched again on a switch.
 */
export interface TabSection {
  key: string;
  label: string;
  /** Shown beside the label. Zero is worth knowing, so it is not hidden. */
  count?: number;
  content: React.ReactNode;
}

export function SectionTabs({ sections, initial }: { sections: TabSection[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? sections[0]?.key);
  if (sections.length === 0) return null;

  return (
    <div className="rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            aria-pressed={section.key === active}
            onClick={() => setActive(section.key)}
            className={`rounded px-2.5 py-1 text-[12px] transition-colors ${
              section.key === active ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
            }`}
          >
            {section.label}
            {section.count !== undefined ? (
              <span className={`ml-1.5 text-[11px] ${section.count === 0 ? 'text-muted' : ''}`}>{section.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/*
        All sections stay in the DOM and are hidden rather than unmounted, so a
        switch costs nothing and the server never renders twice.
      */}
      {sections.map((section) => (
        <div key={section.key} hidden={section.key !== active} className="p-4">
          {section.content}
        </div>
      ))}
    </div>
  );
}
