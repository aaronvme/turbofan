// Timestamp-query helpers. Raw values are GPU ticks converted to ns by the implementation.
//
// Measured (docs/GPU_FACTS.md): Dawn rounds every timestamp down to a multiple of 2^16 ns
// (65.536 us) unless its `timestamp_quantization` toggle is off. A pass shorter than the
// quantum can therefore read as 0 ns, and single short durations are only good to about
// +-66 us; time whole frames' worth of work, or average many samples.

export const DAWN_TIMESTAMP_QUANTUM_NS = 65536n;

/**
 * Durations in ms from flattened (begin, end) pairs. A pair that runs backwards or was never
 * written (both 0) is dropped rather than reported as a duration.
 */
export function pairDurationsMs(raw: ArrayLike<bigint>): number[] {
  if (raw.length % 2 !== 0) throw new Error('timestamps must come in (begin, end) pairs');
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const begin = raw[i] ?? 0n;
    const end = raw[i + 1] ?? 0n;
    if (begin === 0n && end === 0n) continue;
    if (end < begin) continue;
    out.push(Number(end - begin) / 1e6);
  }
  return out;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/**
 * The greatest common divisor of the non-zero timestamps: the quantization
 * step, or 1n for unquantized values. Null if no non-zero value is given.
 */
export function detectQuantumNs(values: readonly bigint[]): bigint | null {
  let g = 0n;
  for (const v of values) if (v !== 0n) g = gcd(g, v);
  return g === 0n ? null : g;
}
