// Algebraic building helpers for the multi-block mesher: node access, straight and curved node
// rows, distributions by end spacing, column-wise blocks, re-spacing, and duct wall rows cut by a
// smoothed mean-line normal. Engine-independent; tools/mesh/engineMesh.ts composes them.
import { Polyline } from './curve';
import { geometric, vinokur } from './distribution';
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
 * Monotone piecewise-cubic Hermite interpolant through (xs, ys), xs strictly increasing (Fritsch &
 * Carlson, SIAM J. Numer. Anal. 17 (1980) 238-246, with the Fritsch-Butland weighted harmonic-mean
 * slopes). C1, reproduces linear data exactly, monotone where the data are; clamped outside.
 */
export function pchip(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) throw new Error('pchip needs at least two knots');
  const X = (k: number): number => xs[k] ?? NaN;
  const Y = (k: number): number => ys[k] ?? NaN;
  const h: number[] = [];
  const d: number[] = [];
  for (let k = 0; k + 1 < n; k++) {
    const hk = X(k + 1) - X(k);
    if (!(hk > 0)) throw new Error('pchip knots must increase');
    h.push(hk);
    d.push((Y(k + 1) - Y(k)) / hk);
  }
  const m = xs.map((_, k) => {
    if (k === 0) return d[0] ?? 0;
    if (k === n - 1) return d[n - 2] ?? 0;
    const d0 = d[k - 1] ?? 0;
    const d1 = d[k] ?? 0;
    if (d0 * d1 <= 0) return 0;
    const h0 = h[k - 1] ?? 0;
    const h1 = h[k] ?? 0;
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d0 + w2 / d1);
  });
  return (x) => {
    if (x <= X(0)) return Y(0);
    if (x >= X(n - 1)) return Y(n - 1);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (X(mid) <= x) lo = mid;
      else hi = mid;
    }
    const hk = h[lo] ?? 1;
    const t = (x - X(lo)) / hk;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * Y(lo) +
      (t3 - 2 * t2 + t) * hk * (m[lo] ?? 0) +
      (-2 * t3 + 3 * t2) * Y(lo + 1) +
      (t3 - t2) * hk * (m[lo + 1] ?? 0)
    );
  };
}

/**
 * Cell counts for consecutive segments whose target counts (the integral of ds / h over each
 * segment) are g: as close to the targets as possible (least squares in log space) while the
 * spacing scale g / n changes by at most `ratio` between neighbouring segments, and no segment has
 * fewer than nMin cells. Dynamic programming over the segments; the ratio is relaxed by 5 % steps
 * until a solution exists.
 */
export function segmentCounts(
  g: readonly number[],
  nMin: readonly number[],
  ratio = 1.25,
): number[] {
  const options = g.map((gk, k) => {
    const lo = Math.max(1, nMin[k] ?? 1, Math.floor(0.5 * gk));
    const hi = Math.max(lo, Math.ceil(2 * gk) + 1);
    return Array.from({ length: hi - lo + 1 }, (_, m) => lo + m);
  });
  const cost = (k: number, n: number): number => Math.log((g[k] ?? 1) / n) ** 2;
  for (let limit = Math.log(ratio); ; limit += Math.log(1.05)) {
    // best[k][m]: least cost of segments 0..k with segment k taking options[k][m]
    const best: number[][] = [];
    const from: number[][] = [];
    options.forEach((opts, k) => {
      best.push(
        opts.map((n, m) => {
          if (k === 0) return cost(0, n);
          let b = Infinity;
          let arg = -1;
          (options[k - 1] ?? []).forEach((p, q) => {
            const prev = best[k - 1]?.[q] ?? Infinity;
            const jump = Math.abs(Math.log(((g[k] ?? 1) / n) * (p / (g[k - 1] ?? 1))));
            if (jump <= limit + 1e-12 && prev < b) {
              b = prev;
              arg = q;
            }
          });
          (from[k] ??= [])[m] = arg;
          return b + cost(k, n);
        }),
      );
    });
    const lastBest = best[best.length - 1] ?? [];
    let m = lastBest.indexOf(Math.min(...lastBest));
    if (!Number.isFinite(lastBest[m] ?? Infinity)) continue;
    const n: number[] = new Array<number>(g.length);
    for (let k = g.length - 1; k >= 0; k--) {
      n[k] = options[k]?.[m] ?? 1;
      m = from[k]?.[m] ?? 0;
    }
    return n;
  }
}

