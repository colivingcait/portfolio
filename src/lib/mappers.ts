/**
 * The layer between Prisma rows and the engine.
 *
 * The engine takes plain numbers and ISO date strings and knows nothing about
 * Prisma. Every conversion — Decimal to number, Date to 'YYYY-MM-DD' — happens
 * here and nowhere else.
 */

import type { Prisma } from '@prisma/client';
import type { IsoDate } from './engine/dates';
import type { LoanTerms, LoanPaymentRecord } from './engine/amortization';
import type { OwnershipInterest } from './engine/ownership';
import type { ManagementPeriod } from './engine/management';

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

export function toNumberOrNull(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

/** A @db.Date column comes back as a Date at UTC midnight. Keep the calendar day. */
export function toIsoDate(value: Date | null | undefined): IsoDate | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function requireIsoDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

/** Store a calendar date at UTC midnight so it round-trips unchanged. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export interface LoanRow {
  id: string;
  originalPrincipalCents: number;
  ratePercent: DecimalLike;
  startDate: Date;
  firstPaymentDate: Date;
  termMonths: number | null;
  maturityDate: Date | null;
  paymentAmountCents: number | null;
  structure: string;
  paymentFrequency?: string;
  balloonAmountCents: number | null;
  escrowIncluded: boolean;
  escrowCents: number | null;
}

export function toLoanTerms(loan: LoanRow): LoanTerms {
  return {
    originalPrincipalCents: loan.originalPrincipalCents,
    annualRatePercent: toNumber(loan.ratePercent),
    startDate: requireIsoDate(loan.startDate),
    firstPaymentDate: requireIsoDate(loan.firstPaymentDate),
    termMonths: loan.termMonths,
    maturityDate: toIsoDate(loan.maturityDate),
    paymentAmountCents: loan.paymentAmountCents,
    structure: loan.structure as LoanTerms['structure'],
    paymentFrequency: (loan.paymentFrequency as LoanTerms['paymentFrequency']) ?? 'monthly',
    balloonAmountCents: loan.balloonAmountCents,
    escrowIncluded: loan.escrowIncluded,
    escrowCents: loan.escrowCents,
  };
}

export interface LoanPaymentRow {
  date: Date;
  totalCents: number;
  principalCents: number;
  interestCents: number;
  escrowCents: number;
  extraPrincipalCents: number;
  source: string;
}

export function toLoanPayment(payment: LoanPaymentRow): LoanPaymentRecord {
  return {
    date: requireIsoDate(payment.date),
    totalCents: payment.totalCents,
    principalCents: payment.principalCents,
    interestCents: payment.interestCents,
    escrowCents: payment.escrowCents,
    extraPrincipalCents: payment.extraPrincipalCents,
    source: payment.source === 'scheduled' ? 'scheduled' : 'actual',
  };
}

export interface OwnershipInterestRow {
  id: string;
  ownerId: string;
  ownedType: string;
  propertyId: string | null;
  ownedEntityId: string | null;
  percent: DecimalLike;
  distributionPercent: DecimalLike;
  startDate: Date;
  endDate: Date | null;
  basis: string;
}

export function toOwnershipInterest(row: OwnershipInterestRow): OwnershipInterest {
  const ownedType = row.ownedType === 'entity' ? 'entity' : 'property';
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownedId: (ownedType === 'entity' ? row.ownedEntityId : row.propertyId) ?? '',
    ownedType,
    percent: toNumber(row.percent),
    distributionPercent: toNumberOrNull(row.distributionPercent),
    startDate: requireIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    basis: row.basis === 'distribution' ? 'distribution' : 'equity',
  };
}

export interface ManagementPeriodRow {
  id: string;
  propertyId: string;
  startDate: Date;
  endDate: Date | null;
  mode: string;
  managerName: string | null;
  feePercent: DecimalLike;
  feeBasis: string | null;
}

export function toManagementPeriod(row: ManagementPeriodRow): ManagementPeriod {
  return {
    id: row.id,
    propertyId: row.propertyId,
    startDate: requireIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    mode: row.mode === 'pm' ? 'pm' : 'self',
    managerName: row.managerName,
    feePercent: toNumberOrNull(row.feePercent),
    feeBasis: (row.feeBasis as ManagementPeriod['feeBasis']) ?? null,
  };
}
