// Algebraic building helpers for the multi-block mesher: node access, straight and curved node
// rows, distributions by end spacing, column-wise blocks, re-spacing, and duct wall rows cut by a
// smoothed mean-line normal. Engine-independent; tools/mesh/engineMesh.ts composes them.
import { Polyline } from './curve';
import { bySpacing, geometric, vinokur } from './distribution';
import { nodeIndex, type Block, type Pt } from './types';

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.r - b.r);
export const smoothstep = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function nodeAt(b: Block, i: number, j: number): Pt {
  const k = nodeIndex(b, i, j);
  return { x: b.x[k] ?? NaN, r: b.r[k] ?? NaN };
}

export function setNode(b: Block, i: number, j: number, p: Pt): void {
  const k = nodeIndex(b, i, j);
  b.x[k] = p.x;
  b.r[k] = p.r;
}

export function rowNodes(b: Block, j: number): Pt[] {
  return Array.from({ length: b.ni + 1 }, (_, i) => nodeAt(b, i, j));
}

export function colNodes(b: Block, i: number): Pt[] {
  return Array.from({ length: b.nj + 1 }, (_, j) => nodeAt(b, i, j));
}

/**
 * Straight line from a to b at fractions t. End points are exact (bitwise), and so is a coordinate
 * the two ends share: a radial line stays exactly on its station plane.
 */
export function segment(a: Pt, b: Pt, t: ArrayLike<number>): Pt[] {
  const n = t.length - 1;
  const lerp = (p: number, q: number, u: number): number => (p === q ? p : p * (1 - u) + q * u);
  return Array.from(t, (u, k) =>
    k === 0 ? a : k === n ? b : { x: lerp(a.x, b.x, u), r: lerp(a.r, b.r, u) },
  );
}

/** Straight radial line at x from r0 to r1 at fractions t (end points exact). */
export function radialLine(x: number, r0: number, r1: number, t: ArrayLike<number>): Pt[] {
  return segment({ x, r: r0 }, { x, r: r1 }, t);
}

/** Nodes along a polyline at fractions of its arc length (end points exact). */
export function alongCurve(c: Polyline, t: ArrayLike<number>): Pt[] {
  const n = t.length - 1;
  const first = c.points[0] as Pt;
  const last = c.points[c.points.length - 1] as Pt;
  return Array.from(t, (u, k) => (k === 0 ? first : k === n ? last : c.at(u * c.length)));
}

/** Fractions with a geometric progression whose LAST spacing is dsLast. */
export function geometricToEnd(n: number, dsLast: number): Float64Array {
  const g = geometric(n, dsLast);
  const t = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) t[k] = 1 - (g[n - k] ?? 0);
  t[0] = 0;
  t[n] = 1;
  return t;
}

/**
 * Two-sided distribution of n cells over length L with end spacings h0 and h1 (metres). Requests
 * that a two-sided tanh/tan cannot honour smoothly are pulled towards the mean spacing first.
 */
export function twoSided(n: number, L: number, h0: number, h1: number): Float64Array {
  const mean = L / n;
  const a = clamp(h0, 0.25 * mean, 1.9 * mean);
  const b = clamp(h1, 0.25 * mean, 1.9 * mean);
  return vinokur(n, a / L, b / L);
}

/** Two-sided distribution with last spacing h1 and a first spacing balancing the mean. */
export function towardsEnd(n: number, L: number, h1: number): Float64Array {
  const mean = L / n;
  return twoSided(n, L, clamp(2 * mean - h1, 0.5 * mean, 2 * mean), h1);
}

/** Cell count of a spacing function over [0, L] (continuous, for budgeting). */
export function cellCount(L: number, h: (s: number) => number): number {
  const M = 2000;
  let sum = 0;
  for (let m = 0; m < M; m++) sum += L / M / h(((m + 0.5) * L) / M);
  return sum;
}

/** Spacing of consecutive nodes. */
export function spacings(nodes: readonly Pt[]): number[] {
  return nodes.slice(1).map((p, k) => dist(nodes[k] as Pt, p));
}

/** Re-sample the interior nodes of column i (j = 1..nj-1) along the column at fractions t. */
export function respaceColumn(b: Block, i: number, t: ArrayLike<number>): void {
  const line = new Polyline(colNodes(b, i));
  for (let j = 1; j < b.nj; j++) setNode(b, i, j, line.at((t[j] ?? 0) * line.length));
}

/** Block from columns (i index) of nj + 1 nodes each. */
export function columnBlock(name: string, columns: readonly (readonly Pt[])[]): Block {
  const ni = columns.length - 1;
  const nj = (columns[0]?.length ?? 0) - 1;
  const b: Block = {
    name,
    ni,
    nj,
    x: new Float64Array((ni + 1) * (nj + 1)),
    r: new Float64Array((ni + 1) * (nj + 1)),
  };
  columns.forEach((col, i) => {
    if (col.length !== nj + 1) throw new Error(`${name}: column ${i} has the wrong node count`);
    col.forEach((p, j) => {
      setNode(b, i, j, p);
    });
  });
  return b;
}

