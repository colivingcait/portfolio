'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { CATEGORIES, keyFromLabel, type ScheduleELine, type TaxTreatment } from './engine/categories';

export interface CategoryResult {
  ok: boolean;
  error?: string;
  key?: string;
}

const CLASSES = ['income', 'not_income', 'expense'];
const TREATMENTS = ['income', 'deductible', 'capitalizable', 'not_reportable'];

/**
 * Add a category, or override a built-in.
 *
 * The key is derived from the label once and then fixed: renaming "Pest
 * control" later must not orphan the transactions already filed under it.
 */
export async function saveCategory(input: {
  id?: string | null;
  label: string;
  class: string;
  taxTreatment: string;
  taxLine?: string | null;
  note?: string | null;
}): Promise<CategoryResult> {
  const label = input.label.trim();
  if (label.length < 2) return { ok: false, error: 'Give the category a name.' };
  if (!CLASSES.includes(input.class)) return { ok: false, error: 'Pick whether this is income, an expense, or neither.' };
  if (!TREATMENTS.includes(input.taxTreatment)) return { ok: false, error: 'Pick how this is treated at year end.' };

  if (input.id) {
    const existing = await prisma.customCategory.findUnique({ where: { id: input.id } });
    if (!existing) return { ok: false, error: 'That category no longer exists.' };
    await prisma.customCategory.update({
      where: { id: input.id },
      data: {
        label,
        class: input.class,
        taxTreatment: input.taxTreatment,
        taxLine: input.taxLine || null,
        note: input.note || null,
      },
    });
    revalidatePath('/', 'layout');
    return { ok: true, key: existing.key };
  }

  const key = keyFromLabel(label);
  if (!key) return { ok: false, error: 'That name has no letters or numbers in it.' };

  const clash = await prisma.customCategory.findUnique({ where: { key } });
  if (clash) return { ok: false, error: `“${clash.label}” already uses that name.` };

  // A key matching a built-in is an override, which is how a mapping you
  // disagree with gets corrected rather than argued with.
  const overrides = CATEGORIES.some((definition) => definition.key === key);

  await prisma.customCategory.create({
    data: {
      key,
      label,
      class: input.class,
      taxTreatment: input.taxTreatment,
      taxLine: input.taxLine || null,
      note: input.note || null,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true, key: overrides ? key : key };
}

/**
 * Archive rather than delete: transactions already filed under a category keep
 * pointing at it, and a year-end report for a past year still needs to resolve
 * the name.
 */
export async function archiveCategory(id: string): Promise<CategoryResult> {
  const existing = await prisma.customCategory.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'That category no longer exists.' };

  const inUse = await prisma.bankTransaction.count({ where: { categoryKey: existing.key } });
  await prisma.customCategory.update({ where: { id }, data: { archived: true } });
  revalidatePath('/', 'layout');

  return {
    ok: true,
    error: inUse > 0 ? `Hidden from the pickers. ${inUse} transactions still use it and are untouched.` : undefined,
  };
}

export async function restoreCategory(id: string): Promise<CategoryResult> {
  await prisma.customCategory.update({ where: { id }, data: { archived: false } });
  revalidatePath('/', 'layout');
  return { ok: true };
}
