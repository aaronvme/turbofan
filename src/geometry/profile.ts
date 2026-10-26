// Meridional profile curves for the rendered engine.
//
// The definition's curves are coarse polylines (kinks of up to ~28 degrees). The rendered
// surfaces and the blades both use one rounded version of them, so a blade hub section sits
// exactly on the hub surface the viewer sees and a rotor tip keeps its clearance to the
// rendered casing. Every vertex gets a quadratic Bezier fillet (control point on the vertex,
// legs of length d along the two segments); between fillets the curve IS the definition's
// segment. The fillet passes d sin(turn / 2) / 2 inside the vertex (2.1 mm for a 20 degree
// kink at the 25 mm default), whereas an interpolating spline through the vertices bulges by
// up to 10 mm on the long LPT segments (measured on this definition).

import type { MeridionalPoint } from '../contracts/engine';

export type P2 = MeridionalPoint;

export interface RoundedPolylineOptions {
  /** Largest fillet leg, m; a leg never exceeds half of either adjacent segment. */
  readonly blend: number;
  /** Samples per fillet (>= 2). */
  readonly samplesPerFillet: number;
  /**
   * Phantom neighbour before the first point: the first point is filleted too and the curve
   * starts at that fillet's apex, so two curves sharing a lip point and naming each other's
   * second point meet there with one tangent. Without it the curve starts on the first point.
   */
  readonly before?: P2;
  /** Phantom neighbour after the last point (same rule at the end). */
  readonly after?: P2;
  /** Fillet leg at a phantom end, m (a sharp splitter wants a much smaller one). Default blend. */
  readonly endBlend?: number;
}

const dist = (a: P2, b: P2): number => Math.hypot(b.x - a.x, b.r - a.r);
const toward = (from: P2, to: P2, d: number): P2 => {
  const l = dist(from, to);
  return { x: from.x + ((to.x - from.x) * d) / l, r: from.r + ((to.r - from.r) * d) / l };
};
const bezier = (a: P2, v: P2, b: P2, t: number): P2 => {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * v.x + t * t * b.x,
    r: u * u * a.r + 2 * u * t * v.r + t * t * b.r,
  };
};

/** A polyline with every vertex rounded (see the header); dense along fillets only. */
export function roundedPolyline(points: readonly P2[], options: RoundedPolylineOptions): P2[] {
  const n = options.samplesPerFillet;
  if (!(Number.isInteger(n) && n >= 2)) throw new Error('roundedPolyline: samplesPerFillet >= 2');
  if (!(options.blend > 0)) throw new Error('roundedPolyline: blend > 0');
  if (points.length < 2) throw new Error('roundedPolyline: needs at least two points');
  const ext = [
    ...(options.before ? [options.before] : []),
    ...points,
    ...(options.after ? [options.after] : []),
  ];
  const first = options.before ? 1 : 0;
  const last = ext.length - 1 - (options.after ? 1 : 0);
  const out: P2[] = [];
  const push = (p: P2) => {
    const q = out[out.length - 1];
    if (q === undefined || q.x !== p.x || q.r !== p.r) out.push(p);
  };
  for (let i = first; i <= last; i++) {
    const v = ext[i];
    const prev = ext[i - 1];
    const next = ext[i + 1];
    if (v === undefined) continue;
    if (prev === undefined || next === undefined) {
      push(v); // an open end: the curve ends on the definition point
      continue;
    }
    const phantomEnd = (i === first && options.before) || (i === last && options.after);
    const leg = phantomEnd ? (options.endBlend ?? options.blend) : options.blend;
    const d = Math.min(leg, dist(prev, v) / 2, dist(v, next) / 2);
    const a = toward(v, prev, d);
    const b = toward(v, next, d);
    // a phantom end keeps only its half of the fillet, from the apex
    const t0 = i === first && options.before ? 0.5 : 0;
    const t1 = i === last && options.after ? 0.5 : 1;
    for (let k = 0; k <= n; k++) {
      const t = t0 + ((t1 - t0) * k) / n;
      push(k === 0 && t0 === 0 ? a : k === n && t1 === 1 ? b : bezier(a, v, b, t));
    }
  }
  return out;
}

/** r(x) along a dense curve whose x increases strictly; linear between samples, clamped. */
export class WallCurve {
  readonly samples: readonly P2[];
  readonly xMin: number;
  readonly xMax: number;

  constructor(samples: readonly P2[]) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined || samples.length < 2)
      throw new Error('WallCurve: needs at least two samples');
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (a === undefined || b === undefined || !(b.x > a.x))
        throw new Error(`WallCurve: x must increase strictly (sample ${i})`);
    }
    this.samples = samples;
    this.xMin = first.x;
    this.xMax = last.x;
  }

  radiusAt(x: number): number {
    const s = this.samples;
    let lo = 0;
    let hi = s.length - 1;
    const a0 = s[lo];
    const b0 = s[hi];
    if (a0 === undefined || b0 === undefined) return Number.NaN;
    if (x <= a0.x) return a0.r;
    if (x >= b0.x) return b0.r;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((s[mid]?.x ?? Infinity) <= x) lo = mid;
      else hi = mid;
    }
    const a = s[lo] ?? a0;
    const b = s[hi] ?? b0;
    return a.r + ((x - a.x) * (b.r - a.r)) / (b.x - a.x);
  }
}

/** Keeps the samples whose x exceeds every x before them (a curve that turns back at a lip). */
export function monotoneInX(path: readonly P2[]): P2[] {
  const out: P2[] = [];
  let xMax = -Infinity;
  for (const p of path) {
    if (p.x > xMax) {
      out.push(p);
      xMax = p.x;
    }
  }
  return out;
}

/** Largest |r - ref(x)| over the samples (ref may be null outside its range). */
export function maxRadialDeviation(
  samples: readonly P2[],
  ref: (x: number) => number | null,
): number {
  let worst = 0;
  for (const p of samples) {
    const r = ref(p.x);
    if (r !== null) worst = Math.max(worst, Math.abs(p.r - r));
  }
  return worst;
}

/** Distance from p to the nearest segment of a polyline. */
export function distanceToPolyline(p: P2, line: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dr = b.r - a.r;
    const l2 = dx * dx + dr * dr;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.r - a.r) * dr) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.r - (a.r + t * dr)));
  }
  return best;
}

/** Largest distance from any sample to the polyline (a Hausdorff half-distance). */
export function maxDistanceToPolyline(samples: readonly P2[], line: readonly P2[]): number {
  let worst = 0;
  for (const p of samples) worst = Math.max(worst, distanceToPolyline(p, line));
  return worst;
}
