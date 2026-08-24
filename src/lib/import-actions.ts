'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { fromIsoDate, requireIsoDate } from './mappers';
import { recomputeMonths } from './rollups';
import { parseStatement, type ParsedStatement } from './import/csv';
import { parsePdfStatement } from './import/pdf';
import { matchAccount, readHints, type AccountCandidate, type AccountMatch } from './import/detect';
import {
  checkStatementBalance,
  classify,
  normalizePayee,
  reviewList,
  type PayeeRule,
} from './engine/bank';
import { category } from './engine/categories';
import { monthOf } from './engine/dates';

export interface StatementPreview {
  ok: boolean;
  error?: string;
  /** Which account the file was routed to, and on what evidence. */
  match?: AccountMatch;
  accountLabel?: string | null;
  /** Echoed back so the client can post exactly what was previewed. */
  transactionCount: number;
  matchedCount: number;
  unmatchedCount: number;
  skipped: { line: number; reason: string; raw: string }[];
  headers: string[];
  unrecognizedColumns: string[];
  periodStart: string | null;
  periodEnd: string | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  impliedOpening: boolean;
  impliedClosing: boolean;
  /** PDFs only: how each amount's direction was decided. */
  signSource?: SignSource;
  /** Section totals the statement printed, against what was parsed from them. */
  sectionChecks?: { section: string; statedCents: number; parsedCents: number; agrees: boolean }[];
  tie: {
    tied: boolean;
    creditsCents: number;
    debitsCents: number;
    computedClosingCents: number;
    statedClosingCents: number;
    differenceCents: number;
  } | null;
  sample: { date: string; description: string; amountCents: number; categoryKey: string | null }[];
}

async function rulesFor(bankAccountId: string): Promise<PayeeRule[]> {
  const rows = await prisma.payeeRule.findMany({
    where: { OR: [{ bankAccountId }, { bankAccountId: null }] },
  });
  return rows.map((r) => ({
    id: r.id,
    bankAccountId: r.bankAccountId,
    match: r.match,
    categoryKey: r.categoryKey,
    priority: r.priority,
  }));
}

interface PreviewInput {
  /** Omit and the statement is routed by what it says about itself. */
  bankAccountId?: string | null;
  fileName?: string | null;
  /** Exactly one of these. A CSV arrives as text, a PDF as base64. */
  csvText?: string;
  pdfBase64?: string;
  flipSign?: boolean;
  openingBalanceInput?: number | null;
  closingBalanceInput?: number | null;
}

type SignSource = 'running_balance' | 'section_heading' | 'column_position' | 'as_printed';

type Parsed = ParsedStatement & {
  signSource?: SignSource;
  periodStart?: string | null;
  periodEnd?: string | null;
  sectionChecks?: { section: string; statedCents: number; parsedCents: number; agrees: boolean }[];
  text?: string;
};

/**
 * Both formats end up in the same shape, so everything downstream — payee
 * rules, the balance check, the review list — is identical whichever was
 * uploaded.
 */
async function parseUpload(input: PreviewInput): Promise<Parsed> {
  if (input.pdfBase64) {
    return parsePdfStatement(Uint8Array.from(Buffer.from(input.pdfBase64, 'base64')), {
      flipSign: input.flipSign,
    });
  }
  const csv = input.csvText ?? '';
  return { ...parseStatement(csv, { flipSign: input.flipSign }), text: csv };
}

/**
 * Which account a file belongs to.
 *
 * A statement already says who it is for. Making someone pick it from a
 * dropdown for every file is asking them to repeat what the document states,
 * and to be right about it twelve times in a row.
 */
async function routeToAccount(parsed: Parsed, input: PreviewInput): Promise<AccountMatch> {
  if (input.bankAccountId) {
    return { accountId: input.bankAccountId, confidence: 'certain', reason: 'Chosen by hand.', alternatives: [] };
  }

  const accounts = await prisma.bankAccount.findMany({
    where: { active: true },
    include: { property: true },
  });
  const candidates: AccountCandidate[] = accounts.map((account) => ({
    id: account.id,
    label: `${account.property.name} · ${account.label}`,
    propertyName: account.property.name,
    propertyAddress: account.property.addressLine1,
    institution: account.institution,
    last4: account.last4,
  }));

  return matchAccount(readHints(parsed.text ?? '', input.fileName), candidates);
}

/**
 * Parse and check without writing anything.
 *
 * The balance check is the whole point of the upload step: opening + credits −
 * debits must equal closing, and a statement that does not tie is refused
 * rather than silently accepted as a partial (§7).
 */
