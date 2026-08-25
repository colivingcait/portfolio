'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Everything about who is owed what. Payouts is the monthly question, equity
 * the eventual one, and the two records underneath — who owns what, and who
 * actually funded it — are what both are computed from.
 */
const TABS = [
  { href: '/payouts', label: 'Payouts' },
  { href: '/equity', label: 'Equity' },
  { href: '/owners/capital', label: 'Capital accounts' },
  { href: '/owners/ownership', label: 'Ownership' },
  { href: '/owners/entities', label: 'Owners & entities' },
];

export function OwnersTabs() {
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
