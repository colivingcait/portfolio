import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  // The app is deliberately unnamed. The header reads Portfolio (§0).
  title: 'Portfolio',
  description: 'Financial operating system',
  robots: { index: false, follow: false },
};

const NAV = [
  { href: '/', label: 'Portfolio' },
  { href: '/debt', label: 'Debt' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/equity', label: 'Equity' },
  { href: '/imports', label: 'Imports' },
  { href: '/review', label: 'Review' },
  { href: '/settings', label: 'Settings' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-[1400px] items-center gap-8 px-6 py-3">
            <Link href="/" className="text-[15px] font-semibold tracking-tight">
              Portfolio
            </Link>
            <nav className="flex gap-5 text-[13px]">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="text-muted transition-colors hover:text-text">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
