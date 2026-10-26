// Run order for a benchmark sweep (W0G-I2). With a fixed order the per-grid tile ranking in the
// official run followed run order at all three sizes (later = slower: clocks and heat drift),
// so a ranking could not be told apart from position. Here each repetition runs every
// configuration once; configurations that are compared with each other (a group: the tiles of
// one grid, main vs worker at one load) stay together so they run close in time, and the order
// rotates between repetitions: within a group of as many members as repetitions, each member
// takes each position once (a Latin square), and the groups rotate the same way. A seeded
// shuffle picks the base order, and the harness records the seed and the orders.

import { median } from './stats.ts';

/** mulberry32: a small, well-known 32-bit generator; deterministic per seed, in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function rotated<T>(xs: readonly T[], by: number): T[] {
  const k = xs.length === 0 ? 0 : by % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
}

export interface Orderable {
  readonly id: string;
  /** Configurations compared with each other share a group. */
  readonly group: string;
}

/** The configuration ids to run in each of `repetitions` repetitions. */
export function sweepOrder(
  items: readonly Orderable[],
  repetitions: number,
  seed: number,
): string[][] {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error(`repetitions must be a positive integer, got ${repetitions}`);
  }
  const ids = new Set<string>();
  const groups = new Map<string, string[]>();
  for (const { id, group } of items) {
    if (ids.has(id)) throw new Error(`duplicate configuration id ${id}`);
    ids.add(id);
    groups.set(group, [...(groups.get(group) ?? []), id]);
  }
  const rand = mulberry32(seed);
  const base = shuffled([...groups.values()], rand).map((members) => shuffled(members, rand));
  return Array.from({ length: repetitions }, (_, r) =>
    rotated(base, r).flatMap((members) => rotated(members, r)),
  );
}

export interface OrderSample {
  readonly id: string;
  /** Position in the whole sweep (0 = first run). */
  readonly seq: number;
  readonly value: number;
}

export interface OrderEffect {
  /** Relative change of the value per sweep position (0.01 = +1 % per slot). */
  readonly slopePerSlot: number;
  /** slopePerSlot over the sweep's span: the drift from its first to its last run. */
  readonly overSweep: number;
  readonly n: number;
}

/**
 * The drift of a metric (e.g. ms/it) with sweep position. Each value is divided by its
 * configuration's median, then a least-squares slope is fitted within configurations (each
 * centred on its own mean), so configurations of different cost do not create a slope.
 */
export function orderEffect(samples: readonly OrderSample[]): OrderEffect | null {
  const byId = new Map<string, OrderSample[]>();
  for (const s of samples) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
  let sxy = 0;
  let sxx = 0;
  for (const group of byId.values()) {
    const med = median(group.map((s) => s.value));
    const xs = group.map((s) => s.seq);
    const ys = group.map((s) => s.value / med);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    xs.forEach((x, i) => {
      sxy += (x - mx) * ((ys[i] ?? my) - my);
      sxx += (x - mx) ** 2;
    });
  }
  if (sxx === 0) return null;
  const seqs = samples.map((s) => s.seq);
  const slopePerSlot = sxy / sxx;
  return {
    slopePerSlot,
    overSweep: slopePerSlot * (Math.max(...seqs) - Math.min(...seqs)),
    n: samples.length,
  };
}
