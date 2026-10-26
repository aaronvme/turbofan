// Statistics for the benchmarks. Percentiles use linear interpolation between the closest
// ranks (Hyndman-Fan type 7, numpy's default), so p50 of an even-length sample is the mean of
// the two middle values.

export interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

function sortedCopy(xs: readonly number[]): number[] {
  if (xs.length === 0) throw new Error('statistics of an empty sample');
  for (const x of xs) if (!Number.isFinite(x)) throw new Error(`non-finite sample ${x}`);
  return [...xs].sort((a, b) => a - b);
}

function quantileSorted(sorted: readonly number[], q: number): number {
  if (!(q >= 0 && q <= 1)) throw new Error(`q must be in [0, 1], got ${q}`);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? Number.NaN;
  const b = sorted[hi] ?? Number.NaN;
  return a + (b - a) * (pos - lo);
}

export function quantile(xs: readonly number[], q: number): number {
  return quantileSorted(sortedCopy(xs), q);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

export function summarize(xs: readonly number[]): Summary {
  const s = sortedCopy(xs);
  let sum = 0;
  for (const x of s) sum += x;
  return {
    n: s.length,
    mean: sum / s.length,
    min: s[0] ?? Number.NaN,
    max: s[s.length - 1] ?? Number.NaN,
    p50: quantileSorted(s, 0.5),
    p95: quantileSorted(s, 0.95),
    p99: quantileSorted(s, 0.99),
  };
}

/** D0-1 reports the median of the per-run values; an odd count makes it one measured run. */
export function medianOfRuns(perRun: readonly number[]): number {
  if (perRun.length % 2 === 0) throw new Error('median of runs needs an odd number of runs');
  return median(perRun);
}
