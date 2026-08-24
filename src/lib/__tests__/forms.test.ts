import { describe, expect, it } from 'vitest';
import { FieldError, parseForm, parseMoney, centsToInput, type Field } from '../forms';
import { cents } from '../engine/money';

const fields: Field[] = [
  { name: 'lender', label: 'Lender', type: 'text', required: true },
  { name: 'ratePercent', label: 'Rate %', type: 'percent', required: true },
  { name: 'termMonths', label: 'Term', type: 'number' },
  { name: 'originalPrincipalCents', label: 'Original principal', type: 'money', required: true },
  { name: 'startDate', label: 'Start', type: 'date', required: true },
  { name: 'guaranteed', label: 'Guaranteed', type: 'checkbox' },
];

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const complete = {
  lender: 'Community Bank',
  ratePercent: '7.25',
  originalPrincipalCents: '250000',
  startDate: '2026-01-01',
};

describe('what a person actually types', () => {
  it('accepts a percentage written with its sign', () => {
    expect(parseForm(fields, form({ ...complete, ratePercent: '7.25%' })).ratePercent).toBe(7.25);
  });

  it('accepts a term written with a thousands separator', () => {
    expect(parseForm(fields, form({ ...complete, termMonths: '1,200' })).termMonths).toBe(1200);
  });

  it('accepts money with a currency symbol and separators', () => {
    expect(parseMoney('$250,000.00')).toBe(cents(250_000));
    expect(parseForm(fields, form({ ...complete, originalPrincipalCents: '$250,000' })).originalPrincipalCents).toBe(
      cents(250_000),
    );
  });

  it('reads a parenthesised amount as negative, the way a statement prints it', () => {
    expect(parseMoney('(45.00)')).toBe(cents(-45));
  });

  it('renders cents back as plain dollars for an edit form', () => {
    expect(centsToInput(cents(1_137.72))).toBe('1137.72');
    expect(centsToInput(null)).toBe('');
  });
});

describe('errors point at one field', () => {
  it('names the missing required field rather than failing generically', () => {
    try {
      parseForm(fields, form({ ...complete, lender: '' }));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FieldError);
      expect((error as FieldError).field).toBe('lender');
      expect((error as FieldError).message).toBe('Lender is required');
    }
  });

  it('names the field that is not a number', () => {
    try {
      parseForm(fields, form({ ...complete, ratePercent: 'seven' }));
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as FieldError).field).toBe('ratePercent');
    }
  });

  it('names the field that is not an amount', () => {
    try {
      parseForm(fields, form({ ...complete, originalPrincipalCents: 'a lot' }));
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as FieldError).field).toBe('originalPrincipalCents');
    }
  });
});

describe('empty optional fields', () => {
  it('become null rather than empty strings, so a cleared value genuinely clears', () => {
    const parsed = parseForm(fields, form({ ...complete, termMonths: '' }));
    expect(parsed.termMonths).toBeNull();
  });

  it('treat an absent checkbox as false', () => {
    expect(parseForm(fields, form(complete)).guaranteed).toBe(false);
  });
});
