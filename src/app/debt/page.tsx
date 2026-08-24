import Link from 'next/link';
import { getMaturityLadder, todayIso } from '@/lib/queries';
import { Badge, Empty, Money, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { formatCents } from '@/lib/engine/money';

export const dynamic = 'force-dynamic';

function maturityTone(days: number) {
  if (days < 0) return 'bad' as const;
  if (days <= 90) return 'bad' as const;
  if (days <= 365) return 'warn' as const;
  return 'muted' as const;
}

export default async function DebtPage() {
  const asOf = todayIso();
  const data = await getMaturityLadder(asOf);

  // The caveat is per note, not per portfolio: a single guaranteed note can
  // dwarf your share of it even when the totals happen to look reassuring.
  const overGuaranteed = data.ladder.filter((e) => e.guaranteedExposureCents > e.proRataBalanceCents);
  const overGuaranteedBy = overGuaranteed.reduce(
    (total, e) => total + e.guaranteedExposureCents - e.proRataBalanceCents,
    0,
  );

  return (
    <>
      <PageHeader
        title="Debt"
        subtitle="Every note against every property, sorted by maturity. Private notes mature; that is the risk that actually bites, and nothing off the shelf will show it to you."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Monthly debt service" value={formatCents(data.monthlyDebtServiceCents)} />
        <Stat label="Balance (property level)" value={formatCents(data.totalBalanceCents)} />
        <Stat
          label="Your pro-rata share"
          value={data.hasViewer ? formatCents(data.totalProRataCents) : '—'}
          hint={data.hasViewer ? 'An economic figure.' : 'No entity is marked as you.'}
        />
        <Stat
          label="Guaranteed exposure"
          value={formatCents(data.totalGuaranteedCents)}
          hint="What a lender can come after, undivided."
          tone={overGuaranteed.length > 0 ? 'bad' : 'muted'}
        />
      </div>

      {overGuaranteed.length > 0 ? (
        <Note>
          On {overGuaranteed.length === 1 ? 'one note' : `${overGuaranteed.length} notes`} your guaranteed exposure
          exceeds your pro-rata share — by {formatCents(overGuaranteedBy)} in total. A pro-rata debt share is an
          economic figure, not a legal one: where you personally guarantee a note you are liable for the whole balance
          regardless of the interest you hold, and only one of those two numbers is what a lender will come after.
        </Note>
      ) : null}

      <Panel title="Maturity ladder">
        {data.ladder.length === 0 ? (
          <Empty>
            No active loans yet. Add them in <Link href="/settings/loans" className="underline">Settings → Loans</Link> —
            this screen needs no import, no statement and no external account.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th>Lender</Th>
                  <Th>Structure</Th>
                  <Th>Maturity</Th>
                  <Th right>Days</Th>
                  <Th right>Balance</Th>
                  <Th right>Balloon</Th>
                  <Th right>Pro-rata</Th>
                  <Th right>Guaranteed</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.ladder.map((entry) => (
                  <tr key={entry.loan.id} className="hover:bg-surface-2/50">
                    <Td>{entry.loan.propertyName}</Td>
                    <Td>
                      {entry.loan.lender}
                      <span className="ml-1.5 text-[11px] text-muted">{entry.loan.type}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-muted">{entry.loan.structure.replace(/_/g, ' ')}</span>
                    </Td>
                    <Td>
                      <span className="num">{entry.maturityDate}</span>
                    </Td>
                    <Td right>
                      <Badge tone={maturityTone(entry.daysRemaining)}>{entry.daysRemaining}</Badge>
                    </Td>
                    <Td right>
                      <Money cents={entry.balanceCents} />
                    </Td>
                    <Td right>
                      {entry.balloonCents > 0 ? <Money cents={entry.balloonCents} /> : <span className="num text-muted">—</span>}
                    </Td>
                    <Td right>
                      <Money cents={entry.proRataBalanceCents} muted />
                    </Td>
                    <Td right>
                      {entry.guaranteedExposureCents > 0 ? (
                        <span className="num text-bad">{formatCents(entry.guaranteedExposureCents)}</span>
                      ) : (
                        <span className="num text-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      <Link href={`/debt/${entry.loan.id}`} className="text-[12px] text-muted hover:text-accent">
                        Schedule
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'muted',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'muted' | 'bad';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1 text-left text-[18px] ${tone === 'bad' ? 'text-bad' : ''}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
