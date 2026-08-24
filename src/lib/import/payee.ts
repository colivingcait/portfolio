/**
 * Finding the stable part of a bank description.
 *
 * No two lines from the same vendor read alike. A Gas South bill carries a
 * different date, trace number and reference every month; an Amazon purchase
 * carries a different order id; a Dekalb County water debit arrives as an ACH
 * blob with the originator's name buried in the middle of it. The name is
 * always in there — the job is to find it and match on that alone.
 *
 * Everything here is pure and works on the description text, so it can be
 * tested against the real shapes without a bank anywhere near it.
 */

export interface PayeeSuggestion {
  /** What a rule should match on. */
  match: string;
  /** Where it came from, said plainly so a person can judge it. */
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Volatile fragments: dates, ids, trace numbers, card suffixes, states. */
const NOISE = [
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g,
  /\b(orig\s*id|trace\s*#?|eed|ind\s*id|desc\s*date|co\s*entry\s*descr|sec|ppd|ccd|web|tel|arc)\s*:?\s*\S*/gi,
  /\bcard\s*\d{4}\b/gi,
  /\b(?:x{2,}|\*{2,}|\.{3,})\d+\b/gi,
  /#\s*\d+/g,
  /\btrn\s*:?\s*\S+/gi,
  /\b\d{6,}\b/g,
  /\b[A-Z]{2}\b(?=\s|$)/g,
];

export function stripNoise(text: string): string {
  let out = ` ${text} `;
  for (const pattern of NOISE) out = out.replace(pattern, ' ');
  return out.replace(/[|,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The ACH originator name, where the line is an ACH debit or credit.
 *
 * "Orig CO Name:Dekalb CO GA Orig ID:9999 Desc Date:0731 …" is the shape most
 * utility and platform payments arrive in, and the name sits in a labelled
 * field rather than at the start of the line.
 */
export function achOriginator(description: string): string | null {
  const match = description.match(/orig\s*co\s*name\s*:?\s*([^:]+?)(?=\s*(?:orig\s*id|desc\s*date|co\s*entry|sec\s*:|trace|eed|ind\s*(?:id|name))|$)/i);
  if (!match) return null;
  const name = match[1].replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '');
  return name.length >= 3 ? name : null;
}

/**
 * The merchant on a card purchase.
 *
 * "Card Purchase 06/30 Amazon.Com*Is6Tv3Bn3 Amzn.Com/Bill WA Card 2804" — the
 * merchant leads, and the order reference is glued on after an asterisk.
 */
export function cardMerchant(description: string): string | null {
  const match = description.match(/(?:recurring\s+)?card\s+purchase(?:\s+return)?\s*(?:\d{1,2}\/\d{1,2})?\s*(.+)/i);
  if (!match) return null;

  // Everything up to the order reference is the name worth keeping.
  const merchant = stripNoise(match[1].split('*')[0]);

  const tokens = merchant.split(/\s+/).filter((token) => /[a-z]/i.test(token));

  // A domain usually just repeats the name beside it — "Ahs Ahs.Com Ahs.Com".
  // Drop them, unless the domain IS the name, as with "Amazon.Com".
  const withoutDomains = tokens.filter((token) => !/\.(com|net|org)\b/i.test(token));
  const chosen = withoutDomains.length > 0 ? withoutDomains : tokens;

  const seen = new Set<string>();
  const deduped = chosen.filter((token) => {
    const key = token.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const words = deduped.slice(0, 3).join(' ');
  return words.length >= 3 ? words : null;
}

/**
 * What a rule for this line should match on.
 *
 * Order matters: a labelled originator beats a card merchant, which beats the
 * opening words of whatever is left. A rule is only useful if the fragment it
 * matches survives into next month's statement.
 */
export function suggestPayee(description: string): PayeeSuggestion {
  const originator = achOriginator(description);
  if (originator) {
    return {
      match: originator,
      reason: 'the ACH originator name, which repeats on every payment from them',
      confidence: 'high',
    };
  }

  const merchant = cardMerchant(description);
  if (merchant) {
    return { match: merchant, reason: 'the merchant on the card purchase', confidence: 'high' };
  }

  const cleaned = stripNoise(description);
  const words = cleaned.split(/\s+/).filter((word) => word.length > 1);

  // Leading verbs describe the mechanism, not who was paid.
  const boilerplate = /^(ach|online|recurring|payment|purchase|debit|credit|withdrawal|deposit|transfer|to|from|pos|electronic|bill|pmt|check)$/i;
  const meaningful = words.filter((word) => !boilerplate.test(word));

  const candidate = (meaningful.length >= 2 ? meaningful : words).slice(0, 3).join(' ');
  return {
    match: candidate || cleaned.slice(0, 30),
    reason: 'the most distinctive words left after stripping dates and reference numbers',
    confidence: meaningful.length >= 2 ? 'medium' : 'low',
  };
}

/** How many of these descriptions a candidate rule would catch. */
export function countMatches(match: string, descriptions: readonly string[]): number {
  if (match.trim() === '') return 0;
  const needle = match.toLowerCase();
  return descriptions.filter((description) => description.toLowerCase().includes(needle)).length;
}
