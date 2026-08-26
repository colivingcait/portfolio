import Link from 'next/link';

/**
 * The controls that decide what a page is showing, on one line above it.
 *
 * Every page had grown its own: a panel titled "Period" with a select and a
 * Show button, a panel titled "Basis" with another, a row of year links in the
 * header. Three shapes for the same act, each one a card the height of a chart
 * sitting between the explainer and the figures — so the answer started below
 * the fold and the question looked like data entry.
 *
 * A choice is one click and the URL carries it, which keeps a view linkable and
 * lets the server render it. Groups are separate because they are separate
 * questions: which year is not which property.
 */
export interface FilterOption {
  label: string;
  href: string;
  active: boolean;
  /** Shown beside the label. Zero is worth knowing, so it is not hidden. */
  count?: number;
  hint?: string;
}

export interface FilterGroup {
  /** Omitted where the options say plainly enough what they are. */
  label?: string;
  options: FilterOption[];
  /** The question the page is mostly about, given the darker pill. */
  primary?: boolean;
}

export function FilterBar({ groups }: { groups: FilterGroup[] }) {
  const shown = groups.filter((group) => group.options.length > 0);
  if (shown.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
      {shown.map((group, index) => (
        <span key={group.label ?? index} className="flex flex-wrap items-center gap-1">
          {group.label ? <span className="mr-1 text-[11px] text-muted">{group.label}</span> : null}
          {group.options.map((option) => (
            <Link
              key={option.href}
              href={option.href}
              title={option.hint}
              aria-current={option.active ? 'true' : undefined}
              className={
                group.primary
                  ? `rounded px-2 py-1 text-[12px] transition-colors ${
                      option.active ? 'bg-text text-surface' : 'text-muted hover:bg-surface-2 hover:text-text'
                    }`
                  : `rounded px-2 py-0.5 text-[12px] transition-colors ${
                      option.active ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                    }`
              }
            >
              {option.label}
              {option.count !== undefined ? (
                <span className={`ml-1.5 text-[11px] ${option.count === 0 ? 'text-muted' : 'text-warn'}`}>
                  {option.count}
                </span>
              ) : null}
            </Link>
          ))}
        </span>
      ))}
    </div>
  );
}
