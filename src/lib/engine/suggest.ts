/**
 * What a bank line is probably for, before anyone has said.
 *
 * The register used to open every unfiled row's picker on the same two
 * guesses: rental income for a credit, maintenance for a debit. For a line
 * reading WELLS FARGO HOME MTG that is not a guess, it is a placeholder, and
 * it costs a scroll through forty categories to fix.
 *
 * Three things know better, in this order of authority:
 *
 *   1. A reversal — the row it cancels was already filed, and the pair only
 *      nets out if both sides share a category.
 *   2. What you have filed before. A payee you have categorized nine times is
 *      settled; the tenth is not a judgement call.
 *   3. What the payee obviously is. GEORGIA POWER is electric on the first
 *      import, before there is any history to learn from.
 *
 * Suggested, never applied. A guess that files itself is how a year of Zelle
 * transfers ends up as rental income; the row still waits for a person, this
 * only decides what the picker opens on and says why.
 */

import { normalizePayee } from './bank';
import { category, type CategoryCatalog } from './categories';
import type { Cents } from './money';

export type SuggestionSource = 'reversal' | 'history' | 'payee' | 'direction';

export interface Suggestion {
  categoryKey: string;
  source: SuggestionSource;
  /** Said on the row, so a wrong guess is arguable rather than mysterious. */
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

/** A payee stem and what it was filed as, from rows already categorized. */
export interface HistoryEntry {
  description: string;
  categoryKey: string;
  /** How many rows this pair covers. */
  count: number;
}

interface LexiconEntry {
  /** Tested against the lowercased description. */
  match: RegExp;
  categoryKey: string;
  /**
   * Which way the money must be going. Most payees are one-way — a power
   * company is a debit — but a refund from one is still about electricity, so
   * the direction is only set where the sign genuinely changes the answer.
   */
  direction?: 'debit' | 'credit';
  /** What to say on the row. */
  says: string;
}

/**
 * Payees a landlord meets, in the order they must be tested.
 *
 * Order is the whole design: ELECTRICIAN contains "electric", and a plumber's
 * invoice is a repair rather than a utility bill. The specific entry comes
 * first and the first match wins, so adding a general word later cannot
 * quietly capture rows an earlier line already answers for.
 */
const LEXICON: LexiconEntry[] = [
  // Trades before the utilities whose names they contain.
  { match: /\belectric(?:ian|al)\b/, categoryKey: 'maintenance_repairs', says: 'an electrician' },
  { match: /\b(?:plumb\w*|rooter|drain\s*service)\b/, categoryKey: 'maintenance_repairs', says: 'a plumber' },
  { match: /\b(?:hvac|air\s*condition\w*|heating\s*(?:and|&)\s*air|furnace)\b/, categoryKey: 'maintenance_repairs', says: 'HVAC work' },
  { match: /\b(?:roof\w*|gutter\w*|siding)\b/, categoryKey: 'maintenance_repairs', says: 'roofing work' },
  { match: /\b(?:handyman|handy\s*man|appliance\s*repair|garage\s*door)\b/, categoryKey: 'maintenance_repairs', says: 'a repair' },

  // Debt. A servicer's name is the most reliable signal on any statement.
  {
    match: /\b(?:mortgage|mtg|home\s*loan|loan\s*pmt|loan\s*payment|mr\s*cooper|pennymac|penny\s*mac|rocket\s*mortgage|freedom\s*mortgage|loandepot|shellpoint|servicemac|cenlar|newrez|carrington|select\s*portfolio|lakeview|nationstar)\b/,
    categoryKey: 'debt_service',
    direction: 'debit',
    says: 'a mortgage or loan payment',
  },

  // Utilities.
  {
    match: /\b(?:georgia\s*power|ga\s*power|jackson\s*emc|cobb\s*emc|walton\s*emc|greystone\s*power|sawnee|amicalola|snapping\s*shoals|duke\s*energy|electric|power\s*co)\b/,
    categoryKey: 'electric',
    says: 'a power company',
  },
  {
    match: /\b(?:atlanta\s*gas|gas\s*south|georgia\s*natural\s*gas|scana|infinite\s*energy|constellation|natural\s*gas|gas\s*co)\b/,
    categoryKey: 'gas',
    says: 'a gas supplier',
  },
  {
    match: /\b(?:water|sewer|watershed|dwm|dekalb\s*co\w*\s*water|county\s*water|utilit(?:y|ies))\b/,
    categoryKey: 'water_sewer',
    says: 'a water bill',
  },
  {
    match: /\b(?:waste\s*management|republic\s*services|gfl|sanitation|trash|garbage|recycl\w*)\b/,
    categoryKey: 'trash',
    says: 'trash collection',
  },
  {
    match: /\b(?:comcast|xfinity|spectrum|google\s*fiber|at\s*&?\s*t|att\b|earthlink|internet|broadband|wifi)\b/,
    categoryKey: 'internet',
    says: 'an internet bill',
  },

  // Property costs.
  {
    match: /\b(?:state\s*farm|allstate|geico|progressive|travelers|lemonade|steadily|obie|foremost|nationwide|liberty\s*mutual|usaa|insur\w*|policy\s*p(?:re)?m)\b/,
    categoryKey: 'insurance',
    says: 'an insurer',
  },
  {
    match: /\b(?:tax\s*comm\w*|property\s*tax|prop\s*tax|county\s*tax|tax\s*collector|ad\s*valorem)\b/,
    categoryKey: 'property_tax',
    says: 'a property tax bill',
  },
  {
    match: /\b(?:hoa|homeowner\w*\s*assoc\w*|community\s*assoc\w*|assoc\w*\s*dues|condo\s*assoc\w*)\b/,
    categoryKey: 'hoa',
    says: 'an HOA',
  },
  {
    match: /\b(?:lawn|landscap\w*|mowing|mow\b|yard\s*service|tree\s*service)\b/,
    categoryKey: 'lawn',
    says: 'lawn care',
  },
  {
    match: /\b(?:terminix|orkin|arrow\s*exterm\w*|exterm\w*|pest\w*|mosquito)\b/,
    categoryKey: 'pest_control',
    says: 'pest control',
  },
  {
    match: /\b(?:home\s*warranty|american\s*home\s*shield|ahs\b|first\s*american\s*home|choice\s*home\s*warranty)\b/,
    categoryKey: 'home_warranty',
    says: 'a home warranty',
  },
  {
    match: /\b(?:clean\w*|maid|janitor\w*|turnover\s*service)\b/,
    categoryKey: 'turn_cleaning',
    says: 'cleaning',
  },
  {
    match: /\b(?:wayfair|ikea|ashley\s*(?:furniture|home)|mattress|furniture|overstock)\b/,
    categoryKey: 'furnishings',
    says: 'furnishings',
  },
  {
    match: /\b(?:home\s*depot|lowe'?s|ace\s*hardware|harbor\s*freight|sherwin\s*williams|menards|tractor\s*supply)\b/,
    categoryKey: 'supplies',
    says: 'a hardware store',
  },
  {
    match: /\b(?:attorney|law\s*(?:firm|office|group)|legal|cpa\b|account\w*\s*(?:llc|firm)|bookkeep\w*|tax\s*prep\w*)\b/,
    categoryKey: 'professional_fees',
    says: 'a professional fee',
  },
  {
    match: /\b(?:overdraft|nsf\b|service\s*charge|monthly\s*(?:service|maintenance)\s*fee|wire\s*fee|returned\s*item\s*fee|analysis\s*(?:service\s*)?charge)\b/,
    categoryKey: 'bank_fee',
    says: 'a bank charge',
  },

  // Income.
  { match: /\bpadsplit\b/, categoryKey: 'padsplit_deposit', direction: 'credit', says: 'a PadSplit payout' },
  {
    match: /\b(?:transfer\s*(?:to|from)|online\s*transfer|internal\s*transfer|xfer)\b/,
    categoryKey: 'transfer_between_own_accounts',
    says: 'a transfer between your own accounts',
  },
];

/** Lowercased, punctuation flattened, so a regex meets one shape of text. */
function haystack(description: string): string {
  return description.toLowerCase().replace(/[^a-z0-9&'\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The payee stem two descriptions are compared on. */
export function payeeKey(description: string): string {
  return normalizePayee(description).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * History keyed by payee stem, with the categories it has been filed under.
 *
 * Built once for a page rather than per row: the same twenty payees recur, and
 * a query per unfiled row would be twenty queries for the same answer.
 */
export function historyIndex(entries: readonly HistoryEntry[]): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const key = payeeKey(entry.description);
    if (key.length < 3) continue;
    const counts = index.get(key) ?? new Map<string, number>();
    counts.set(entry.categoryKey, (counts.get(entry.categoryKey) ?? 0) + entry.count);
    index.set(key, counts);
  }
  return index;
}

function fromHistory(
  description: string,
  index: Map<string, Map<string, number>>,
  catalog: CategoryCatalog,
): Suggestion | null {
  const counts = index.get(payeeKey(description));
  if (!counts || counts.size === 0) return null;

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [key, count] = ranked[0];
  if (!category(key, catalog)) return null;

  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const label = category(key, catalog)?.label ?? key;
  // Split history is worth saying out loud: a payee filed two ways is usually
  // two different things sharing a name, and the picker's default is a coin toss.
  const settled = ranked.length === 1 || count / total >= 0.8;

  return {
    categoryKey: key,
    source: 'history',
    reason:
      ranked.length === 1
        ? `${count} like this ${count === 1 ? 'was' : 'were'} filed as ${label}`
        : `${count} of ${total} like this were filed as ${label}`,
    confidence: settled && count >= 2 ? 'high' : 'medium',
  };
}

function fromPayee(description: string, amountCents: Cents, catalog: CategoryCatalog): Suggestion | null {
  const text = haystack(description);
  const movement = amountCents < 0 ? 'debit' : 'credit';

  for (const entry of LEXICON) {
    if (entry.direction && entry.direction !== movement) continue;
    if (!entry.match.test(text)) continue;
    if (!category(entry.categoryKey, catalog)) continue;
    return {
      categoryKey: entry.categoryKey,
      source: 'payee',
      reason: `looks like ${entry.says}`,
      confidence: 'medium',
    };
  }
  return null;
}

/**
 * The category to open the picker on, and why.
 *
 * `reversalKey` is passed in rather than worked out here: pairing a charge to
 * its reversal needs every row on the account, which is a different question
 * from what one row is for.
 */
export function suggestCategory(
  row: { description: string; amountCents: Cents },
  options: {
    catalog: CategoryCatalog;
    history?: Map<string, Map<string, number>>;
    reversalKey?: string | null;
  },
): Suggestion {
  const { catalog, history, reversalKey } = options;

  if (reversalKey && category(reversalKey, catalog)) {
    return {
      categoryKey: reversalKey,
      source: 'reversal',
      reason: 'the row this cancels was filed here, so the two net to nothing',
      confidence: 'high',
    };
  }

  const learned = history ? fromHistory(row.description, history, catalog) : null;
  // History beats the lexicon: what you actually do with a payee outranks what
  // its name suggests. A hardware run that is always a capital improvement
  // should stop being called supplies after the second time you say so.
  if (learned && learned.confidence === 'high') return learned;

  const guessed = fromPayee(row.description, row.amountCents, catalog);
  if (learned && !guessed) return learned;
  if (guessed) return guessed;
  if (learned) return learned;

  return {
    categoryKey: row.amountCents > 0 ? 'rental_income' : 'maintenance_repairs',
    source: 'direction',
    reason: row.amountCents > 0 ? 'money in, and nothing else to go on' : 'money out, and nothing else to go on',
    confidence: 'low',
  };
}
