'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { fromIsoDate } from './mappers';
import { recomputeMonths } from './rollups';
import { parsePadSplitFile, UnknownPadSplitFileError, type PadSplitFileKind } from './import/padsplit';
import { earningsMonthOf, tieToMonthTotals } from './engine/padsplit';

export interface PadSplitPreview {
  ok: boolean;
  error?: string;
  fileName: string;
  kind?: PadSplitFileKind;
  rowCount: number;
  months: string[];
  skipped: { line: number; reason: string; raw: string }[];
  unrecognizedHeaders: string[];
  /** PSIDs in the file with no property carrying that external id. */
  unknownProperties: string[];
  /** What is already stored for these months and would be replaced. */
  replaces: number;
}

const LABEL: Record<PadSplitFileKind, string> = {
  summary: 'Monthly summary',
  billed: 'What was charged',
  collected: 'What was collected',
  earnings_table: 'Portfolio totals',
};

export async function fileKindLabel(kind: PadSplitFileKind): Promise<string> {
  return LABEL[kind];
}

async function propertyIdsByExternalId(): Promise<Map<string, string>> {
  const properties = await prisma.property.findMany({
    where: { externalId: { not: null } },
    select: { id: true, externalId: true },
  });
  return new Map(properties.map((property) => [property.externalId as string, property.id]));
}

/**
 * What a file would do, before it does it.
 *
 * The point of showing this rather than importing straight away is that a
 * PadSplit export is four files and it is easy to drop the wrong month's. A
 * preview names the months, the rows and — the part that actually catches
 * mistakes — any PSID with no property behind it.
 */
export async function previewPadSplit(fileName: string, text: string): Promise<PadSplitPreview> {
  const empty = { ok: false, fileName, rowCount: 0, months: [], skipped: [], unrecognizedHeaders: [], unknownProperties: [], replaces: 0 };
  let parsed;
  try {
    parsed = parsePadSplitFile(text);
  } catch (error) {
    return {
      ...empty,
      error: error instanceof UnknownPadSplitFileError ? error.message : 'That file could not be read.',
    };
  }

  const known = await propertyIdsByExternalId();
  const psids = new Set<string>();
  for (const row of parsed.summary) psids.add(row.propertyExternalId);
  for (const row of parsed.billed) if (row.propertyExternalId) psids.add(row.propertyExternalId);
  for (const row of parsed.collected) if (row.propertyExternalId) psids.add(row.propertyExternalId);

  const table = { summary: 'summaryLine', billed: 'billedLine', collected: 'collectionLine', earnings_table: 'padSplitMonthTotal' } as const;
  const replaces =
    parsed.kind === 'earnings_table'
      ? await prisma.padSplitMonthTotal.count({ where: { earningsMonth: { in: parsed.months } } })
      : parsed.kind === 'summary'
        ? await prisma.summaryLine.count({ where: { earningsMonth: { in: parsed.months } } })
        : parsed.kind === 'billed'
          ? await prisma.billedLine.count({ where: { earningsMonth: { in: parsed.months } } })
          : await prisma.collectionLine.count({ where: { earningsMonth: { in: parsed.months } } });
  void table;

  return {
    ok: true,
    fileName,
    kind: parsed.kind,
    rowCount: parsed.rowCount,
    months: parsed.months,
    skipped: parsed.skipped.slice(0, 20),
    unrecognizedHeaders: parsed.unrecognizedHeaders,
    unknownProperties: [...psids].filter((psid) => !known.has(psid)).sort(),
    replaces,
  };
}

export interface PadSplitPostResult {
  ok: boolean;
  error?: string;
  kind?: PadSplitFileKind;
  rowsPosted: number;
  months: string[];
  /** Months where the per-property rows disagree with PadSplit's own total. */
  ties: { earningsMonth: string; field: string; differenceCents: number }[];
}

/**
 * Store a file, replacing whatever it covers.
 *
 * Replacement rather than append, per month and per file kind: PadSplit
 * re-states a month while it is still collecting, so importing August twice
 * has to mean the second one wins, not that August doubles.
 */
