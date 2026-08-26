import Link from 'next/link';
import { getRegister, type TransactionFilters } from '@/lib/books-queries';
import { BooksTabs } from '@/components/BooksTabs';
import { RegisterTable } from '@/components/RegisterTable';
import { Empty, Explainer, Money, PageHeader, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first !== '' ? first : undefined;
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters: TransactionFilters = {
    propertyId: one(params.property),
    accountId: one(params.account),
    categoryKey: one(params.category),
    state: (one(params.state) as TransactionFilters['state']) ?? 'all',
    from: one(params.from),
    to: one(params.to),
    search: one(params.q),
    page: Number(one(params.page) ?? 1),
  };

  const data = await getRegister(filters);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const linkTo = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      property: filters.propertyId,
      account: filters.accountId,
      category: filters.categoryKey,
      state: filters.state === 'all' ? undefined : filters.state,
      from: filters.from,
      to: filters.to,
      q: filters.search,
      page: String(filters.page ?? 1),
      ...overrides,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value && value !== '' && !(key === 'page' && value === '1')) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/books?${query}` : '/books';
  };

  return (
    <>
      <PageHeader
        title="Books"
        subtitle={
          data.uncategorized > 0
            ? `Every line the bank has, and what it was called. ${data.uncategorized} still to file.`
            : 'Every line the bank has, and what it was called. Everything is filed.'
        }
      />
      <BooksTabs />

      <Explainer title="What this is">
        The register — one row per bank line, across every property and account, whatever state it is in. A row with no
        category yet carries the tools for filing it: the fragment of the payee a rule should match on, how many other
        rows that would catch, and whether to remember it. A row already filed carries the tools for revising it —
        change the category, split it across two, leave a note.
        <div className="mt-1.5">
          Change anything here and the month&apos;s rollups rebuild immediately, so the P&amp;L, the Schedule E and the
          returns all move with it. Nothing is left showing the old answer. An <strong>uncategorized</strong> row is
          money that moved and has not been accounted for, so a profit and loss with rows still unfiled is incomplete —
          and it will look finished either way, which is exactly the danger.
        </div>
      </Explainer>

      <Panel title="Filter">
        <form method="get" className="grid grid-cols-12 gap-3">
          <div className="col-span-12 sm:col-span-3">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="q">Search</label>
            <input id="q" name="q" type="text" defaultValue={filters.search ?? ''} placeholder="description or note" />
          </div>
          <div className="col-span-12 sm:col-span-3">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="property">Property</label>
            <select id="property" name="property" defaultValue={filters.propertyId ?? ''}>
              <option value="">All properties</option>
              {data.properties.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-3">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue={filters.categoryKey ?? ''}>
              <option value="">Any category</option>
              {data.categories.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-3">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="state">Show</label>
            <select id="state" name="state" defaultValue={filters.state ?? 'all'}>
              <option value="all">Everything</option>
              <option value="uncategorized">Uncategorized only</option>
              <option value="categorized">Categorized only</option>
              <option value="split">Split only</option>
            </select>
          </div>
          <div className="col-span-12 sm:col-span-3">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
          </div>
          <div className="col-span-12 sm:col-span-3">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted" htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
          </div>
          <div className="col-span-12 flex items-center gap-3 pt-1">
            <button type="submit" className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-accent">
              Apply
            </button>
            <Link href="/books" className="text-[12px] text-muted hover:text-text">Clear</Link>
          </div>
        </form>
      </Panel>

      <Panel
        title={`${data.total} transactions`}
        description={`Money in ${(data.inCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · money out ${(data.outCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} across everything the filter matched, not just this page.`}
      >
        {data.rows.length === 0 ? (
          <Empty>
            Nothing matches. Either the filter is too narrow, or no statements have been imported yet —{' '}
            <Link href="/imports" className="underline">drag one in</Link>.
          </Empty>
        ) : (
          <>
            <RegisterTable rows={data.rows} categories={data.categories} />
            {pages > 1 ? (
              <div className="mt-3 flex items-center gap-3 text-[12px]">
                {filters.page && filters.page > 1 ? (
                  <Link href={linkTo({ page: String((filters.page ?? 1) - 1) })} className="text-muted hover:text-accent">← Newer</Link>
                ) : null}
                <span className="text-muted">Page {filters.page ?? 1} of {pages}</span>
                {(filters.page ?? 1) < pages ? (
                  <Link href={linkTo({ page: String((filters.page ?? 1) + 1) })} className="text-muted hover:text-accent">Older →</Link>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <Explainer title="Splitting a charge">
        One receipt can pay for two different things — supplies and a capital improvement on the same Home Depot run —
        and those go to different places on a tax return. Splitting keeps the original line exactly as the bank has it,
        so the statement still ties, and hangs the pieces off it. From then on the pieces are what the books count and
        the original is just a container. The pieces have to add up to the charge; anything else would quietly change
        what the month spent.
      </Explainer>

      <div className="mb-6 text-[12px] text-muted">
        Totals here are <Money cents={data.inCents} muted /> in and <Money cents={data.outCents} muted /> out of the
        bank — not profit. Deposits held, transfers between your own accounts and owner draws are all real money moving
        and none of them are income or cost. The{' '}
        <Link href="/books/pnl" className="underline">profit &amp; loss</Link> is where that separation is made.
      </div>
    </>
  );
}