/**
 * Node arc lengths along [0, L] with nodes exactly at the fixed arc lengths sFixed (increasing,
 * from 0 to L). Between them the spacing follows h(s), adjusted so that each segment holds a whole
 * number of cells smoothly:
 * - each segment k becomes a zone of spacing z_k = L_k / ceil(L_k / h(mid)) (at least nMin[k]
 *   cells), and the spacing is capped by z_k + gradation * (distance to the zone), so a short
 *   segment (a 4.5 mm blade gap, a station plane 5 mm before a leading edge) is approached by a
 *   graded spacing instead of a jump;
 * - segmentCounts picks the counts, and the node index is mapped to the integral of ds / h by a
 *   monotone cubic through the fixed nodes, so the residual per-segment scale varies smoothly.
 * Returns the node arc lengths and the node index of each fixed arc length.
 */
export function fixedSpacing(
  L: number,
  h: (s: number) => number,
  sFixed: readonly number[],
  nMin: readonly number[],
  gradation = 0.08,
): { s: Float64Array; fixedIndex: number[] } {
  const K = sFixed.length - 1;
  if (K < 1 || sFixed[0] !== 0 || sFixed[K] !== L)
    throw new Error('fixed arc lengths must span the length from 0 to L');
  const F = (k: number): number => sFixed[k] ?? NaN;
  for (let k = 0; k < K; k++) {
    if (!(F(k + 1) > F(k))) throw new Error('fixed arc lengths must increase');
  }
  const zones = Array.from({ length: K }, (_, k) => {
    const len = F(k + 1) - F(k);
    // (a 0.2-cell tolerance: 15 mm at 4.98 mm is three cells, not four)
    const n = Math.max(nMin[k] ?? 1, Math.ceil(len / h(0.5 * (F(k) + F(k + 1))) - 0.2));
    return { a: F(k), b: F(k + 1), z: len / n };
  });
  const hEff = (s: number): number => {
    let v = h(s);
    for (const zn of zones) {
      const dz = s < zn.a ? zn.a - s : s > zn.b ? s - zn.b : 0;
      v = Math.min(v, zn.z + gradation * dz);
    }
    return v;
  };
  // the integral G(s) of ds / hEff on a fine grid, with the fixed arc lengths among its samples
  const M = Math.max(8192, 64 * K);
  const grid: number[] = [];
  for (let m = 0; m <= M; m++) grid.push((L * m) / M);
  for (const v of sFixed) grid.push(v);
  grid.sort((a, b) => a - b);
  const S: number[] = [];
  for (const v of grid) if (S.length === 0 || v > (S[S.length - 1] ?? 0)) S.push(v);
  const G = new Float64Array(S.length);
  for (let m = 1; m < S.length; m++) {
    const a = S[m - 1] ?? 0;
    const b = S[m] ?? 0;
    G[m] = (G[m - 1] ?? 0) + (b - a) / hEff(0.5 * (a + b));
  }
  const gAt = (s: number): number => G[S.indexOf(s)] ?? NaN;
  const Gk = sFixed.map((v) => gAt(v));
  const n0 = segmentCounts(
    Array.from({ length: K }, (_, k) => (Gk[k + 1] ?? 0) - (Gk[k] ?? 0)),
    nMin,
  );
  const fixedIndex = [0];
  for (const n of n0) fixedIndex.push((fixedIndex[fixedIndex.length - 1] ?? 0) + n);
  const N = fixedIndex[K] ?? 0;
  const gamma = pchip(fixedIndex, Gk);
  const s = new Float64Array(N + 1);
  let m = 0;
  let next = 0;
  for (let i = 0; i <= N; i++) {
    if (i === fixedIndex[next]) {
      s[i] = F(next);
      next++;
      continue;
    }
    const gi = gamma(i);
    while ((G[m + 1] ?? Infinity) < gi) m++;
    const g0 = G[m] ?? 0;
    const g1 = G[m + 1] ?? g0;
    const a = S[m] ?? 0;
    const b = S[m + 1] ?? a;
    s[i] = a + (b - a) * (g1 > g0 ? (gi - g0) / (g1 - g0) : 0);
  }
  return { s, fixedIndex };
}

/** A straight cut across a duct from a point on its lower wall to a point on its upper wall. */
export interface DuctCut {
  readonly hub: Pt;
  readonly tip: Pt;
}