/** Repeated [1 2 1] / 4 smoothing of a sequence in log space, end values held. */
export function smoothLog(v: readonly number[], passes: number): number[] {
  let a = v.map((x) => Math.log(x));
  for (let p = 0; p < passes; p++) {
    a = a.map((x, k) =>
      k === 0 || k === a.length - 1 ? x : 0.25 * ((a[k - 1] ?? x) + 2 * x + (a[k + 1] ?? x)),
    );
  }
  return a.map((x) => Math.exp(x));
}

/**
 * Wall node rows of a duct between `lower` and `upper` from x0 to x1. Nodes are placed on the
 * duct's mean line by the spacing function h(x), and each node's cross-duct cut runs along the
 * mean-line normal. The normal direction is smoothed along the mean line over about one duct
 * height (the walls are C1 Hermite curves, so their curvature jumps at knots; an unsmoothed normal
 * would turn those jumps into wall-spacing jumps on the inside of bends), and it is blended to
 * radial over `blendHeights` duct heights at both ends with a C1 smoothstep, so the station planes
 * stay radial without compressing the first wall cells. This keeps the cross-duct grid lines
 * near-orthogonal through bends such as the booster-HPC gooseneck.
 */
export function ductWalls(
  lower: Polyline,
  upper: Polyline,
  x0: number,
  x1: number,
  h: (x: number) => number,
  ends: { lower0: Pt; upper0: Pt; lower1: Pt; upper1: Pt },
  blendHeights = 1.5,
): { lo: Pt[]; up: Pt[] } {
  const M = 1500;
  const height = (x: number): number => upper.atX(x).r - lower.atX(x).r;
  const pts = Array.from({ length: M + 1 }, (_, m) => {
    const x = m === M ? x1 : x0 + ((x1 - x0) * m) / M;
    return { x, r: 0.5 * (lower.atX(x).r + upper.atX(x).r) };
  });
  const mean = new Polyline(pts);
  const L = mean.length;
  const cum = mean.cum;
  // normal angle at each sample, from a central difference over a few samples
  const raw = pts.map((_, m) => {
    const a = pts[Math.max(0, m - 2)] as Pt;
    const b = pts[Math.min(M, m + 2)] as Pt;
    return Math.atan2(b.x - a.x, -(b.r - a.r));
  });
  // moving average over half a local duct height either side, three passes
  const H = pts.map((p) => height(p.x));
  let ang = raw;
  for (let pass = 0; pass < 3; pass++) {
    const prev = ang;
    let lo = 0;
    let hi = 0;
    let sum = 0;
    ang = pts.map((_, m) => {
      const s = cum[m] ?? 0;
      const w = 0.5 * (H[m] ?? 0);
      while (hi <= M && (cum[hi] ?? Infinity) <= s + w) sum += prev[hi++] ?? 0;
      while (lo < hi && (cum[lo] ?? 0) < s - w) sum -= prev[lo++] ?? 0;
      return hi > lo ? sum / (hi - lo) : (prev[m] ?? 0);
    });
  }
  const Lb0 = blendHeights * height(x0);
  const Lb1 = blendHeights * height(x1);
  const angleAt = (s: number): number => {
    const u = clamp((s / L) * M, 0, M);
    const m = Math.min(M - 1, Math.floor(u));
    // samples are near-uniform in arc length; interpolate on the sample index
    const f = u - m;
    const a = (ang[m] ?? 0) * (1 - f) + (ang[m + 1] ?? 0) * f;
    const w = smoothstep(s / Lb0) * smoothstep((L - s) / Lb1);
    return Math.PI / 2 + w * (a - Math.PI / 2);
  };
  const s = bySpacing(L, (sv) => h(mean.at(sv).x));
  const n = s.length - 1;
  const lo: Pt[] = [];
  const up: Pt[] = [];
  let lastLo = -Infinity;
  let lastUp = -Infinity;
  for (let k = 0; k <= n; k++) {
    if (k === 0 || k === n) {
      lo.push(k === 0 ? ends.lower0 : ends.lower1);
      up.push(k === 0 ? ends.upper0 : ends.upper1);
      continue;
    }
    const sk = s[k] ?? 0;
    const m = mean.at(sk);
    const a = angleAt(sk);
    const dir = { x: Math.cos(a), r: Math.sin(a) };
    const sl = lower.rayHit(m, dir);
    const su = upper.rayHit(m, dir);
    if (sl === null || su === null || !(sl > lastLo) || !(su > lastUp)) {
      throw new Error(`duct cut ${k} at x = ${m.x.toFixed(3)} does not cross both walls in order`);
    }
    lastLo = sl;
    lastUp = su;
    lo.push(lower.at(sl));
    up.push(upper.at(su));
  }
  return { lo, up };
}
