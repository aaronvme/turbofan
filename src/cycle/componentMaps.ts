// Component map lookup and scaling (pure). The tables are the ported pyCycle maps
// (src/cycle/maps, Apache-2.0, see NOTICE).
//
// Scaling follows pyCycle / NPSS practice: the engine's design point is pinned to the map's own
// design point (compressors: NcMap_des, RlineMap_des; turbines: NpMap_des, PRmap_des) with
//   Wc = s_Wc WcMap,  PR - 1 = s_PR (PRmap - 1),  eff = s_eff effMap,
// and corrected speed taken as a fraction of the engine's design corrected speed.
//
// Interpolation is a tensor product of 1-D cubic Hermite splines with three-point slopes (exact
// for quadratics, C1 everywhere), extrapolated linearly with the end slope. C1 tables keep the
// Newton matching (src/cycle/match.ts) from chattering across grid lines.
//
// Below the lowest speed line (starting, windmilling) compressors follow the similarity laws used
// for sub-idle map extension (Gaudet & Gauthier, "A Simple Sub-idle Component Map Extrapolation
// Method", ASME GT2007-27193): along an R-line, corrected flow is proportional to speed, PR - 1
// to speed squared, and the efficiency is held. Turbines below their pressure-ratio range follow
// Stodola's ellipse law (flow parameter proportional to sqrt(1 - 1/PR^2)), and below their speed
// range the efficiency falls as x (2 - x), x = N / N_min, the parabolic dependence of turbine
// efficiency on blade-speed ratio, reaching zero at standstill.

import { at } from './at';
import type { CompressorMapData, TurbineMapData } from './maps/types';

type Table = readonly (readonly number[])[];

function lowerIndex(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(xs, mid) <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

function nodeSlope(xs: readonly number[], vs: readonly number[], i: number): number {
  const n = xs.length;
  const x = (k: number): number => at(xs, k);
  const v = (k: number): number => at(vs, k);
  if (i === 0) return (v(1) - v(0)) / (x(1) - x(0));
  if (i === n - 1) return (v(n - 1) - v(n - 2)) / (x(n - 1) - x(n - 2));
  const hl = x(i) - x(i - 1);
  const hr = x(i + 1) - x(i);
  const dl = (v(i) - v(i - 1)) / hl;
  const dr = (v(i + 1) - v(i)) / hr;
  return (hl * dr + hr * dl) / (hl + hr);
}

/** 1-D cubic Hermite with three-point slopes; linear beyond the ends. */
export function hermite1(xs: readonly number[], vs: readonly number[], x: number): number {
  const n = xs.length;
  const first = at(xs, 0);
  const last = at(xs, n - 1);
  if (x <= first) return at(vs, 0) + nodeSlope(xs, vs, 0) * (x - first);
  if (x >= last) return at(vs, n - 1) + nodeSlope(xs, vs, n - 1) * (x - last);
  const i = lowerIndex(xs, x);
  const x0 = at(xs, i);
  const h = at(xs, i + 1) - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * at(vs, i) +
    (t3 - 2 * t2 + t) * h * nodeSlope(xs, vs, i) +
    (-2 * t3 + 3 * t2) * at(vs, i + 1) +
    (t3 - t2) * h * nodeSlope(xs, vs, i + 1)
  );
}

/** Tensor-product cubic Hermite on table[i][j] at (xs[i], ys[j]). */
export function hermite2(
  xs: readonly number[],
  ys: readonly number[],
  table: Table,
  x: number,
  y: number,
): number {
  // rows i-1 .. i+2 are all the x-interval [i, i+1] needs (its two node slopes)
  const xFirst = at(xs, 0);
  const xLast = at(xs, xs.length - 1);
  const i = lowerIndex(xs, Math.min(Math.max(x, xFirst), xLast));
  const from = Math.max(0, i - 1);
  const to = Math.min(xs.length - 1, i + 2);
  const sub = xs.slice(from, to + 1);
  const col = sub.map((_, k) => hermite1(ys, at(table, from + k), y));
  if (x > xFirst && x < xLast) return hermite1(sub, col, x);
  // beyond the ends: extrapolate with the end slope of the full spline (same as hermite1)
  const full = xs.map((_, k) => hermite1(ys, at(table, k), y));
  return hermite1(xs, full, x);
}

export interface CompressorDesign {
  /** W sqrt(theta) / delta at the design point, kg/s. */
  readonly correctedFlow: number;
  readonly pressureRatio: number;
  readonly efficiency: number;
}

export interface CompressorPoint {
  readonly correctedFlow: number;
  readonly pressureRatio: number;
  readonly efficiency: number;
}

export interface ScaledCompressorMap {
  readonly map: CompressorMapData;
  readonly wcScale: number;
  readonly prScale: number;
  readonly effScale: number;
}

function checkDesign(flow: number, pr: number, eff: number): void {
  if (!(flow > 0 && Number.isFinite(flow))) throw new Error(`design flow ${flow} must be > 0`);
  if (!(pr > 1 && Number.isFinite(pr))) throw new Error(`design pressure ratio ${pr} must be > 1`);
  if (!(eff > 0 && eff <= 1)) throw new Error(`design efficiency ${eff} must be in (0, 1]`);
}