export async function postPadSplit(fileName: string, text: string): Promise<PadSplitPostResult> {
  let parsed;
  try {
    parsed = parsePadSplitFile(text);
  } catch (error) {
    return {
      ok: false,
      rowsPosted: 0,
      months: [],
      ties: [],
      error: error instanceof UnknownPadSplitFileError ? error.message : 'That file could not be read.',
    };
  }

  const known = await propertyIdsByExternalId();
  const months = parsed.months;
  const idFor = (psid: string | null) => (psid ? (known.get(psid) ?? null) : null);

  const record = await prisma.padSplitImport.create({
    data: { fileKind: parsed.kind, fileName, rowCount: parsed.rowCount, monthsCovered: months.join(',') },
  });

  if (parsed.kind === 'summary') {
    await prisma.summaryLine.deleteMany({ where: { earningsMonth: { in: months } } });
    await prisma.summaryLine.createMany({
      data: parsed.summary.map((row) => ({
        importId: record.id,
        propertyId: idFor(row.propertyExternalId),
        propertyExternalId: row.propertyExternalId,
        earningsMonth: row.earningsMonth,
        payoutMonth: row.payoutMonth,
        grossCents: row.grossCents,
        bookingFeesCents: row.bookingFeesCents,
        netOfBookingCents: row.netOfBookingFeesCents,
        serviceFeesCents: row.serviceFeesCents,
        hostEarningsCents: row.hostEarningsCents,
        adjustmentsCents: row.adjustmentsCents,
        totalPayoutCents: row.totalPayoutCents,
        payoutAccount: row.payoutAccount,
      })),
    });
  } else if (parsed.kind === 'billed') {
    await prisma.billedLine.deleteMany({ where: { earningsMonth: { in: months } } });
    await prisma.billedLine.createMany({
      data: parsed.billed.map((row) => ({
        importId: record.id,
        propertyId: idFor(row.propertyExternalId),
        propertyExternalId: row.propertyExternalId,
        roomExternalId: row.roomExternalId,
        roomNumber: row.roomNumber,
        memberId: row.memberId,
        memberName: row.memberName,
        earningsMonth: row.earningsMonth,
        billedDate: fromIsoDate(row.billedDate),
        billType: row.billType,
        reason: row.reason,
        kind: row.kind,
        amountCents: row.amountCents,
        billId: row.billId,
      })),
      skipDuplicates: true,
    });
  } else if (parsed.kind === 'collected') {
    await prisma.collectionLine.deleteMany({ where: { earningsMonth: { in: months } } });
    await prisma.collectionLine.createMany({
      data: parsed.collected.map((row) => ({
        importId: record.id,
        propertyId: idFor(row.propertyExternalId),
        propertyExternalId: row.propertyExternalId,
        roomExternalId: row.roomExternalId,
        roomNumber: row.roomNumber,
        memberId: row.memberId,
        memberName: row.memberName,
        billType: row.billType,
        category: row.category,
        amountCents: row.amountCents,
        bookingFeeCents: row.bookingFeeCents,
        serviceFeeCents: row.serviceFeeCents,
        hostEarningsCents: row.hostEarningsCents,
        payoutMonthRaw: row.payoutMonthRaw,
        createdDate: fromIsoDate(row.createdDate),
        earningsMonth: earningsMonthOf(row),
        billId: row.billId,
      })),
    });
  } else {
    await prisma.padSplitMonthTotal.deleteMany({ where: { earningsMonth: { in: months } } });
    await prisma.padSplitMonthTotal.createMany({
      data: parsed.monthTotals.map((total) => ({
        importId: record.id,
        earningsMonth: total.earningsMonth,
        inFlight: total.inFlight,
        collectionsCents: total.collectionsCents,
        expensesCents: total.expensesCents,
        adjustmentsCents: total.adjustmentsCents,
        payoutCents: total.payoutCents,
      })),
    });
  }

  // Whatever just landed, check the per-property rows against PadSplit's own
  // month totals. On a real export these agree exactly, so a difference is a
  // parsing fault worth seeing rather than a rounding one worth ignoring.
  const [totals, summaries] = await Promise.all([
    prisma.padSplitMonthTotal.findMany(),
    prisma.summaryLine.findMany(),
  ]);
  const ties = tieToMonthTotals(
    totals.map((t) => ({
      earningsMonth: t.earningsMonth,
      inFlight: t.inFlight,
      collectionsCents: t.collectionsCents,
      expensesCents: t.expensesCents,
      adjustmentsCents: t.adjustmentsCents,
      payoutCents: t.payoutCents,
    })),
    summaries.map((s) => ({
      earningsMonth: s.earningsMonth,
      grossCollectedCents: s.grossCents,
      adjustmentsCents: s.adjustmentsCents,
      payoutCents: s.totalPayoutCents,
    })),
  ).filter((tie) => summaries.some((s) => s.earningsMonth === tie.earningsMonth));

  // Cash basis: the money is income in the month it lands, which is the month
  // after the one it was earned in. Both are rebuilt so the operating figures
  // stay on the earnings month where they mean something.
  const touched = await prisma.summaryLine.findMany({
    where: { earningsMonth: { in: months }, propertyId: { not: null } },
    select: { propertyId: true, earningsMonth: true, payoutMonth: true },
  });
  const byProperty = new Map<string, Set<string>>();
  for (const row of touched) {
    const set = byProperty.get(row.propertyId as string) ?? new Set<string>();
    set.add(row.earningsMonth);
    set.add(row.payoutMonth);
    byProperty.set(row.propertyId as string, set);
  }
  for (const [propertyId, set] of byProperty) await recomputeMonths(propertyId, [...set]);

  revalidatePath('/', 'layout');
  return { ok: true, kind: parsed.kind, rowsPosted: parsed.rowCount, months, ties: ties.map((t) => ({ earningsMonth: t.earningsMonth, field: t.field, differenceCents: t.differenceCents })) };
}

export async function deletePadSplitImport(importId: string): Promise<{ ok: boolean }> {
  await prisma.padSplitImport.delete({ where: { id: importId } });
  revalidatePath('/', 'layout');
  return { ok: true };
}
