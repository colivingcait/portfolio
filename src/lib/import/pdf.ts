/**
 * Server-side PDF extraction.
 *
 * The browser path in pdf-browser.ts is preferred — it avoids shipping the
 * file to the server at all. This remains for anything that cannot run there.
 */

import type { IsoDate } from '../engine/dates';
import type { ParsedStatement } from './csv';
import { groupIntoLines, rowsFromLines, type PdfLine, type PdfStatementDraft, type PdfTextItem } from './pdf-core';

export * from './pdf-core';

/** Pull positioned text out of a PDF, page by page. */
export async function extractLines(data: Uint8Array): Promise<PdfLine[]> {
  // The legacy build is the one that runs outside a browser.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const lines: PdfLine[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];

    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const transform = item.transform as number[];
      items.push({ text: item.str, x: transform[4], y: transform[5] });
    }

    lines.push(...groupIntoLines(items, pageNumber));
  }

  await doc.cleanup();
  return lines;
}

/** A PDF, in the same shape the CSV path produces. */
export async function parsePdfStatement(
  data: Uint8Array,
  options: { flipSign?: boolean; year?: number } = {},
): Promise<
  ParsedStatement & {
    signSource: PdfStatementDraft['signSource'];
    periodStart: IsoDate | null;
    periodEnd: IsoDate | null;
    sectionChecks: PdfStatementDraft['sectionChecks'];
    text: string;
  }
> {
  const lines = await extractLines(data);
  const draft = rowsFromLines(lines, { year: options.year });

  return {
    text: lines.map((line) => line.text).join('\n'),
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    sectionChecks: draft.sectionChecks,
    transactions: options.flipSign
      ? draft.transactions.map((t) => ({ ...t, amountCents: -t.amountCents }))
      : draft.transactions,
    skipped: draft.skipped,
    columns: { date: -1, description: -1, amount: -1, debit: -1, credit: -1, balance: -1 },
    headers: [],
    impliedOpeningBalanceCents: draft.openingBalanceCents,
    impliedClosingBalanceCents: draft.closingBalanceCents,
    signSource: draft.signSource,
  };
}
