# Portfolio

A single-user internal tool that replaces the monthly spreadsheet. Not a SaaS: one user,
no customers, no billing, no team roles, no onboarding. Built from `portfoliobuildspec.pdf`
(v5, 24 August 2026); section references below (§) point back at it.

## What is built

**Build order step 1 (§13.1) and the engine underneath it.** Entities, ownership interests,
properties, accounts, management periods, loans and leases — all manual entry, with the
effective-share traversal and the maturity ladder working. Useful the day it ships.

- **Portfolio** — one row per property, with management mode for the selected month,
  effective share, debt service and debt balance. View selector (Portfolio / My share /
  Entity), entity filter, month selector.
- **Debt** — the maturity ladder, per-loan detail, full amortization schedules, guaranteed
  exposure held separate from the pro-rata share.
- **Equity** — value against debt per property, LTV, your share, and what a sale would actually
  pay out: costs, then debt, then capital back to whoever put it in, then the rest split by
  ownership. Value estimates are dated and carry their source, because an appraisal and a
  Zestimate are not the same evidence.
- **Payouts** — what leaves the business each month: interest owed to lenders on the note's
  schedule (monthly, quarterly, semiannual or annual), each owner's share of net cash, and
  capital accounts showing what an investor is still owed back on sale. Lenders are owed
  whether or not the property earned; owners are owed a share of profit and nothing when there
  is none. A profit distribution never reduces the capital owed back — only a return of
  capital does.
- **Property detail** — ownership paths, management history with boundary warnings, loans,
  leases.
- **Settings** — every step-1 record type, plus payee rules, capital accounts and the
  category vocabulary. Every record is editable in place: deleting and re-adding a property
  is not equivalent, since it cascades to that property's loans, accounts, management periods
  and ownership interests.
- **Ownership entry** — a whole split at once, with a running total that flags a stack missing
  100% before it is saved rather than after.
- **Imports / Review** — the screens exist and say plainly what they are waiting on.

**Build order step 2 (§13.2) — bank statement import.** Drop CSVs or PDFs in, as many at once as
you like, and nothing has to be filled in: each file is read for the account it belongs to, the
period it covers and the balances to check against. A statement already states all three, and
re-typing them is where errors come from. Routing is by the account number in the statement
header, falling back to the property address or name in the body; a linked account mentioned
elsewhere in the document is deliberately weak evidence, since routing on it would file a
statement against the wrong property.

Once routed,
and every row belongs to it: one account per property means the file answers "which property"
by itself. payee rules classify what they recognise, the rest goes to Review, and confirming a
row there writes the rule for every future import. Nothing posts unless
`opening + credits − debits = closing`.

PDF statements are reconstructed from positioned text, which is heuristic — but nothing
downstream trusts the result, because the balance check does not: a misread PDF fails to tie
and is refused exactly like a truncated CSV. Where the statement prints a running balance,
each amount's direction comes from how that balance moved, so figures printed without minus
signs are still read correctly. Scanned PDFs have no text to extract and are not supported;
the CSV or QFX export from the same account is the way in.

## What is not built

Steps 3 through 7 of §13, in that order: the historical backfill, PadSplit import,
PM reconciliation in reduced form, the PM statement importer (blocked on a real sample),
and projections (not before October, and not because of the code — §13).

The reconciliation rules those steps need are already written and unit-tested in
`src/lib/engine`. What is missing around them is upload, parsing and persistence.

## Architecture

```
src/lib/engine/     pure functions — no Prisma, no Next, no I/O
src/lib/            mappers, queries, server actions: the layer that touches the database
src/app/            screens
prisma/schema.prisma  the §11 data model
```

The interface is light, dense and quiet. Every colour in the app is one of the tokens defined
in `src/app/globals.css` and no component hardcodes a hex, so the whole theme lives in that one
block — switching it, or adding a `prefers-color-scheme` variant, means redefining those values
and touching nothing else.

The engine is kept dependency-free deliberately (§12, "Keep"): every identity in the spec is
expressed once, there, and unit-tested without a database. `npm test` runs 97 tests covering
the effective-share traversal, amortization, the PadSplit rules that must not drift, the
management-period identities, the bank balance tie and the pro-rate/do-not-pro-rate split.

