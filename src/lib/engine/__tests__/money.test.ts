import { describe, expect, it } from 'vitest';
import { parseDollars, splitPieceCents } from '../money';

describe('typed dollars', () => {
  it('reads the shapes a person actually types', () => {
    expect(parseDollars('1,234.50')).toBe(123450);
    expect(parseDollars('$99')).toBe(9900);
    expect(parseDollars(' 12.3 ')).toBe(1230);
    expect(parseDollars('-40')).toBe(-4000);
  });

  it('refuses what is not a number rather than guessing zero', () => {
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('-')).toBeNull();
    expect(parseDollars('twelve')).toBeNull();
    expect(parseDollars('1.2.3')).toBeNull();
  });
});

describe('a piece of a split', () => {
  it('goes out when the charge went out, whatever was typed', () => {
    // Splitting a $312.99 debit: the amounts read 200.00 and 112.99 on screen.
    expect(splitPieceCents('200.00', -31299)).toBe(-20000);
    expect(splitPieceCents('112.99', -31299)).toBe(-11299);
    expect(splitPieceCents('200.00', -31299)! + splitPieceCents('112.99', -31299)!).toBe(-31299);
  });

  it('comes in when the charge came in', () => {
    expect(splitPieceCents('50', 10000)).toBe(5000);
  });

  it('ignores a sign typed against the charge, which is not the typist to set', () => {
    expect(splitPieceCents('-200', -31299)).toBe(-20000);
    expect(splitPieceCents('-50', 10000)).toBe(5000);
  });

  it('passes an unreadable amount straight through as null', () => {
    expect(splitPieceCents('', -31299)).toBeNull();
  });
});
