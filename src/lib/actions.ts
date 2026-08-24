'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from './db';
import { MODELS, type ModelKey } from './models';
import { FieldError, parseForm } from './forms';
import { fromIsoDate, toOwnershipInterest } from './mappers';
import { wouldCreateCycle } from './engine/ownership';

export interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
  id?: string;
}

/**
 * Prisma's delegates are structurally identical for the operations used here,
 * but their generated argument types are not mutually assignable. This is the
 * one place that loosens them, so nothing else has to.
 */
type Delegate = {
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

const DELEGATES: Record<ModelKey, () => Delegate> = {
  entity: () => prisma.entity as unknown as Delegate,
  property: () => prisma.property as unknown as Delegate,
  ownershipInterest: () => prisma.ownershipInterest as unknown as Delegate,
  managementPeriod: () => prisma.managementPeriod as unknown as Delegate,
  bankAccount: () => prisma.bankAccount as unknown as Delegate,
  loan: () => prisma.loan as unknown as Delegate,
  loanPayment: () => prisma.loanPayment as unknown as Delegate,
  lease: () => prisma.lease as unknown as Delegate,
  payeeRule: () => prisma.payeeRule as unknown as Delegate,
  capitalAccountEntry: () => prisma.capitalAccountEntry as unknown as Delegate,
};

/** Date fields go in as Dates; everything else passes through as parsed. */
function toPrismaData(modelKey: ModelKey, parsed: Record<string, unknown>): Record<string, unknown> {
  const spec = MODELS[modelKey];
  const data: Record<string, unknown> = {};

  for (const field of spec.fields) {
    const value = parsed[field.name];
    if (field.type === 'date') {
      data[field.name] = typeof value === 'string' ? fromIsoDate(value) : null;
    } else {
      data[field.name] = value;
    }
  }

  return data;
}

/**
 * Model-specific rules that have to hold before anything is written.
 * Warnings (an ownership stack that does not total 100%) are deliberately NOT
 * here — those surface in the UI, because partial records are normal while
 * you are entering them (§3).
 */
async function validate(modelKey: ModelKey, id: string | null, data: Record<string, unknown>): Promise<void> {
  if (modelKey === 'ownershipInterest') {
    const ownedType = data.ownedType as string;
    if (ownedType === 'property') {
      if (!data.propertyId) throw new FieldError('propertyId', 'Pick the property this interest is in');
      data.ownedEntityId = null;
    } else {
      if (!data.ownedEntityId) throw new FieldError('ownedEntityId', 'Pick the entity this interest is in');
      data.propertyId = null;
    }

    // Cycles are rejected outright (§3).
    if (ownedType === 'entity') {
      const rows = await prisma.ownershipInterest.findMany({ where: id ? { NOT: { id } } : {} });
      const existing = rows.map(toOwnershipInterest);
      const creates = wouldCreateCycle(existing, {
        ownerId: data.ownerId as string,
        ownedId: data.ownedEntityId as string,
        ownedType: 'entity',
      });
      if (creates) {
        throw new FieldError('ownedEntityId', 'That would make the ownership graph circular');
      }
    }
  }

  if (modelKey === 'loan') {
    if (!data.termMonths && !data.maturityDate) {
      throw new FieldError('termMonths', 'A loan needs either a term in months or a maturity date');
    }
    if (data.structure === 'custom' && !data.paymentAmountCents) {
      throw new FieldError('paymentAmountCents', 'A custom structure needs an explicit payment amount');
    }
  }

  if (modelKey === 'entity' && data.isViewer === true) {
    // Exactly one entity is "me" — the node My share traverses from.
    await prisma.entity.updateMany({
      where: id ? { isViewer: true, NOT: { id } } : { isViewer: true },
      data: { isViewer: false },
    });
  }
}

export async function saveRecord(
  modelKey: ModelKey,
  id: string | null,
  formData: FormData,
): Promise<ActionResult> {
  const spec = MODELS[modelKey];
  if (!spec) return { ok: false, error: `Unknown model: ${modelKey}` };

  try {
    const parsed = parseForm(spec.fields, formData);
    const data = toPrismaData(modelKey, parsed);
    await validate(modelKey, id, data);

    const delegate = DELEGATES[modelKey]();
    const row = id
      ? await delegate.update({ where: { id }, data })
      : await delegate.create({ data });

    revalidatePath('/', 'layout');
    return { ok: true, id: row.id };
  } catch (error) {
    if (error instanceof FieldError) {
      return { ok: false, error: error.message, field: error.field };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save' };
  }
}

export async function deleteRecord(modelKey: ModelKey, id: string): Promise<ActionResult> {
  try {
    await DELEGATES[modelKey]().delete({ where: { id } });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not delete' };
  }
}