Money is integer cents everywhere. Dates are ISO strings (`YYYY-MM-DD`, `YYYY-MM`), never
`Date` objects, because every date here is a calendar date and a timestamp read back in
another zone silently becomes the previous day.

## Stack

Next.js App Router · TypeScript · Tailwind · Supabase (Postgres, Auth, Storage) · Prisma
**pinned to 6.19** — Prisma 7 breaks the pooled/direct URL pattern in favour of driver
adapters · Vercel · roomreport.co.

Dropped from the previous plan: Plaid (bank data arrives as uploaded statements), roles, RLS,
bookkeeper flows and self-serve onboarding.

## Running it

```bash
cp .env.example .env      # fill in the Supabase URLs and your allowlisted email
npm install
npx prisma migrate deploy # or `npx prisma db push` against a scratch database
npm run dev
```

`npm test` needs no database. `npm run build` runs `prisma generate` and
`prisma migrate deploy` first, so a deploy applies pending migrations itself.

### Deploying to Vercel

Set three environment variables on the project: `DATABASE_URL` (Supabase pooled, port 6543),
`DIRECT_URL` (direct, port 5432), and `ALLOWED_EMAIL`. The Supabase Vercel integration injects
its own `POSTGRES_*` names — the first two are read by `prisma/schema.prisma` and must be set
explicitly whatever else is present.

Take both URLs from Supabase's Connect panel (ORMs → Prisma) and use the **pooler** for each:
transaction pooler on 6543 for `DATABASE_URL`, session pooler on 5432 for `DIRECT_URL`. The
`db.<ref>.supabase.co` direct host is IPv6-only on new projects and a Vercel build container
generally cannot reach it, so `prisma migrate deploy` fails there regardless of the URL being
well-formed.

The pooler authenticates as `postgres.<project-ref>`, not plain `postgres`. Swapping a direct
connection string's host for the pooler's while keeping its username produces a well-formed
URL that fails with `P1000: Authentication failed` even when the password is correct — copy
the pooler string whole rather than editing the direct one.

`vercel.json` pins the framework to `nextjs`. Without it, a Vercel project created before the
repository had any code detects no framework, treats the build as a static site and fails with
`No Output Directory named "public" found` — after a build that otherwise succeeded.

Paste the connection strings **bare**: no surrounding quotes, no `DATABASE_URL=` prefix.
Vercel stores the value verbatim, so a copied-in quote makes the scheme `"postgresql` and the
build fails with `P1013: The provided database string is invalid`. `DIRECT_URL` is the one
`prisma migrate deploy` reads, so a bad value there fails the build even when the app itself
would have run.

**Auth is not wired to Supabase sessions yet.** Until it is, a deployed URL is readable by
anyone who has it. Keep Vercel's deployment protection on, or keep it local, until real
figures are in.

## Things the data cannot tell you yet

These are open items from §14 that block or distort what the app can show. They are the
reason nothing seeds itself:

- **The property table is unverified.** Addresses, room counts and statuses were carried from
  an earlier build document. Properties carry a `dataVerified` flag, default false, and every
  screen says so until it is set. The coliving rows sum to 45 rooms — confirm before any
  count is displayed.
- **The trailing-twelve PadSplit figures are unverified** ($214,883 gross / $31,731 fees /
  $4,271 credits / $187,423 payout / 91.8% collection) and the range includes August, which
  the in-flight rule says to drop. Re-run over Sep 2025 – Jul 2026 against a fresh export.
- **Ownership percentages are unknown** — what each partner holds in each Lustra property, and
  in Lustra House itself. Until they are entered, "My share" has nothing to multiply by.
- **Whether distributions follow equity** or split differently under the operating agreement.
  The schema carries an optional distribution percentage that overrides equity for cash.
- **Guarantor flags** — which notes are personally guaranteed. The ladder shows exposure only
  where the flag is set.
- **The PM statement format** and the **deposit-to-earnings-month lag**. Both need one real
  sample; neither is hard-coded anywhere yet.
- **The duplex details** — address, loan terms, rent per unit, whether utilities are included.
- **Meadowchase terminates 26 September.** September rent, the early termination fee and the
  security-deposit netting are real cash events that need a home in the categorization scheme
  even though the house is out of projections.
