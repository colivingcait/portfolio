/**
 * Reading a statement's own header so nothing has to be typed.
 *
 * A statement already says which account it belongs to, what period it covers
 * and what it opened and closed at. Asking someone to re-enter that is asking
 * them to transcribe a document they are already holding — and transcription
 * is where the errors come from.
 *
 * Pure: text in, findings out. Matching those findings against real accounts
 * is separate and also pure, so both are testable without a database.
 */

import type { IsoDate } from '../engine/dates';
import { parseAmount, parseDate } from './csv';
import type { Cents } from '../engine/money';

export interface StatementHints {
  /**
   * Last four digits printed in the statement header — the account the
   * statement is actually for.
   */
  accountLast4: string[];
  /**
   * Last four digits mentioned anywhere else: a linked overdraft account, the
   * far side of a transfer, a card number. Weak evidence, and routing on it
   * would put a statement against the wrong property.
   */
  otherLast4: string[];
  /** Longer account fragments, where the statement prints more. */
  accountNumbers: string[];
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  openingBalanceCents: Cents | null;
  closingBalanceCents: Cents | null;
  /** Lowercased text, for matching institution and property names against. */
  haystack: string;
}

const OPENING_LABELS = /(beginning|opening|previous|starting)\s+balance[^0-9\-(]{0,40}([-(]?\$?[\d,]+\.\d{2}\)?)/i;
const CLOSING_LABELS = /(ending|closing|new|current)\s+balance[^0-9\-(]{0,40}([-(]?\$?[\d,]+\.\d{2}\)?)/i;

/**
 * Account numbers, however the bank chose to mask them.
 * Everything is reduced to the last four digits, since that is what an account
 * record stores and the only part reliably printed.
 */
export function findAccountNumbers(text: string): {
  primary: string[];
  secondary: string[];
  full: string[];
} {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  const full = new Set<string>();

  // "Account Number: 000000123456789" — the statement's own account.
  const headerPatterns = [
    /account\s*(?:number|no\.?|#)\s*[:#]?\s*([xX*•·\-\s]*\d{4,})/gi,
    /acct\.?\s*(?:number|no\.?|#)\s*[:#]?\s*([xX*•·\-\s]*\d{4,})/gi,
    /\b[xX*•·]{3,}\s*(\d{4})\b/g,
  ];
  // "your account ending in 6370 is linked for overdraft protection" — a
  // different account entirely, and routing on it would be a real mistake.
  const weakPatterns = [/(?:ending in|ending|last four|last 4)\s*[:#]?\s*(\d{4})\b/gi];

  for (const pattern of headerPatterns) {
    for (const match of text.matchAll(pattern)) {
      const digits = (match[1] ?? '').replace(/\D/g, '');
      if (digits.length >= 4) {
        primary.add(digits.slice(-4));
        if (digits.length > 4) full.add(digits);
      }
    }
  }
  for (const pattern of weakPatterns) {
    for (const match of text.matchAll(pattern)) {
      const digits = (match[1] ?? '').replace(/\D/g, '');
      if (digits.length === 4 && !primary.has(digits)) secondary.add(digits);
    }
  }

  return { primary: [...primary], secondary: [...secondary], full: [...full] };
}

/** The period a statement covers, where it prints one. */
export function findPeriod(text: string): { start: IsoDate | null; end: IsoDate | null } {
  const dateLike = '(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s*\\d{4})';
  const patterns = [
    new RegExp(`statement\\s*(?:period|dates?|for)?\\s*[:#]?\\s*${dateLike}\\s*(?:-|–|—|to|through)\\s*${dateLike}`, 'i'),
    new RegExp(`(?:for\\s+the\\s+period|period)\\s*[:#]?\\s*${dateLike}\\s*(?:-|–|—|to|through)\\s*${dateLike}`, 'i'),
    new RegExp(`${dateLike}\\s*(?:-|–|—|through)\\s*${dateLike}`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const start = parseDate(match[1]);
    const end = parseDate(match[2]);
    if (start && end && start <= end) return { start, end };
  }

  return { start: null, end: null };
}

/**
 * Digits in a filename are often the account: banks name downloads things like
 * 20260731-statements-0985.pdf. Weak on its own, decisive alongside a match.
 */
export function last4FromFilename(fileName: string | null | undefined): string[] {
  if (!fileName) return [];
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const found = new Set<string>();
  for (const match of base.matchAll(/(\d{4})(?!\d)/g)) {
    const digits = match[1];
    // Skip anything that is obviously a year or a month-day pair.
    if (/^(19|20)\d{2}$/.test(digits)) continue;
    found.add(digits);
  }
  return [...found];
}

export function readHints(text: string, fileName?: string | null): StatementHints {
  const accounts = findAccountNumbers(text);
  const period = findPeriod(text);
  const opening = text.match(OPENING_LABELS);
  const closing = text.match(CLOSING_LABELS);

  return {
    accountLast4: accounts.primary,
    otherLast4: [...accounts.secondary, ...last4FromFilename(fileName)],
    accountNumbers: accounts.full,
    periodStart: period.start,
    periodEnd: period.end,
    openingBalanceCents: opening ? parseAmount(opening[2]) : null,
    closingBalanceCents: closing ? parseAmount(closing[2]) : null,
    haystack: text.toLowerCase(),
  };
}

// ── Matching hints to an account ─────────────────────────────────────────────

export interface AccountCandidate {
  id: string;
  label: string;
  propertyName: string;
  propertyAddress: string | null;
  institution: string | null;
  last4: string | null;
}

export interface AccountMatch {
  accountId: string | null;
  confidence: 'certain' | 'likely' | 'ambiguous' | 'none';
  /** Said plainly in the interface, so an automatic choice is never mysterious. */
  reason: string;
  /** Where more than one account fits, all of them. */
  alternatives: string[];
}

const SCORES = { last4: 5, weakLast4: 2, address: 3, propertyName: 2, institution: 1 };

/**
 * Which account a statement belongs to.
 *
 * The account number is decisive where it is printed. Failing that, an address
 * or property name in the document is good evidence; the institution alone is
 * not, since several properties may bank in the same place.
 */
export function matchAccount(hints: StatementHints, accounts: readonly AccountCandidate[]): AccountMatch {
  if (accounts.length === 0) {
    return { accountId: null, confidence: 'none', reason: 'No bank accounts have been set up yet.', alternatives: [] };
  }

  const scored = accounts.map((account) => {
    let score = 0;
    const reasons: string[] = [];

    if (account.last4 && hints.accountLast4.includes(account.last4)) {
      score += SCORES.last4;
      reasons.push(`the account number ending ${account.last4}`);
    } else if (account.last4 && hints.otherLast4.includes(account.last4)) {
      score += SCORES.weakLast4;
      reasons.push(`${account.last4} appearing in the file or its name`);
    }
    for (const [candidate, points, label] of [
      [account.propertyAddress, SCORES.address, 'the property address'],
      [account.propertyName, SCORES.propertyName, 'the property name'],
    ] as const) {
      if (!candidate) continue;
      // Match on the distinctive head of the name — "466 raven springs" —
      // since a statement writes it as "466 Raven Springs LLC" where the
      // property is recorded as "466 Raven Springs Trail".
      const words = candidate.toLowerCase().split(',')[0].trim().split(/\s+/);
      const stem = words.slice(0, Math.min(3, words.length)).join(' ');
      if (stem.length > 6 && hints.haystack.includes(stem)) {
        score += points;
        reasons.push(label);
        break;
      }
    }
    if (account.institution && hints.haystack.includes(account.institution.toLowerCase())) {
      score += SCORES.institution;
      reasons.push(account.institution);
    }

    return { account, score, reasons };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];

  if (best.score === 0) {
    return {
      accountId: null,
      confidence: 'none',
      reason:
        hints.accountLast4.length > 0
          ? `The statement is for an account ending ${hints.accountLast4.join(', ')}, which matches nothing on file. Put those four digits on the account in Settings and every future statement routes itself.`
          : 'Nothing in the file identifies the account — no account number, address or property name.',
      alternatives: [],
    };
  }

  if (runnerUp && runnerUp.score === best.score) {
    return {
      accountId: null,
      confidence: 'ambiguous',
      reason: `Matches ${ranked.filter((r) => r.score === best.score).length} accounts equally well on ${best.reasons.join(' and ')}.`,
      alternatives: ranked.filter((r) => r.score === best.score).map((r) => r.account.id),
    };
  }

  return {
    accountId: best.account.id,
    confidence: best.score >= SCORES.last4 ? 'certain' : 'likely',
    reason: `Matched on ${best.reasons.join(' and ')}.`,
    alternatives: [],
  };
}
