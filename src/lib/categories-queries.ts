import 'server-only';
import { cache } from 'react';
import { prisma } from './db';
import { mergeCatalog, type CategoryDef, type ScheduleELine, type TaxTreatment } from './engine/categories';

/**
 * Built-ins plus anything added here.
 *
 * Cached per request, since nearly every screen needs it and it changes about
 * as often as someone discovers they pay for pest control.
 */
export const getCategoryCatalog = cache(async (): Promise<CategoryDef[]> => {
  const custom = await prisma.customCategory.findMany({
    where: { archived: false },
    orderBy: { label: 'asc' },
  });

  return mergeCatalog(
    custom.map((row) => ({
      key: row.key,
      label: row.label,
      class: row.class as CategoryDef['class'],
      taxLine: (row.taxLine as ScheduleELine | null) ?? undefined,
      taxTreatment: row.taxTreatment as TaxTreatment,
      note: row.note ?? undefined,
      excludeFromPnl: row.class === 'not_income',
    })),
  );
});

/** The picker list: what a person chooses from while categorizing. */
export const getCategoryOptions = cache(async () => {
  const catalog = await getCategoryCatalog();
  return catalog.map((definition) => ({
    key: definition.key,
    label: definition.label,
    class: definition.class,
  }));
});
