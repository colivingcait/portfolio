'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { fromIsoDate, toOwnershipInterest } from './mappers';
import { findTotalsWarnings, wouldCreateCycle, type OwnershipInterest } from './engine/ownership';

export interface SplitRow {
  ownerId: string;
  /** Whole-number percentage: 50 means 50%. */
  percent: number;
  distributionPercent: number | null;
  startDate: string;
  endDate: string | null;
}

export interface SplitInput {
  ownedType: 'property' | 'entity';
  ownedId: string;
  rows: SplitRow[];
}

export interface SplitResult {
  ok: boolean;
  error?: string;
  /** Row index the error belongs to, where it is specific to one. */
  rowIndex?: number;
  created?: number;
  /** Totals that do not come to 100% on the start date. Warn, never block (§3). */
  warning?: string;
}

/**
 * Record a whole ownership split in one pass.
 *
 * Interests in one property normally arrive together — three partners and
 * their percentages — and entering them one at a time means re-picking the
 * property for each and never seeing whether the stack totals 100% until it
 * is already saved.
 *
 * A total that misses 100% is reported, not refused: partial records are
 * normal while you are entering them. Cycles are refused outright.
 */
export async function saveOwnershipSplit(input: SplitInput): Promise<SplitResult> {
  if (!input.ownedId) return { ok: false, error: 'Pick what is being owned.' };

  const rows = input.rows.filter((row) => row.ownerId !== '' || row.percent !== 0);
  if (rows.length === 0) return { ok: false, error: 'Add at least one owner.' };

  for (const [index, row] of rows.entries()) {
    if (!row.ownerId) return { ok: false, error: 'Pick an owner.', rowIndex: index };
    if (!Number.isFinite(row.percent) || row.percent <= 0) {
      return { ok: false, error: 'Percent must be greater than zero.', rowIndex: index };
    }
    if (row.percent > 100) {
      return { ok: false, error: 'A single interest cannot exceed 100%.', rowIndex: index };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.startDate)) {
      return { ok: false, error: 'A start date is required — every interest is dated.', rowIndex: index };
    }
    if (row.endDate && row.endDate < row.startDate) {
      return { ok: false, error: 'The end date falls before the start date.', rowIndex: index };
    }
    if (input.ownedType === 'entity' && row.ownerId === input.ownedId) {
      return { ok: false, error: 'An entity cannot hold itself.', rowIndex: index };
    }
  }

  // Duplicate owners in one submission would silently double an interest.
  const owners = rows.map((row) => row.ownerId);
  const duplicate = owners.find((owner, i) => owners.indexOf(owner) !== i);
  if (duplicate) {
    return {
      ok: false,
      error: 'The same owner appears twice. Combine them into one interest, or date them separately.',
      rowIndex: owners.lastIndexOf(duplicate),
    };
  }

  const existingRows = await prisma.ownershipInterest.findMany();
  const existing: OwnershipInterest[] = existingRows.map(toOwnershipInterest);

  if (input.ownedType === 'entity') {
    for (const [index, row] of rows.entries()) {
      if (wouldCreateCycle(existing, { ownerId: row.ownerId, ownedId: input.ownedId, ownedType: 'entity' })) {
        return { ok: false, error: 'That would make the ownership graph circular.', rowIndex: index };
      }
    }
  }

  await prisma.$transaction(
    rows.map((row) =>
      prisma.ownershipInterest.create({
        data: {
          ownerId: row.ownerId,
          ownedType: input.ownedType,
          propertyId: input.ownedType === 'property' ? input.ownedId : null,
          ownedEntityId: input.ownedType === 'entity' ? input.ownedId : null,
          percent: row.percent,
          distributionPercent: row.distributionPercent,
          startDate: fromIsoDate(row.startDate),
          endDate: row.endDate ? fromIsoDate(row.endDate) : null,
          basis: 'equity',
        },
      }),
    ),
  );

  // Re-check totals against everything now stored, not just what was submitted:
  // an earlier interest may already cover part of this thing.
  const afterRows = await prisma.ownershipInterest.findMany();
  const asOf = rows[0].startDate;
  const warnings = findTotalsWarnings(afterRows.map(toOwnershipInterest), asOf);
  const relevant = warnings.find((w) => w.ownedId === input.ownedId);

  revalidatePath('/', 'layout');
  return {
    ok: true,
    created: rows.length,
    warning: relevant
      ? `Saved, but interests in this now total ${relevant.totalPercent}% as of ${asOf} rather than 100%. That is fine while you are still entering them.`
      : undefined,
  };
}

export interface QuickEntityResult {
  ok: boolean;
  error?: string;
  id?: string;
  label?: string;
  /** True where an entity of that name already existed and was reused. */
  reused?: boolean;
}

/**
 * Create an entity without leaving the form.
 *
 * A partner usually turns up while the split is being entered, and going to
 * Owners → Entities to add them would discard the rows already typed.
 *
 * An exact name match is reused rather than duplicated: two entities with the
 * same name are indistinguishable in every dropdown afterwards, and a
 * duplicate silently splits a partner's holdings across two nodes so neither
 * one totals correctly.
 */
export async function createEntityInline(input: {
  name: string;
  kind: 'person' | 'company';
}): Promise<QuickEntityResult> {
  const name = input.name.trim();
  if (name === '') return { ok: false, error: 'Give the entity a name.' };
  if (input.kind !== 'person' && input.kind !== 'company') {
    return { ok: false, error: 'Pick whether this is a person or a company.' };
  }

  const existing = await prisma.entity.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    revalidatePath('/', 'layout');
    return { ok: true, id: existing.id, label: existing.name, reused: true };
  }

  const entity = await prisma.entity.create({ data: { name, kind: input.kind } });
  revalidatePath('/', 'layout');
  return { ok: true, id: entity.id, label: entity.name };
}