const rawCompressor = (
  m: CompressorMapData,
  nc: number,
  r: number,
): { wc: number; pr: number; eff: number } => ({
  wc: hermite2(m.nc, m.rline, m.wc, nc, r),
  pr: hermite2(m.nc, m.rline, m.pr, nc, r),
  eff: hermite2(m.nc, m.rline, m.eff, nc, r),
});

/** Scalars that put the map's design point on the engine's (pure; the map is not touched). */
export function scaleCompressorMap(
  map: CompressorMapData,
  design: CompressorDesign,
): ScaledCompressorMap {
  checkDesign(design.correctedFlow, design.pressureRatio, design.efficiency);
  const raw = rawCompressor(map, map.design.nc, map.design.rline);
  return {
    map,
    wcScale: design.correctedFlow / raw.wc,
    prScale: (design.pressureRatio - 1) / (raw.pr - 1),
    effScale: design.efficiency / raw.eff,
  };
}

/** Operating point at a corrected speed (fraction of design) and R-line. */
export function compressorPoint(
  s: ScaledCompressorMap,
  speedFraction: number,
  rline: number,
): CompressorPoint {
  const m = s.map;
  const nc = Math.max(0, speedFraction) * m.design.nc;
  const nMin = at(m.nc, 0);
  const raw = rawCompressor(m, Math.max(nc, nMin), rline);
  let { wc, pr } = raw;
  const { eff } = raw;
  if (nc < nMin) {
    const ratio = nc / nMin;
    wc *= ratio;
    pr = 1 + (pr - 1) * ratio * ratio;
  }
  return {
    correctedFlow: s.wcScale * wc,
    pressureRatio: 1 + s.prScale * (pr - 1),
    efficiency: s.effScale * eff,
  };
}

/**
 * (PR_surge - PR) / PR at the same corrected flow: PR_surge is on the stall R-line, at the speed
 * whose stall-line flow equals the point's flow (bisection, 1e-12 in speed).
 */
export function surgeMargin(s: ScaledCompressorMap, p: CompressorPoint): number {
  const stall = (n: number): CompressorPoint => compressorPoint(s, n, s.map.rlineStall);
  let hi = 1;
  while (stall(hi).correctedFlow < p.correctedFlow && hi < 64) hi *= 2;
  let lo = 0;
  for (let k = 0; k < 60 && hi - lo > 1e-12; k++) {
    const mid = 0.5 * (lo + hi);
    if (stall(mid).correctedFlow < p.correctedFlow) lo = mid;
    else hi = mid;
  }
  const prSurge = stall(0.5 * (lo + hi)).pressureRatio;
  return (prSurge - p.pressureRatio) / p.pressureRatio;
}

export interface TurbineDesign {
  /** W sqrt(Tt) / Pt at the design point, SI (kg/s K^0.5 / Pa). */
  readonly flowParameter: number;
  readonly pressureRatio: number;
  readonly efficiency: number;
}

export interface TurbinePoint {
  readonly flowParameter: number;
  readonly efficiency: number;
}

export interface ScaledTurbineMap {
  readonly map: TurbineMapData;
  readonly wpScale: number;
  readonly prScale: number;
  readonly effScale: number;
}

export function scaleTurbineMap(map: TurbineMapData, design: TurbineDesign): ScaledTurbineMap {
  checkDesign(design.flowParameter, design.pressureRatio, design.efficiency);
  const { np, pr } = map.design;
  return {
    map,
    wpScale: design.flowParameter / hermite2(map.np, map.pr, map.wp, np, pr),
    prScale: (design.pressureRatio - 1) / (pr - 1),
    effScale: design.efficiency / hermite2(map.np, map.pr, map.eff, np, pr),
  };
}

const stodola = (pr: number): number => Math.sqrt(Math.max(0, 1 - 1 / (pr * pr)));

/** Operating point at a corrected speed (fraction of design) and total pressure ratio (in/out). */
export function turbinePoint(
  s: ScaledTurbineMap,
  speedFraction: number,
  pressureRatio: number,
): TurbinePoint {
  const m = s.map;
  const npMap = Math.max(0, speedFraction) * m.design.np;
  const npMin = at(m.np, 0);
  const prMinMap = at(m.pr, 0);
  const prMap = 1 + (pressureRatio - 1) / s.prScale;
  const npc = Math.max(npMap, npMin);
  const prc = Math.max(prMap, prMinMap);
  let wp = hermite2(m.np, m.pr, m.wp, npc, prc);
  let eff = hermite2(m.np, m.pr, m.eff, npc, prc);
  if (prMap < prMinMap) {
    const prEdge = 1 + s.prScale * (prMinMap - 1);
    wp *= stodola(pressureRatio) / stodola(prEdge);
  }
  if (npMap < npMin) {
    const x = npMap / npMin;
    eff *= x * (2 - x);
  }
  return { flowParameter: pressureRatio <= 1 ? 0 : s.wpScale * wp, efficiency: s.effScale * eff };
}
