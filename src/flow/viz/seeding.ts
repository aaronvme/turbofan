// GPU particle support (w2/flowviz round 2), pure and mirrored line for line by the WGSL kernel
// (src/flow/viz/particleKernel.ts), so tests/gpu/flowParticles.test.ts can compare the GPU's
// steps and respawns with these exactly:
// - the random numbers: the 32-bit PCG hash, its top 24 bits as a float (exact in f32);
// - the seed zones from the definition's flowpath;
// - time dilation, the streak length and the fades.

import type { FieldExtent } from '../../contracts/flow';
import type { EngineDefinition, Polyline } from '../../contracts/engine';
import type { SeedZone } from './particles';

/**
 * The PCG-RXS-M-XS 32-bit hash ("pcg_hash", Jarzynski & Olano, Hash Functions for GPU
 * Rendering, JCGT 9(3), 2020): the best quality-per-cost hash of their survey.
 */
export function pcgHash(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** A stream of floats in [0, 1): each the top 24 bits of the next hash (exact in f32). */
export function hashRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = pcgHash(s);
    return (s >>> 8) / 16777216;
  };
}

/** The seed of particle `index`'s respawn in frame `frame` (distinct over both). */
export function respawnSeed(index: number, frame: number): number {
  return pcgHash((Math.imul(index >>> 0, 0x9e3779b9) ^ pcgHash(frame >>> 0)) >>> 0);
}

const radiusAt = (curve: Polyline, x: number): number => {
  const p = curve.points;
  const first = p[0];
  const last = p.at(-1);
  if (first === undefined || last === undefined) throw new Error('flowSeedZones: empty curve');
  if (x <= first.x) return first.r;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    if (a === undefined || b === undefined) break;
    if (x <= b.x) return a.r + ((b.r - a.r) * (x - a.x)) / Math.max(b.x - a.x, 1e-12);
  }
  return last.r;
};

/**
 * Where particles are born, from the flowpath: an intake slab upstream of the highlight (inside
 * 0.9 of its radius, where the capture streamtube is), and the entries of the bypass duct and of
 * the core (the booster), each 5 % in from its walls. Air from the intake slab reaches both
 * ducts by itself; the duct zones keep them filled within a particle's life. Weights: the share
 * of births (a visual density choice, not a mass-flow split).
 */
export function flowSeedZones(def: EngineDefinition): SeedZone[] {
  const fp = def.flowpath;
  const hl = fp.curves.nacelleInner.points[0];
  if (hl === undefined) throw new Error('flowSeedZones: no nacelle highlight');
  const zones: SeedZone[] = [
    { id: 'intake', weight: 0.5, x0: hl.x - 0.9, x1: hl.x - 0.25, r0: 0, r1: 0.9 * hl.r },
  ];
  for (const [id, comp, weight, depth] of [
    ['bypass', 'bypassDuct', 0.32, 0.12],
    ['core', 'booster', 0.18, 0.06],
  ] as const) {
    const c = fp.components.find((k) => k.id === comp);
    if (c === undefined) throw new Error(`flowSeedZones: no ${comp}`);
    const hub = radiusAt(fp.curves[c.hub], c.xStart);
    const casing = radiusAt(fp.curves[c.casing], c.xStart);
    const m = 0.05 * (casing - hub);
    zones.push({ id, weight, x0: c.xStart, x1: c.xStart + depth, r0: hub + m, r1: casing - m });
  }
  return zones;
}

/** A frame longer than this (a tab switch, a hitch) advances the particles by this much. */
export const MAX_FRAME_S = 0.1;

/** The simulated seconds the particles advance in a frame of `frameS` wall seconds. */
export function visualDtS(frameS: number, dilation: number): number {
  return Math.min(frameS, MAX_FRAME_S) * dilation;
}

/** A streak is the path over `streakS` wall seconds at the dilated speed, m. */
export function streakLengthM(speedMPerS: number, dilation: number, streakS: number): number {
  return speedMPerS * dilation * streakS;
}

const smooth = (e0: number, e1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Below this speed a particle is invisible (still air shows nothing), m/s. */
export const SPEED_FADE = [5, 40] as const;

export function speedFade(speedMPerS: number): number {
  return smooth(SPEED_FADE[0], SPEED_FADE[1], speedMPerS);
}

/** Particles fade over this distance before the field's downstream and outer edges, m. */
export const EDGE_FADE_M = 0.3;

/** `particleAlpha`'s edge argument: the distance to the field's x or r end over EDGE_FADE_M. */
export function edgeFactor(x: number, r: number, e: FieldExtent): number {
  return Math.min(1, Math.max(0, Math.min(e.xMax - x, e.rMax - r) / EDGE_FADE_M));
}
