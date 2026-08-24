/**
 * One user, allowlisted Google auth (§12).
 *
 * No roles, no RLS, no bookkeeper flows, no self-serve onboarding. The PM does
 * the day-to-day now, so the "a non-technical teammate must be able to use it"
 * requirement that shaped the last build no longer applies. Add it back only
 * if someone else ever logs in.
 */

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = allowedEmails();
  // An empty allowlist locks everyone out rather than letting everyone in.
  if (allow.length === 0) return false;
  return allow.includes(email.toLowerCase());
}
