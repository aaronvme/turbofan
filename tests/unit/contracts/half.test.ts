import { describe, expect, it } from 'vitest';
import { HALF_MAX, fromHalfBits, toHalfBits } from '../../../src/contracts/half';

describe('IEEE 754 binary16 conversion (rgba16float texels)', () => {
  it.each([
    [0, 0x0000],
    [1, 0x3c00],
    [-2, 0xc000],
    [0.5, 0x3800],
    [65504, 0x7bff],
    [2 ** -14, 0x0400], // smallest normal
    [2 ** -24, 0x0001], // smallest subnormal
    [2 ** -24 * 1023, 0x03ff], // largest subnormal
    [Infinity, 0x7c00],
    [-Infinity, 0xfc00],
  ])('encodes %f as 0x%s', (value, bits) => {
    expect(toHalfBits(value)).toBe(bits);
  });

  it('keeps the sign of negative zero', () => {
    expect(toHalfBits(-0)).toBe(0x8000);
    expect(Object.is(fromHalfBits(0x8000), -0)).toBe(true);
  });

  it('encodes NaN as a quiet NaN and decodes it back to NaN', () => {
    expect(toHalfBits(Number.NaN)).toBe(0x7e00);
    expect(Number.isNaN(fromHalfBits(0x7e00))).toBe(true);
  });

  it('overflows to infinity at the round-to-even boundary', () => {
    expect(toHalfBits(65519.99)).toBe(0x7bff);
    expect(toHalfBits(65520)).toBe(0x7c00);
    expect(toHalfBits(1e9)).toBe(0x7c00);
    expect(HALF_MAX).toBe(65504);
  });

  it('rounds ties to even', () => {
    // 1 + 2^-11 is exactly halfway between 1 and 1 + 2^-10: rounds to 1 (even mantissa)
    expect(toHalfBits(1 + 2 ** -11)).toBe(0x3c00);
    // 1 + 3 * 2^-11 is halfway between mantissa 1 and 2: rounds to 2
    expect(toHalfBits(1 + 3 * 2 ** -11)).toBe(0x3c02);
    // subnormal tie: 0.5 * 2^-24 rounds to zero, 1.5 * 2^-24 rounds to 2 * 2^-24
    expect(toHalfBits(0.5 * 2 ** -24)).toBe(0x0000);
    expect(toHalfBits(1.5 * 2 ** -24)).toBe(0x0002);
  });

  it('rounds the largest subnormal up into the normal range', () => {
    expect(toHalfBits(2 ** -14 - 2 ** -26)).toBe(0x0400);
  });

  it('round-trips every one of the 65536 bit patterns that is not NaN', () => {
    for (let bits = 0; bits < 0x10000; bits++) {
      const value = fromHalfBits(bits);
      if (Number.isNaN(value)) continue;
      expect(toHalfBits(value)).toBe(bits);
    }
  });

  it('matches Math.f16round where the runtime provides it', () => {
    const f16round = (Math as unknown as { f16round?: (x: number) => number }).f16round;
    if (f16round === undefined) return;
    // deterministic sweep: a fixed LCG, no Math.random
    let seed = 12345;
    for (let k = 0; k < 20000; k++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const value = (seed / 2147483648 - 0.5) * 2 ** ((k % 40) - 20);
      expect(fromHalfBits(toHalfBits(value))).toBe(f16round(value));
    }
  });
});
