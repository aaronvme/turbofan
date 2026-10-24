// Arc-length parameterised polylines. Geometry curves are sampled densely (thousands of points),
// so linear interpolation between samples is far below mesh spacing (a 2000-point quarter circle of
// radius 1 is within 3e-8 of the true arc length).
import type { Pt } from './types';

export class Polyline {
  readonly points: readonly Pt[];
  /** Cumulative arc length at each point. */
  readonly cum: Float64Array;

  constructor(points: readonly Pt[]) {
    if (points.length < 2) throw new Error('a polyline needs at least two points');
    this.points = points;
    const cum = new Float64Array(points.length);
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1] as Pt;
      const b = points[k] as Pt;
      cum[k] = (cum[k - 1] ?? 0) + Math.hypot(b.x - a.x, b.r - a.r);
    }
    this.cum = cum;
  }

  get length(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }

  /** Index k of the segment [k, k+1] containing arc length s (clamped). */
  private segment(s: number): number {
    const n = this.points.length - 1;
    if (s <= 0) return 0;
    if (s >= this.length) return n - 1;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.cum[mid] ?? 0) <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  at(s: number): Pt {
    if (s <= 0) return this.points[0] as Pt;
    if (s >= this.length) return this.points[this.points.length - 1] as Pt;
    const k = this.segment(s);
    const a = this.points[k] as Pt;
    const b = this.points[k + 1] as Pt;
    const s0 = this.cum[k] ?? 0;
    const L = (this.cum[k + 1] ?? 0) - s0;
    const u = L > 0 ? (s - s0) / L : 0;
    return { x: a.x + u * (b.x - a.x), r: a.r + u * (b.r - a.r) };
  }

  /** Unit tangent of the segment containing s, pointing towards increasing s. */
  tangent(s: number): Pt {
    const k = this.segment(s);
    const a = this.points[k] as Pt;
    const b = this.points[k + 1] as Pt;
    const L = Math.hypot(b.x - a.x, b.r - a.r);
    return { x: (b.x - a.x) / L, r: (b.r - a.r) / L };
  }

  /** Arc length of the first crossing of the axial station x. */
  sAtX(x: number): number {
    for (let k = 0; k + 1 < this.points.length; k++) {
      const a = this.points[k] as Pt;
      const b = this.points[k + 1] as Pt;
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
        const u = (x - a.x) / (b.x - a.x);
        return (this.cum[k] ?? 0) + u * ((this.cum[k + 1] ?? 0) - (this.cum[k] ?? 0));
      }
      if (a.x === x) return this.cum[k] ?? 0;
    }
    throw new Error(`curve does not reach x = ${x}`);
  }

  atX(x: number): Pt {
    const p = this.at(this.sAtX(x));
    return { x, r: p.r };
  }

  /**
   * Arc length of the intersection of the infinite line origin + t * dir with this curve that is
   * closest to the origin (smallest |t|), or null if the line misses the curve.
   */
  rayHit(origin: Pt, dir: Pt): number | null {
    let best: number | null = null;
    let bestT = Infinity;
    for (let k = 0; k + 1 < this.points.length; k++) {
      const a = this.points[k] as Pt;
      const b = this.points[k + 1] as Pt;
      const ex = b.x - a.x;
      const er = b.r - a.r;
      const den = dir.x * er - dir.r * ex;
      if (den === 0) continue;
      const wx = a.x - origin.x;
      const wr = a.r - origin.r;
      const t = (wx * er - wr * ex) / den;
      const u = (wx * dir.r - wr * dir.x) / den;
      if (u >= 0 && u <= 1 && Math.abs(t) < bestT) {
        bestT = Math.abs(t);
        best = (this.cum[k] ?? 0) + u * ((this.cum[k + 1] ?? 0) - (this.cum[k] ?? 0));
      }
    }
    return best;
  }

  /** The piece between arc lengths s0 < s1, with exact end points at(s0) and at(s1). */
  sub(s0: number, s1: number): Polyline {
    const pts: Pt[] = [this.at(s0)];
    for (let k = 0; k < this.points.length; k++) {
      const c = this.cum[k] ?? 0;
      if (c > s0 && c < s1) pts.push(this.points[k] as Pt);
    }
    pts.push(this.at(s1));
    return new Polyline(pts);
  }

  reversed(): Polyline {
    return new Polyline([...this.points].reverse());
  }

  sample(s: ArrayLike<number>): Pt[] {
    return Array.from(s, (v) => this.at(v));
  }

  /** Shortest distance from p to the curve. */
  distanceTo(p: Pt): number {
    let best = Infinity;
    for (let k = 0; k + 1 < this.points.length; k++) {
      const a = this.points[k] as Pt;
      const b = this.points[k + 1] as Pt;
      const ex = b.x - a.x;
      const er = b.r - a.r;
      const L2 = ex * ex + er * er;
      const u = L2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.r - a.r) * er) / L2)) : 0;
      best = Math.min(best, Math.hypot(a.x + u * ex - p.x, a.r + u * er - p.r));
    }
    return best;
  }
}

/** Dense polyline through fn(u) for u = 0, 1/n, ..., 1. */
export function sampleFunction(fn: (u: number) => Pt, n: number): Polyline {
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) pts.push(fn(k / n));
  return new Polyline(pts);
}

/** Concatenate curves that meet end to start (the shared point is kept once). */
export function joinCurves(curves: readonly Polyline[]): Polyline {
  const pts: Pt[] = [];
  for (const c of curves) {
    const start = pts.length === 0 ? 0 : 1;
    for (let k = start; k < c.points.length; k++) pts.push(c.points[k] as Pt);
  }
  return new Polyline(pts);
}
