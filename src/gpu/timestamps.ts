// Timestamp-query helpers. Raw values are GPU ticks converted to ns by the implementation.
//
// Measured (docs/GPU_FACTS.md): Dawn rounds every timestamp down to a multiple of 2^16 ns
// (65.536 us) unless its `timestamp_quantization` toggle is off. A pass shorter than the
// quantum can therefore read as 0 ns, and single short durations are only good to about
// +-66 us; time whole frames' worth of work, or average many samples.

export const DAWN_TIMESTAMP_QUANTUM_NS = 65536n;

/**
 * No single pass can take longer than the Windows GPU timeout (TDR, 2 s by default): the
 * device would be reset. Longer "durations" are bad samples; measured: the first timestamp
 * written on a fresh Dawn/D3D12 device can be ~200 s stale.
 */
export const MAX_PASS_MS = 2000;

/** One (begin, end) pair in ms, or NaN if it ran backwards, was never written or is too long. */
export function pairDurationMs(begin: bigint, end: bigint): number {
  if ((begin === 0n && end === 0n) || end < begin) return Number.NaN;
  const ms = Number(end - begin) / 1e6;
  return ms > MAX_PASS_MS ? Number.NaN : ms;
}

/**
 * Durations in ms from flattened (begin, end) pairs, keeping only the valid ones
 * (see pairDurationMs) rather than reporting nonsense.
 */
export function pairDurationsMs(raw: ArrayLike<bigint>): number[] {
  if (raw.length % 2 !== 0) throw new Error('timestamps must come in (begin, end) pairs');
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const ms = pairDurationMs(raw[i] ?? 0n, raw[i + 1] ?? 0n);
    if (!Number.isNaN(ms)) out.push(ms);
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
