'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Overview' },
  { href: '/properties', label: 'Properties' },
];

export function PortfolioTabs() {
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
