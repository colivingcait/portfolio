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
  // Mixed letter-and-digit reference codes — a Zelle "JPM99AB3XYZ", a PadSplit
  // booking id. Long and digit-heavy enough not to catch a name like 7Eleven.
  /\b(?=[A-Za-z0-9]*[A-Za-z])(?=(?:[A-Za-z]*\d){3})[A-Za-z0-9]{8,}\b/g,
  /\b[A-Z]{2}\b(?=\s|$)/g,
];

/** Whitespace collapsed, so a fragment taken from cleaned text still matches raw text. */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Noise replaced by a break marker rather than by a space.
 *
 * The distinction matters. Words either side of a removed date were never
 * adjacent, and a rule built from them would be a substring of nothing.
 * Keeping the break lets the caller only ever join words that really do sit
 * next to each other in the original line.
 */
const BREAK = '\u0001';

function maskNoise(text: string): string {
  let out = ` ${text} `;
  for (const pattern of NOISE) out = out.replace(pattern, ` ${BREAK} `);
  return out.replace(/[|,;:]+/g, ` ${BREAK} `);
}

export function stripNoise(text: string): string {
  return normalizeForMatch(maskNoise(text).split(BREAK).join(' '));
}

/**
 * The candidate reduced to something that literally appears in the line.
 *
 * A rule matches by substring, so a suggestion that is not IN the description
 * can never fire — not even on the row it was written from. That is not a
 * hypothetical: "Zelle Payment To Jessica Wood" reduces to the words Zelle,
 * Jessica and Wood, and "Zelle Jessica Wood" appears nowhere on the statement.
 * Every suggestion goes through here before it is offered.
 */
export function asLiteralFragment(candidate: string, description: string): string | null {
  const haystack = normalizeForMatch(description).toLowerCase();
  const words = normalizeForMatch(candidate).split(' ').filter(Boolean);

  for (let size = words.length; size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const fragment = words.slice(start, start + size).join(' ');
      if (haystack.includes(fragment.toLowerCase())) return fragment;
    }
  }
  return null;
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
 * Words that describe the mechanism rather than who was paid. "Zelle Payment
 * To Jessica Wood" is a payment to Jessica Wood, not to Zelle — and a rule on
 * the word Zelle would swallow every Zelle payment on the account.
 */
const BOILERPLATE =
  /^(ach|online|recurring|payment|payments|purchase|debit|credit|withdrawal|deposit|transfer|to|from|pos|electronic|bill|pmt|check|zelle|quickpay|autopay|epay|wire|atm|the|of|and)$/i;

/**
 * The longest unbroken run of words that are neither noise nor mechanism.
 *
 * Unbroken is the whole point: the run is taken between noise breaks, so
 * every word in it really was adjacent to the next one on the statement, and
 * the result can be matched as a substring.
 */
function bestRun(description: string): string[] {
  const runs: string[][] = [];

  for (const segment of maskNoise(description).split(BREAK)) {
    let run: string[] = [];
    for (const word of segment.split(/\s+/).filter(Boolean)) {
      if (word.length > 1 && !BOILERPLATE.test(word)) {
        run.push(word);
      } else {
        if (run.length > 0) runs.push(run);
        run = [];
      }
    }
    if (run.length > 0) runs.push(run);
  }

  if (runs.length === 0) return [];

  // More words beats fewer; between runs of equal length the longer text is
  // the more distinctive one, and an earlier position breaks any remaining tie.
  return runs
    .map((run) => run.slice(0, 3))
    .sort((a, b) => b.length - a.length || b.join(' ').length - a.join(' ').length)[0];
}

/**
 * What a rule for this line should match on.
 *
 * Order matters: a labelled originator beats a card merchant, which beats the
 * most distinctive run of whatever is left. A rule is only useful if the
 * fragment it matches survives into next month's statement AND appears in this
 * month's — so every candidate is checked against the line it came from.
 */
export function suggestPayee(description: string): PayeeSuggestion {
  const originator = achOriginator(description);
  const literalOriginator = originator ? asLiteralFragment(originator, description) : null;
  if (literalOriginator && literalOriginator.length >= 3) {
    return {
      match: literalOriginator,
      reason: 'the ACH originator name, which repeats on every payment from them',
      confidence: 'high',
    };
  }

  const merchant = cardMerchant(description);
  const literalMerchant = merchant ? asLiteralFragment(merchant, description) : null;
  if (literalMerchant && literalMerchant.length >= 3) {
    return { match: literalMerchant, reason: 'the merchant on the card purchase', confidence: 'high' };
  }

  const run = bestRun(description);
  const candidate = run.length > 0 ? asLiteralFragment(run.join(' '), description) : null;
  if (candidate && candidate.length >= 3) {
    return {
      match: candidate,
      reason:
        run.length >= 2
          ? 'the most distinctive words left after stripping dates and reference numbers'
          : 'the only distinctive word on the line',
      confidence: run.length >= 2 ? 'medium' : 'low',
    };
  }

  // Nothing distinctive survived. The head of the line is at least literal,
  // and the person confirming can type something better over it.
  return {
    match: normalizeForMatch(description).slice(0, 30).trim(),
    reason: 'nothing distinctive stood out, so this is the start of the line — worth editing',
    confidence: 'low',
  };
}

export interface RuleRepair {
  match: string;
  /** How many of the descriptions the repaired match catches. */
  catches: number;
}

/**
 * A rule that catches nothing, mended from the descriptions it should have
 * caught.
 *
 * Rules written before suggestions were checked for literalness can hold a
 * match that appears in no description at all — the words are right, but they
 * were never adjacent. The mend is the same reduction applied to a live line:
 * take the longest run of the rule's own words that really does appear, and
 * keep whichever fragment catches the most lines.
 *
 * Returns null for a rule that already catches something, and for one whose
 * words are nowhere on the account — that one is not broken so much as
 * unrelated, and guessing at it would be worse than leaving it alone.
 */
export function repairMatch(match: string, descriptions: readonly string[]): RuleRepair | null {
  if (match.trim() === '' || countMatches(match, descriptions) > 0) return null;

  const seen = new Set<string>();
  for (const description of descriptions) {
    const fragment = asLiteralFragment(match, description);
    if (fragment && fragment.length >= 3) seen.add(fragment);
  }
  if (seen.size === 0) return null;

  const best = [...seen]
    .map((fragment) => ({ match: fragment, catches: countMatches(fragment, descriptions) }))
    .filter((candidate) => candidate.catches > 0)
    // The LONGEST fragment that catches anything, not the one that catches
    // most. Mending a rule must not quietly widen it: "Wood" would catch
    // Jessica Wood and Wood Supply Co alike, and the second is somebody else.
    .sort((a, b) => b.match.length - a.match.length || b.catches - a.catches)[0];

  return best ?? null;
}

/** How many of these descriptions a candidate rule would catch. */
export function countMatches(match: string, descriptions: readonly string[]): number {
  if (match.trim() === '') return 0;
  const needle = match.toLowerCase();
  return descriptions.filter((description) => description.toLowerCase().includes(needle)).length;
}
