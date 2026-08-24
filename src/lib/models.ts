/**
 * The manual-entry surface: build order step 1 (§13).
 *
 * "Entities, ownership interests, properties, accounts, management periods,
 * loans. All manual entry. Effective-share traversal and the maturity ladder
 * working. Useful the day it ships."
 *
 * Each model declares its fields once. The form renderer and the server action
 * both read this, so they cannot disagree about what a field means.
 */

import { CATEGORIES } from './engine/categories';
import type { Field } from './forms';

export type ModelKey =
  | 'entity'
  | 'property'
  | 'ownershipInterest'
  | 'managementPeriod'
  | 'bankAccount'
  | 'loan'
  | 'loanPayment'
  | 'lease'
  | 'payeeRule'
  | 'capitalAccountEntry';

export interface ModelSpec {
  key: ModelKey;
  label: string;
  plural: string;
  fields: Field[];
  /** Fields whose options come from the database, keyed by field name. */
  dynamicOptions?: string[];
}

const opts = (...values: [string, string][]) => values.map(([value, label]) => ({ value, label }));

export const MODELS: Record<ModelKey, ModelSpec> = {
  entity: {
    key: 'entity',
    label: 'Entity',
    plural: 'Entities',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, span: 6, placeholder: 'Lustra House LLC' },
      {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: true,
        span: 3,
        options: opts(['person', 'Person'], ['company', 'Company']),
        defaultValue: 'person',
      },
      {
        name: 'isViewer',
        label: 'This is me',
        type: 'checkbox',
        span: 3,
        help: 'The node the “My share” view traverses from. Set it on exactly one entity.',
      },
      { name: 'taxId', label: 'Tax ID', type: 'text', span: 6, placeholder: '12-3456789' },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 12 },
    ],
  },

  property: {
    key: 'property',
    label: 'Property',
    plural: 'Properties',
    dynamicOptions: ['titleEntityId'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, span: 6 },
      {
        name: 'externalId',
        label: 'PadSplit PSID',
        type: 'text',
        span: 3,
        placeholder: '11889',
        help: 'Leave empty for properties that have nothing to do with PadSplit.',
      },
      {
        name: 'titleEntityId',
        label: 'Entity holding title',
        type: 'select',
        required: true,
        span: 3,
        options: [],
      },
      { name: 'addressLine1', label: 'Address', type: 'text', span: 6, placeholder: '466 Raven Springs Trail' },
      { name: 'city', label: 'City', type: 'text', span: 3, placeholder: 'Atlanta' },
      { name: 'state', label: 'State', type: 'text', span: 1, placeholder: 'GA' },
      { name: 'postalCode', label: 'ZIP', type: 'text', span: 2, placeholder: '30316' },
      {
        name: 'revenueSource',
        label: 'Revenue source',
        type: 'select',
        required: true,
        span: 3,
        options: opts(['padsplit', 'PadSplit (monthly CSV)'], ['direct', 'Direct (bank deposits)']),
        help: 'Decides which reconciliation identity applies (§5).',
      },
      {
        name: 'unitStructure',
        label: 'Unit structure',
        type: 'select',
        required: true,
        span: 3,
        options: opts(['rooms', 'Rooms'], ['units', 'Units']),
        help: 'Decides how occupancy is computed and how revenue attributes below property level.',
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        span: 3,
        options: opts(
          ['acquiring', 'Acquiring'],
          ['ramping', 'Ramping'],
          ['stabilized', 'Stabilized'],
          ['divesting', 'Divesting'],
          ['sold', 'Sold'],
        ),
        defaultValue: 'stabilized',
      },
      { name: 'roomCount', label: 'Rooms', type: 'number', span: 1, placeholder: '8' },
      { name: 'unitCount', label: 'Units', type: 'number', span: 2, placeholder: '2' },
      { name: 'acquiredOn', label: 'Acquired', type: 'date', span: 3 },
      { name: 'disposedOn', label: 'Disposed', type: 'date', span: 3 },
      {
        name: 'dataVerified',
        label: 'Details verified',
        type: 'checkbox',
        span: 6,
        help: 'The property table in the spec is carried from an earlier build document and is not yet verified. Confirm the address, room count and status before this counts as fact.',
      },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 12 },
    ],
  },

  ownershipInterest: {
    key: 'ownershipInterest',
    label: 'Ownership interest',
    plural: 'Ownership',
    dynamicOptions: ['ownerId', 'propertyId', 'ownedEntityId'],
    fields: [
      { name: 'ownerId', label: 'Owner', type: 'select', required: true, span: 4, options: [] },
      {
        name: 'ownedType',
        label: 'Owns a',
        type: 'select',
        required: true,
        span: 2,
        options: opts(['property', 'Property'], ['entity', 'Entity']),
        defaultValue: 'property',
      },
      { name: 'propertyId', label: 'Property', type: 'select', span: 3, options: [], emptyLabel: '—' },
      { name: 'ownedEntityId', label: 'Entity', type: 'select', span: 3, options: [], emptyLabel: '—' },
      {
        name: 'percent',
        label: 'Percent',
        type: 'percent',
        required: true,
        span: 3,
        placeholder: '50',
        help: 'Whole numbers: 50 means 50%.',
      },
      {
        name: 'distributionPercent',
        label: 'Distribution %',
        type: 'percent',
        span: 3,
        placeholder: '70',
        help: 'Only where cash splits differently from equity. Leave empty and cash follows equity.',
      },
      { name: 'startDate', label: 'Start', type: 'date', required: true, span: 3 },
      {
        name: 'endDate',
        label: 'End',
        type: 'date',
        span: 3,
        help: 'A partner buying in or out is a new record, not an edit — dating every interest keeps history intact.',
      },
      {
        name: 'basis',
        label: 'Basis',
        type: 'select',
        required: true,
        span: 4,
        options: opts(['equity', 'Equity'], ['distribution', 'Distribution override']),
        defaultValue: 'equity',
      },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 8 },
    ],
  },

  managementPeriod: {
    key: 'managementPeriod',
    label: 'Management period',
    plural: 'Management periods',
    dynamicOptions: ['propertyId'],
    fields: [
      { name: 'propertyId', label: 'Property', type: 'select', required: true, span: 4, options: [] },
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        required: true,
        span: 2,
        options: opts(['self', 'Self-managed'], ['pm', 'PM-managed']),
        defaultValue: 'self',
      },
      { name: 'startDate', label: 'Start', type: 'date', required: true, span: 3 },
      {
        name: 'endDate',
        label: 'End',
        type: 'date',
        span: 3,
        help: 'Inclusive. Leave empty for the arrangement in force now.',
      },
      { name: 'managerName', label: 'Manager', type: 'text', span: 4, placeholder: 'Third-party PM' },
      {
        name: 'feePercent',
        label: 'Fee %',
        type: 'percent',
        span: 2,
        placeholder: '10.5',
        help: 'The current arrangement is 10.5%.',
      },
      {
        name: 'feeBasis',
        label: 'Fee basis',
        type: 'select',
        span: 3,
        emptyLabel: '—',
        options: opts(
          ['gross_collected', 'Gross collected'],
          ['host_earnings', 'Host earnings'],
          ['net_billed', 'Net billed'],
        ),
        help: 'Collected, not billed: delinquency reduces the fee and a catch-up month inflates it (§9).',
      },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 12 },
    ],
  },

  bankAccount: {
    key: 'bankAccount',
    label: 'Bank account',
    plural: 'Accounts',
    dynamicOptions: ['propertyId'],
    fields: [
      {
        name: 'propertyId',
        label: 'Property',
        type: 'select',
        required: true,
        span: 4,
        options: [],
        help: 'Each property has its own account. Everything for that property moves in and out through it (§1).',
      },
      { name: 'label', label: 'Label', type: 'text', required: true, span: 4, placeholder: 'Operating' },
      { name: 'institution', label: 'Institution', type: 'text', span: 2, placeholder: 'Chase' },
      { name: 'last4', label: 'Last 4', type: 'text', span: 1, placeholder: '4412' },
      { name: 'active', label: 'Active', type: 'checkbox', span: 1, defaultValue: true },
    ],
  },

  loan: {
    key: 'loan',
    label: 'Loan',
    plural: 'Loans',
    dynamicOptions: ['propertyId'],
    fields: [
      { name: 'propertyId', label: 'Property', type: 'select', required: true, span: 4, options: [] },
      { name: 'lender', label: 'Lender', type: 'text', required: true, span: 4, placeholder: 'Community Bank' },
      {
        name: 'type',
        label: 'Type',
        type: 'select',
        required: true,
        span: 2,
        options: opts(
          ['mortgage', 'Mortgage'],
          ['pml', 'Private money'],
          ['heloc', 'HELOC'],
          ['seller_financed', 'Seller-financed'],
          ['other', 'Other'],
        ),
      },
      {
        name: 'lienPosition',
        label: 'Lien position',
        type: 'number',
        span: 2,
        placeholder: '1',
        help: 'Where this note stands in line if the property is sold: 1 is the first lien (usually the main mortgage), 2 sits behind it (a HELOC or seller note). Leave empty if you are not sure.',
      },
      {
        name: 'originalPrincipalCents',
        label: 'Original principal',
        type: 'money',
        required: true,
        span: 3,
        placeholder: '250,000.00',
        help: 'The amount borrowed, not the balance today — the schedule works the balance out.',
      },
      {
        name: 'ratePercent',
        label: 'Rate %',
        type: 'percent',
        required: true,
        span: 2,
        placeholder: '7.25',
        help: 'Annual rate. 7.25, not 0.0725.',
      },
      {
        name: 'structure',
        label: 'Structure',
        type: 'select',
        required: true,
        span: 4,
        options: opts(
          ['fully_amortizing', 'Fully amortizing'],
          ['interest_only', 'Interest-only'],
          ['interest_only_balloon', 'Interest-only with balloon'],
          ['custom', 'Custom'],
        ),
      },
      {
        name: 'paymentFrequency',
        label: 'Paid',
        type: 'select',
        required: true,
        span: 2,
        options: opts(
          ['monthly', 'Monthly'],
          ['quarterly', 'Quarterly'],
          ['semiannual', 'Every 6 months'],
          ['annual', 'Annually'],
        ),
        defaultValue: 'monthly',
        help: 'Private notes are often quarterly. This decides which months the payment shows up in Payouts.',
      },
      {
        name: 'paymentAmountCents',
        label: 'Payment',
        type: 'money',
        span: 3,
        placeholder: '1,137.72',
        help: 'Derived for a fully amortizing loan when left empty. Required for a custom structure.',
      },
      { name: 'startDate', label: 'Start', type: 'date', required: true, span: 3 },
      { name: 'firstPaymentDate', label: 'First payment', type: 'date', required: true, span: 3 },
      {
        name: 'termMonths',
        label: 'Term (months)',
        type: 'number',
        span: 3,
        placeholder: '360',
        help: '360 is 30 years, 24 a two-year note. Either this or a maturity date — not both needed.',
      },
      { name: 'maturityDate', label: 'Maturity', type: 'date', span: 3 },
      {
        name: 'balloonAmountCents',
        label: 'Balloon',
        type: 'money',
        span: 3,
        placeholder: '250,000.00',
        help: 'Leave empty and it is whatever is still outstanding at maturity.',
      },
      { name: 'paymentDayOfMonth', label: 'Payment day', type: 'number', span: 2, placeholder: '1' },
      { name: 'escrowIncluded', label: 'Escrow included', type: 'checkbox', span: 3 },
      { name: 'escrowCents', label: 'Escrow', type: 'money', span: 2, placeholder: '250.00' },
      {
        name: 'personallyGuaranteed',
        label: 'Personally guaranteed',
        type: 'checkbox',
        span: 4,
        help: 'A guarantee does not pro-rate. Where this is set, the ladder shows the whole balance as exposure alongside your pro-rata share (§3).',
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        span: 3,
        options: opts(['active', 'Active'], ['paid_off', 'Paid off'], ['refinanced', 'Refinanced']),
        defaultValue: 'active',
      },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 12 },
    ],
  },

  loanPayment: {
    key: 'loanPayment',
    label: 'Loan payment',
    plural: 'Payments',
    dynamicOptions: ['loanId'],
    fields: [
      { name: 'loanId', label: 'Loan', type: 'select', required: true, span: 4, options: [] },
      { name: 'date', label: 'Date', type: 'date', required: true, span: 2 },
      { name: 'totalCents', label: 'Total', type: 'money', required: true, span: 2 },
      { name: 'principalCents', label: 'Principal', type: 'money', required: true, span: 2 },
      { name: 'interestCents', label: 'Interest', type: 'money', required: true, span: 2 },
      { name: 'escrowCents', label: 'Escrow', type: 'money', span: 2, placeholder: '250.00' },
      { name: 'extraPrincipalCents', label: 'Extra principal', type: 'money', span: 2 },
      {
        name: 'source',
        label: 'Source',
        type: 'select',
        required: true,
        span: 2,
        options: opts(['actual', 'Actual'], ['scheduled', 'Scheduled']),
        defaultValue: 'actual',
      },
    ],
  },

  lease: {
    key: 'lease',
    label: 'Lease',
    plural: 'Leases',
    dynamicOptions: ['propertyId', 'unitId'],
    fields: [
      {
        name: 'propertyId',
        label: 'Property',
        type: 'select',
        required: true,
        span: 4,
        options: [],
        help: 'Direct properties: a lease makes expected-vs-received computable, giving the same vacancy and collection figures the coliving houses get (§7).',
      },
      { name: 'unitId', label: 'Unit', type: 'select', span: 3, options: [], emptyLabel: '—' },
      { name: 'tenantName', label: 'Tenant', type: 'text', required: true, span: 5, placeholder: 'Unit A tenant' },
      { name: 'rentCents', label: 'Rent', type: 'money', required: true, span: 3, placeholder: '1,850.00' },
      { name: 'startDate', label: 'Start', type: 'date', required: true, span: 3 },
      { name: 'endDate', label: 'End', type: 'date', span: 3 },
      { name: 'depositHeldCents', label: 'Deposit held', type: 'money', span: 3, placeholder: '1,850.00', help: 'A liability, never income.' },
      { name: 'utilitiesIncluded', label: 'Utilities included', type: 'checkbox', span: 4 },
      { name: 'notes', label: 'Notes', type: 'textarea', span: 8 },
    ],
  },

  payeeRule: {
    key: 'payeeRule',
    label: 'Payee rule',
    plural: 'Payee rules',
    dynamicOptions: ['bankAccountId'],
    fields: [
      {
        name: 'bankAccountId',
        label: 'Account',
        type: 'select',
        span: 4,
        options: [],
        emptyLabel: 'All accounts',
      },
      {
        name: 'match',
        label: 'Description contains',
        type: 'text',
        required: true,
        span: 4,
        placeholder: 'GEORGIA POWER',
        help: 'Case-insensitive substring. Most specific match wins.',
      },
      {
        name: 'categoryKey',
        label: 'Category',
        type: 'select',
        required: true,
        span: 3,
        options: CATEGORIES.map((c) => ({ value: c.key, label: c.label })),
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'number',
        span: 1,
        placeholder: '0',
        help: 'Higher wins where two rules match. Leave at 0 unless one rule needs to beat another.',
      },
    ],
  },

  capitalAccountEntry: {
    key: 'capitalAccountEntry',
    label: 'Capital account entry',
    plural: 'Capital accounts',
    dynamicOptions: ['entityId', 'propertyId'],
    fields: [
      { name: 'entityId', label: 'Owner', type: 'select', required: true, span: 4, options: [] },
      { name: 'propertyId', label: 'Property', type: 'select', span: 4, options: [], emptyLabel: 'Portfolio-wide' },
      {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        required: true,
        span: 2,
        options: opts(['contribution', 'Contribution'], ['distribution', 'Distribution']),
        defaultValue: 'contribution',
      },
      { name: 'date', label: 'Date', type: 'date', required: true, span: 2 },
      { name: 'amountCents', label: 'Amount', type: 'money', required: true, span: 3, placeholder: '5,000.00' },
      {
        name: 'memo',
        label: 'Memo',
        type: 'text',
        span: 9,
        help: 'Ownership percent records who owns; it says nothing about who funded (§3).',
      },
    ],
  },
};