export async function previewStatement(input: PreviewInput): Promise<StatementPreview> {
  const empty: StatementPreview = {
    ok: false,
    transactionCount: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    skipped: [],
    headers: [],
    unrecognizedColumns: [],
    periodStart: null,
    periodEnd: null,
    openingBalanceCents: null,
    closingBalanceCents: null,
    impliedOpening: false,
    impliedClosing: false,
    tie: null,
    sample: [],
    match: undefined,
    accountLabel: null,
  };

  const parsed = await parseUpload(input);
  if (parsed.transactions.length === 0) {
    return {
      ...empty,
      headers: parsed.headers,
      skipped: parsed.skipped,
      error: input.pdfBase64
        ? 'No transactions could be read out of that PDF. If it is a scan rather than a text PDF there is no text to extract, and the CSV or QFX export from the same account is the way in.'
        : parsed.headers.length === 0
          ? 'That file has no rows in it.'
          : `No readable transactions. Columns found: ${parsed.headers.join(', ') || '(none)'}. A date column and either an amount column or a debit/credit pair are needed.`,
    };
  }

  const match = await routeToAccount(parsed, input);
  if (!match.accountId) {
    return { ...empty, headers: parsed.headers, skipped: parsed.skipped, match, error: match.reason };
  }

  const rules = await rulesFor(match.accountId);
  const classified = classify(parsed.transactions, rules, match.accountId);
  const dates = classified.map((t) => t.date).sort();
  const periodStart = parsed.periodStart ?? dates[0] ?? null;
  const periodEnd = parsed.periodEnd ?? dates[dates.length - 1] ?? null;

  const openingBalanceCents = input.openingBalanceInput ?? parsed.impliedOpeningBalanceCents;
  const closingBalanceCents = input.closingBalanceInput ?? parsed.impliedClosingBalanceCents;

  const tie =
    openingBalanceCents !== null && closingBalanceCents !== null
      ? checkStatementBalance({
          openingBalanceCents,
          closingBalanceCents,
          transactions: classified,
        })
      : null;

  const account = await prisma.bankAccount.findUnique({
    where: { id: match.accountId },
    include: { property: true },
  });

  const known = new Set(
    [parsed.columns.date, parsed.columns.description, parsed.columns.amount, parsed.columns.debit, parsed.columns.credit, parsed.columns.balance].filter(
      (i) => i >= 0,
    ),
  );

  return {
    ok: true,
    match,
    accountLabel: account ? `${account.property.name} · ${account.label}` : null,
    signSource: parsed.signSource,
    sectionChecks: parsed.sectionChecks,
    transactionCount: classified.length,
    matchedCount: classified.filter((t) => t.categoryKey !== null).length,
    unmatchedCount: reviewList(classified).length,
    skipped: parsed.skipped,
    headers: parsed.headers,
    unrecognizedColumns: parsed.headers.filter((_, i) => !known.has(i)),
    periodStart,
    periodEnd,
    openingBalanceCents,
    closingBalanceCents,
    impliedOpening: input.openingBalanceInput === null || input.openingBalanceInput === undefined,
    impliedClosing: input.closingBalanceInput === null || input.closingBalanceInput === undefined,
    tie: tie
      ? {
          tied: tie.tied,
          creditsCents: tie.creditsCents,
          debitsCents: tie.debitsCents,
          computedClosingCents: tie.computedClosingCents,
          statedClosingCents: tie.statedClosingCents,
          differenceCents: tie.differenceCents,
        }
      : null,
    sample: classified.slice(0, 8).map((t) => ({
      date: t.date,
      description: t.description,
      amountCents: t.amountCents,
      categoryKey: t.categoryKey,
    })),
  };
}

export interface PostResult {
  ok: boolean;
  error?: string;
  statementId?: string;
  posted?: number;
  unmatched?: number;
  accountLabel?: string | null;
  /** False where the file carried no balances to check against. */
  checked?: boolean;
}

/**
 * Persist a statement, but only if it ties.
 *
 * "Refuse to post rather than silently accept a partial statement. This is a
 * correctness guarantee a live transaction feed can't offer, and it's what
 * catches a charge that landed in the wrong account." (§7)
 */
