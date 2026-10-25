// IEEE 754 binary16 ("half") conversion for rgba16float texel data written from the CPU
// (mocks, tests, CPU reference resampling). Rounds to nearest, ties to even, straight from
// the float64 value (no float32 intermediate, so no double rounding).

/** Largest finite half value. */
export const HALF_MAX = 65504;

const SUBNORMAL_ULP = 2 ** -24;
const MIN_NORMAL = 2 ** -14;
/** Halfway between HALF_MAX and 2^16: ties round to the even neighbour, which is infinity. */
const OVERFLOW_THRESHOLD = 65520;

function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function toHalfBits(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const a = Math.abs(value);
  if (a >= OVERFLOW_THRESHOLD) return sign | 0x7c00;
  if (a < MIN_NORMAL) {
    // subnormal: a = m * 2^-24; m = 1024 rolls over into the smallest normal (0x0400)
    return sign | roundHalfEven(a / SUBNORMAL_ULP);
  }
  let e = Math.floor(Math.log2(a));
  // Math.log2 can be off by one ulp near powers of two
  if (2 ** e > a) e -= 1;
  else if (2 ** (e + 1) <= a) e += 1;
  let m = roundHalfEven((a / 2 ** e - 1) * 1024);
  if (m === 1024) {
    m = 0;
    e += 1;
  }
  return sign | ((e + 15) << 10) | m;
}

export function fromHalfBits(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * SUBNORMAL_ULP;
  if (exp === 0x1f) return mant === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}