/**
 * Node arc lengths along one wall [0, L] with nodes exactly at sFixed and exactly counts[k] cells
 * in segment k (counts shared with the opposite wall of a duct, so they can exceed what this wall
 * needs). The spacing function is built so that every cell ratio stays near 1 + gradation:
 * - the spacing at each fixed node is h there, or L/n of an adjacent segment with fewer than
 *   five cells (too few cells to grade within, so that cell size fixes the node spacing);
 * - h is capped by the node spacings graded outwards at `gradation`, and floored near a node
 *   whose spacing exceeds h, so neighbours step down to h rather than jump;
 * - a segment that must hold more cells than that gives dips in its interior to a cap found by
 *   bisection, approached from both ends at the same gradation (never by scaling the whole
 *   segment, which would break the match with its neighbours).
 * Also returns, per segment, the cells the wall would need at least (with the cap at infinity),
 * so the caller can raise shared counts that this wall cannot meet.
 */
export function wallSpacing(
  L: number,
  h: (s: number) => number,
  sFixed: readonly number[],
  counts: readonly number[],
  gradation = 0.08,
): { s: Float64Array; fixedIndex: number[]; need: number[] } {
  const K = sFixed.length - 1;
  const F = (k: number): number => sFixed[k] ?? NaN;
  const len = (k: number): number => F(k + 1) - F(k);
  const n = (k: number): number => counts[k] ?? 1;
  const rigid = (k: number): number => (k >= 0 && k < K && n(k) < 5 ? len(k) / n(k) : Infinity);
  // a node beside a rigid segment takes that segment's cell size (the cell cannot change)
  const sigma = sFixed.map((v, k) => {
    const r = Math.min(rigid(k - 1), rigid(k));
    return Number.isFinite(r) ? r : h(v);
  });
  // capped by the node spacings graded outwards; and near a node whose spacing exceeds h (a
  // one-cell blade gap beside finer chord cells) floored by that spacing graded back down, so
  // the neighbours step towards h instead of jumping to it
  const base = (v: number): number => {
    let out = h(v);
    let floor = 0;
    sigma.forEach((sg, k) => {
      const d = gradation * Math.abs(v - F(k));
      out = Math.min(out, sg + d);
      floor = Math.max(floor, sg / (1 + gradation) - d);
    });
    return Math.max(out, Math.min(floor, out * (1 + gradation) ** 2));
  };
  // per segment: M sample midpoints, the base spacing there (computed once), and the cap that
  // gives exactly n cells
  const M = 256;
  const caps: number[] = [];
  const need: number[] = [];
  const mid = (k: number, m: number): number => F(k) + ((m + 0.5) * len(k)) / M;
  const baseAt = Array.from({ length: K }, (_, k) =>
    Float64Array.from({ length: M }, (_, m) => base(mid(k, m))),
  );
  const at = (k: number, m: number, cap: number): number => {
    const v = mid(k, m);
    const ramp = Math.max(
      cap,
      (sigma[k] ?? 0) - gradation * (v - F(k)),
      (sigma[k + 1] ?? 0) - gradation * (F(k + 1) - v),
    );
    return Math.min(baseAt[k]?.[m] ?? Infinity, ramp);
  };
  const cells = (k: number, cap: number): number => {
    const d = len(k) / M;
    let sum = 0;
    for (let m = 0; m < M; m++) sum += d / at(k, m, cap);
    return sum;
  };
  for (let k = 0; k < K; k++) {
    const most = cells(k, Infinity);
    need.push(most);
    if (n(k) < 5 || most >= n(k)) {
      caps.push(Infinity);
      continue;
    }
    let lo = 1e-9;
    let hi = len(k);
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      if (cells(k, mid) > n(k)) lo = mid;
      else hi = mid;
    }
    caps.push(0.5 * (lo + hi));
  }
  // the integral of ds / spacing, then node index -> integral by a monotone cubic through the
  // fixed nodes (the counts now match the integral to within the rigid segments' rounding)
  const S: number[] = [];
  for (let k = 0; k < K; k++) for (let m = 0; m < M; m++) S.push(F(k) + (len(k) * m) / M);
  S.push(L);
  const G = new Float64Array(S.length);
  for (let k = 0; k < K; k++) {
    const d = len(k) / M;
    for (let m = 0; m < M; m++) {
      const q = k * M + m;
      G[q + 1] = (G[q] ?? 0) + d / at(k, m, caps[k] ?? Infinity);
    }
  }
  const fixedIndex = [0];
  for (let k = 0; k < K; k++) fixedIndex.push((fixedIndex[k] ?? 0) + n(k));
  const Gk = sFixed.map((_, k) => G[k * M] ?? 0);
  const N = fixedIndex[K] ?? 0;
  const gamma = pchip(fixedIndex, Gk);
  const s = new Float64Array(N + 1);
  let m = 0;
  let next = 0;
  for (let i = 0; i <= N; i++) {
    if (i === fixedIndex[next]) {
      s[i] = F(next);
      next++;
      continue;
    }
    const gi = gamma(i);
    while ((G[m + 1] ?? Infinity) < gi) m++;
    const g0 = G[m] ?? 0;
    const g1 = G[m + 1] ?? g0;
    const a = S[m] ?? 0;
    const b = S[m + 1] ?? a;
    s[i] = a + (b - a) * (g1 > g0 ? (gi - g0) / (g1 - g0) : 0);
  }
  return { s, fixedIndex, need };
}