export async function postStatement(input: PreviewInput & { fileName?: string }): Promise<PostResult> {
  const preview = await previewStatement(input);
  if (!preview.ok) return { ok: false, error: preview.error };

  const accountId = preview.match?.accountId;
  if (!accountId) return { ok: false, error: preview.match?.reason ?? 'Could not tell which account this belongs to.' };

  // A statement that does not tie is refused, exactly as before. One that
  // carries no balances at all is a different case: it is posted, but marked
  // unchecked rather than passed off as reconciled.
  if (preview.tie && !preview.tie.tied) {
    return {
      ok: false,
      error: `Refusing to post: opening + credits − debits comes to ${(preview.tie.computedClosingCents / 100).toFixed(2)}, but the statement closes at ${(preview.tie.statedClosingCents / 100).toFixed(2)} — a difference of ${(preview.tie.differenceCents / 100).toFixed(2)}. The file is incomplete, the balances are wrong, or a row was misread.`,
    };
  }

  const parsed = await parseUpload(input);
  const rules = await rulesFor(accountId);
  const classified = classify(parsed.transactions, rules, accountId);

  const account = await prisma.bankAccount.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, error: 'That account no longer exists.' };

  const periodStart = preview.periodStart!;
  const periodEnd = preview.periodEnd!;

  const statement = await prisma.$transaction(async (tx) => {
    // Re-importing the same period replaces it rather than doubling it up.
    const existing = await tx.bankStatement.findUnique({
      where: {
        bankAccountId_periodStart_periodEnd: {
          bankAccountId: accountId,
          periodStart: fromIsoDate(periodStart),
          periodEnd: fromIsoDate(periodEnd),
        },
      },
    });
    if (existing) await tx.bankStatement.delete({ where: { id: existing.id } });

    return tx.bankStatement.create({
      data: {
        bankAccountId: accountId,
        periodStart: fromIsoDate(periodStart),
        periodEnd: fromIsoDate(periodEnd),
        openingBalanceCents: preview.openingBalanceCents ?? 0,
        closingBalanceCents: preview.closingBalanceCents ?? 0,
        computedClosingCents: preview.tie?.computedClosingCents ?? null,
        status: preview.tie?.tied ? 'posted' : 'pending',
        fileName: input.fileName ?? null,
        transactions: {
          create: classified.map((t) => ({
            date: fromIsoDate(t.date),
            description: t.description,
            amountCents: t.amountCents,
            runningBalanceCents: t.runningBalanceCents ?? null,
            categoryKey: t.categoryKey,
            matchedRuleId: t.matchedRuleId,
            confirmed: false,
          })),
        },
      },
    });
  });

  await recomputeMonths(account.propertyId, classified.map((t) => monthOf(t.date)));

  revalidatePath('/', 'layout');
  return {
    ok: true,
    statementId: statement.id,
    posted: classified.length,
    unmatched: preview.unmatchedCount,
    accountLabel: preview.accountLabel ?? null,
    checked: Boolean(preview.tie?.tied),
  };
}

/**
 * Confirm a reviewed row, and learn from it.
 *
 * "Confirm; rules learned here apply to every future import." (§7) That is the
 * whole difference from sorting transaction by transaction with no memory.
 */
export async function confirmTransaction(
  transactionId: string,
  categoryKey: string,
  createRule: boolean,
): Promise<{ ok: boolean; error?: string; ruleCreated?: boolean }> {
  if (!category(categoryKey)) return { ok: false, error: `Unknown category: ${categoryKey}` };

  const transaction = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    include: { statement: { include: { bankAccount: true } } },
  });
  if (!transaction) return { ok: false, error: 'That transaction no longer exists.' };

  const bankAccountId = transaction.statement.bankAccountId;
  let ruleCreated = false;

  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { categoryKey, confirmed: true },
  });

  if (createRule) {
    const match = normalizePayee(transaction.description);
    const duplicate = await prisma.payeeRule.findFirst({ where: { bankAccountId, match } });
    if (!duplicate && match.length >= 3) {
      await prisma.payeeRule.create({ data: { bankAccountId, match, categoryKey, priority: 0 } });
      ruleCreated = true;

      // Apply it to everything already imported on this account that is still
      // unmatched — the rule is retroactive by nature.
      const orphans = await prisma.bankTransaction.findMany({
        where: { statement: { bankAccountId }, categoryKey: null },
      });
      const hits = orphans.filter((o) => o.description.toLowerCase().includes(match.toLowerCase()));
      if (hits.length > 0) {
        await prisma.bankTransaction.updateMany({
          where: { id: { in: hits.map((h) => h.id) } },
          data: { categoryKey },
        });
      }
    }
  }

  await recomputeMonths(transaction.statement.bankAccount.propertyId, [monthOf(requireIsoDate(transaction.date))]);

  revalidatePath('/', 'layout');
  return { ok: true, ruleCreated };
}

export async function deleteStatement(statementId: string): Promise<{ ok: boolean; error?: string }> {
  const statement = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { bankAccount: true, transactions: { select: { date: true } } },
  });
  if (!statement) return { ok: false, error: 'That statement no longer exists.' };

  const months = statement.transactions.map((t) => monthOf(requireIsoDate(t.date)));
  await prisma.bankStatement.delete({ where: { id: statementId } });
  await recomputeMonths(statement.bankAccount.propertyId, months);

  revalidatePath('/', 'layout');
  return { ok: true };
}
