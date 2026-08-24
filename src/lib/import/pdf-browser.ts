'use client';

/**
 * Reading a statement in the browser.
 *
 * The file never leaves the machine: what goes to the server is a few
 * kilobytes of parsed rows rather than a multi-megabyte PDF. That sidesteps
 * the request-body ceiling on a serverless function — which base64 makes a
 * third worse — along with cold starts and worker resolution in a deployed
 * bundle. It is also simply faster.
 */

import { groupIntoLines, rowsFromLines, type PdfLine, type PdfTextItem } from './pdf-core';

export interface PreparsedStatement {
  transactions: { date: string; description: string; amountCents: number; runningBalanceCents: number | null }[];
  skipped: { line: number; reason: string; raw: string }[];
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  signSource: 'running_balance' | 'section_heading' | 'column_position' | 'as_printed';
  sectionChecks: { section: string; statedCents: number; parsedCents: number; agrees: boolean }[];
  periodStart: string | null;
  periodEnd: string | null;
  /** Kept for routing: the statement's own header says which account it is. */
  text: string;
}

let workerConfigured = false;

/**
 * The worker is served from public/ rather than bundled: resolving it through
 * `new URL(..., import.meta.url)` does not survive the build, and a fake
 * worker would park the parse on the main thread.
 */
const WORKER_URL = '/pdf.worker.min.mjs';

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
    workerConfigured = true;
  }
  return pdfjs;
}

export async function extractLinesInBrowser(data: Uint8Array): Promise<PdfLine[]> {
  const pdfjs = await loadPdfjs();
  // A copy again, since callers may want their buffer back afterwards.
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;

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

export async function parsePdfInBrowser(data: Uint8Array): Promise<PreparsedStatement> {
  const lines = await extractLinesInBrowser(data);
  const draft = rowsFromLines(lines);

  return {
    transactions: draft.transactions.map((t) => ({
      date: t.date,
      description: t.description,
      amountCents: t.amountCents,
      runningBalanceCents: t.runningBalanceCents ?? null,
    })),
    skipped: draft.skipped,
    openingBalanceCents: draft.openingBalanceCents,
    closingBalanceCents: draft.closingBalanceCents,
    signSource: draft.signSource,
    sectionChecks: draft.sectionChecks,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    text: lines.map((line) => line.text).join('\n'),
  };
}
