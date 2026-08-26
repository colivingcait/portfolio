'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/books', label: 'Transactions' },
  { href: '/books/pnl', label: 'Profit & loss' },
  { href: '/books/balance-sheet', label: 'Balance sheet' },
  { href: '/reports', label: 'Year end' },
];

/**
 * Review is not here any more. It was the same rows as Transactions with a
 * different filter, and a tab for it meant a bank line appeared to move house
 * the moment it was categorized.
 */
export function BooksTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-line pb-3">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`rounded-md px-2.5 py-1 text-[13px] ${
            pathname === tab.href ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
