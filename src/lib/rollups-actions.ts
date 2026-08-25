'use server';

import { revalidatePath } from 'next/cache';
import { recomputeEverything } from './rollups';

export async function recomputeStoredFigures(): Promise<{ properties: number; months: number }> {
  const result = await recomputeEverything();
  revalidatePath('/', 'layout');
  return result;
}