/**
 * Wall node rows of a duct whose fixed lines (station planes, blade edges, the two ends) are cut
 * lines from the lower to the upper wall. Each wall is distributed along its own arc length (so
 * wall kinks cannot jump the spacing, and the fan's swept edges, 5 mm behind the fan face at the
 * hub and 20 mm at the tip, are honoured on both walls) with the same cell count per segment:
 * the larger of what the two walls need, raised until both can hold it smoothly (wallSpacing).
 * The caller joins node i of one wall to node i of the other with a straight cut.
 */
export function wallRows(
  lower: Polyline,
  upper: Polyline,
  h: (x: number) => number,
  cuts: readonly DuctCut[],
  minCells: (k: number) => number = () => 1,
  gradation = 0.08,
): { lo: Pt[]; up: Pt[]; fixed: number[] } {
  const first = cuts[0];
  const last = cuts[cuts.length - 1];
  if (first === undefined || last === undefined || cuts.length < 2)
    throw new Error('wallRows needs the two end lines');
  const side = (wall: Polyline, pick: (c: DuctCut) => Pt) => {
    const s0 = wall.sAtX(pick(first).x);
    const sub = wall.sub(s0, wall.sAtX(pick(last).x));
    const sFixed = cuts.map((c, k) =>
      k === 0 ? 0 : k === cuts.length - 1 ? sub.length : wall.sAtX(pick(c).x) - s0,
    );
    for (let k = 1; k < sFixed.length; k++) {
      if (!((sFixed[k] ?? 0) > (sFixed[k - 1] ?? 0)))
        throw new Error(`fixed duct lines are out of order at line ${k}`);
    }
    return { sub, sFixed, hs: (sv: number) => h(sub.at(sv).x) };
  };
  const walls = [side(lower, (c) => c.hub), side(upper, (c) => c.tip)] as const;
  const nMin = cuts.slice(1).map((_, k) => minCells(k));
  // start from each wall's own counts, then raise until both walls can hold them
  let counts = nMin.map((v) => v);
  for (const w of walls) {
    const { fixedIndex } = fixedSpacing(w.sub.length, w.hs, w.sFixed, nMin, gradation);
    counts = counts.map((c, k) => Math.max(c, (fixedIndex[k + 1] ?? 0) - (fixedIndex[k] ?? 0)));
  }
  for (let it = 0; it < 20; it++) {
    const before = counts.join();
    for (const w of walls) {
      const { need } = wallSpacing(w.sub.length, w.hs, w.sFixed, counts, gradation);
      counts = counts.map((c, k) => Math.max(c, Math.ceil((need[k] ?? 0) - 0.3)));
    }
    if (counts.join() === before) break;
  }
  const place = (w: (typeof walls)[number], pick: (c: DuctCut) => Pt) => {
    const { s, fixedIndex } = wallSpacing(w.sub.length, w.hs, w.sFixed, counts, gradation);
    let next = 0;
    const pts = Array.from(s, (v, i) => {
      if (i === fixedIndex[next]) return pick(cuts[next++] as DuctCut);
      return w.sub.at(v);
    });
    return { pts, fixed: fixedIndex.slice(1, -1) };
  };
  const a = place(walls[0], (c) => c.hub);
  const b = place(walls[1], (c) => c.tip);
  return { lo: a.pts, up: b.pts, fixed: a.fixed };
}
