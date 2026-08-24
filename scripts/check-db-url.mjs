/**
 * Preflight for the two database URLs.
 *
 * Prisma's P1013 ("the scheme is not recognized") says nothing about WHICH
 * variable is wrong or HOW, which turns a deploy into a guessing game. This
 * runs first and names the problem.
 *
 * It never prints a password: values are reported by scheme, host, port and
 * database only.
 */

const REQUIRED = ['DATABASE_URL', 'DIRECT_URL'];
const problems = [];

function describe(name, raw) {
  if (raw === undefined) {
    problems.push(`${name} is not set. Add it in Vercel → Settings → Environment Variables, ticked for the environment being built.`);
    return;
  }
  if (raw === '') {
    problems.push(`${name} is set but empty.`);
    return;
  }

  // Report what the value looks like before parsing, since the usual failures
  // are all visible in the first few characters.
  const firstChar = raw[0];
  const lastChar = raw[raw.length - 1];

  if (raw !== raw.trim()) {
    problems.push(`${name} has leading or trailing whitespace (or a trailing newline). Re-paste it with no surrounding space.`);
  }
  if (firstChar === '"' || firstChar === "'" || lastChar === '"' || lastChar === "'") {
    problems.push(`${name} is wrapped in quotes (starts with ${JSON.stringify(firstChar)}). Quotes are dotenv syntax for .env files only — Vercel stores the value verbatim, so they become part of the scheme. Paste the bare URL.`);
  }
  if (/^[A-Z_]+\s*=/.test(raw)) {
    problems.push(`${name} still has a "NAME=" prefix in its value. The box takes the value only.`);
  }
  if (raw.includes('[YOUR-PASSWORD]') || raw.includes('YOUR-PASSWORD')) {
    problems.push(`${name} still contains the [YOUR-PASSWORD] placeholder. Replace it — brackets included — with the real database password.`);
  }
  if (raw.startsWith('psql')) {
    problems.push(`${name} looks like a psql command rather than a URL. Copy just the connection string inside the quotes.`);
  }
  if (raw.endsWith('…') || raw.endsWith('...')) {
    problems.push(`${name} ends in an ellipsis — it was copied truncated from the UI. Use the copy button rather than selecting the visible text.`);
  }

  let url;
  try {
    url = new URL(raw.trim().replace(/^['"]|['"]$/g, ''));
  } catch {
    problems.push(`${name} could not be parsed as a URL at all. It should start with postgresql:// and contain host, port and database.`);
    return;
  }

  const scheme = url.protocol.replace(':', '');
  if (scheme !== 'postgresql' && scheme !== 'postgres') {
    problems.push(`${name} has scheme "${scheme}", which Prisma does not recognise. It must be postgresql://`);
  }

  const port = url.port || '(none)';
  console.log(`  ${name}: ${scheme}://${url.username ? '<user>' : '(no user)'}:${url.password ? '<password>' : '(NO PASSWORD)'}@${url.hostname}:${port}${url.pathname}`);

  if (!url.password) {
    problems.push(`${name} carries no password.`);
  }

  // Supavisor authenticates as postgres.<project-ref>, not plain postgres.
  // Swapping a direct connection string's host for the pooler's while keeping
  // its username gets you a well-formed URL that fails with P1000.
  if (url.hostname.includes('pooler.supabase.com') && url.username === 'postgres') {
    problems.push(`${name} authenticates as "postgres", but the pooler at ${url.hostname} expects "postgres.<project-ref>" — e.g. postgres.abcdefghijklmnop, the ref in your Supabase project URL. This is what P1000 looks like when the password is actually fine.`);
  }

  // The direct host is IPv6-only on new Supabase projects and a Vercel build
  // container generally cannot reach it, so migrate deploy hangs or refuses.
  if (name === 'DIRECT_URL' && /^db\..*\.supabase\.co$/.test(url.hostname)) {
    problems.push(`DIRECT_URL points at ${url.hostname}, the IPv6-only direct host. Use the session pooler string (port 5432, host contains pooler.supabase.com) instead.`);
  }
  if (name === 'DATABASE_URL' && port === '5432' && url.hostname.includes('pooler')) {
    console.log('    note: DATABASE_URL is on the session pooler (5432). That works, though 6543 is the pooled runtime port.');
  }
}

console.log('Checking database URLs (passwords are never printed):');
for (const name of REQUIRED) describe(name, process.env[name]);

if (problems.length > 0) {
  console.error('\nDatabase URL check failed:\n');
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('Both URLs look well-formed.\n');
