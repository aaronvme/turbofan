// Blade sections in the blade-to-blade plane: m meridional (LE at m = 0, positive downstream),
// t tangential (positive toward +theta). The definition gives each row its metal angles
// (geometric, from +x toward +theta), thickness/chord and stagger; the real profiles are
// proprietary, so the sections are standard families:
//
// - naca65: the NACA 65-010 basic thickness form (Abbott & von Doenhoff, Theory of Wing
//   Sections, 1959, App. I; also NACA RM L51G31), scaled to the row's t/c, on a circular-arc
//   camber line (the usual compressor cascade construction, Dixon & Hall sec. 3.3).
// - dca: double circular arc (two arcs meeting at mid chord), the classic transonic fan and
//   front-stage section, on a circular-arc camber line.
// - turbine: the NACA 4-digit thickness form (max at 30 % chord, blunt leading edge) on a
//   front-loaded camber line, standing in for a turbine profile: thick, round-nosed and
//   highly cambered, with most of the turning near the leading edge.
//
// The camber line's slope angle runs from the inlet to the exit metal angle with arc-length
// fraction s as phi(s) = b1 + (b2 - b1) g(s); g(s) = s is a circular arc, whose chord lies at
// the mean metal angle, which is the definition's stagger. Thickness is laid off normal to the
// camber line. The chord is scaled so the section spans the requested meridional length.

import { ix } from './num';

export const PROFILE_FAMILIES = ['naca65', 'dca', 'turbine'] as const;
export type ProfileFamily = (typeof PROFILE_FAMILIES)[number];

export interface BladeToBladePoint {
  readonly m: number;
  readonly t: number;
}

/** NACA 65-010 basic thickness form: x and half thickness y, percent chord. */
const NACA65_X = [
  0, 0.5, 0.75, 1.25, 2.5, 5, 7.5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85,
  90, 95, 100,
] as const;
const NACA65_Y = [
  0, 0.772, 0.932, 1.169, 1.574, 2.177, 2.647, 3.04, 3.666, 4.143, 4.503, 4.76, 4.924, 4.996, 4.963,
  4.812, 4.53, 4.146, 3.682, 3.156, 2.584, 1.987, 1.385, 0.81, 0.306, 0,
] as const;
const NACA65_PEAK = 4.996;

/** Fritsch-Carlson slopes for monotone piecewise-cubic (PCHIP) interpolation of the table. */
const NACA65_SLOPES: readonly number[] = (() => {
  const n = NACA65_X.length;
  const d: number[] = [];
  for (let i = 0; i + 1 < n; i++)
    d.push((ix(NACA65_Y, i + 1) - ix(NACA65_Y, i)) / (ix(NACA65_X, i + 1) - ix(NACA65_X, i)));
  const m: number[] = [ix(d, 0)];
  for (let i = 1; i + 1 < n; i++) {
    const a = ix(d, i - 1);
    const b = ix(d, i);
    if (a * b <= 0) m.push(0);
    else {
      const h0 = ix(NACA65_X, i) - ix(NACA65_X, i - 1);
      const h1 = ix(NACA65_X, i + 1) - ix(NACA65_X, i);
      const w1 = 2 * h1 + h0;
      const w2 = h1 + 2 * h0;
      m.push((w1 + w2) / (w1 / a + w2 / b));
    }
  }
  m.push(ix(d, n - 2));
  return m;
})();

/** The 65-010 half thickness at chord fraction s, percent chord. */
function naca65Percent(s: number): number {
  const x = s * 100;
  const x1 = NACA65_X[1];
  const y1 = NACA65_Y[1];
  // the leading edge is round: y ~ sqrt(x) inside the first table interval
  if (x <= x1) return y1 * Math.sqrt(x / x1);
  let i = 1;
  while (i + 2 < NACA65_X.length && ix(NACA65_X, i + 1) < x) i++;
  const xa = ix(NACA65_X, i);
  const xb = ix(NACA65_X, i + 1);
  const h = xb - xa;
  const t = (x - xa) / h;
  const ya = ix(NACA65_Y, i);
  const yb = ix(NACA65_Y, i + 1);
  const ma = ix(NACA65_SLOPES, i);
  const mb = ix(NACA65_SLOPES, i + 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * ya +
    (t3 - 2 * t2 + t) * h * ma +
    (-2 * t3 + 3 * t2) * yb +
    (t3 - t2) * h * mb
  );
}

/** NACA 4-digit half thickness for t/c = 1, closed trailing edge (a4 = -0.1036). */
function naca4(s: number): number {
  const sq = Math.sqrt(s);
  return 5 * (0.2969 * sq - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4);
}

/** Half thickness over chord at chord fraction s for a section of maximum t/c `tMax`. */
export function halfThickness(family: ProfileFamily, s: number, tMax: number): number {
  if (!(s >= 0 && s <= 1)) throw new Error(`halfThickness: chord fraction ${s} outside [0, 1]`);
  switch (family) {
    case 'naca65':
      return (naca65Percent(s) / NACA65_PEAK) * (tMax / 2);
    case 'dca': {
      const h = tMax / 2;
      const radius = (0.25 + h * h) / (2 * h);
      return Math.max(0, Math.sqrt(radius * radius - (s - 0.5) ** 2) - (radius - h));
    }
    case 'turbine':
      return naca4(s) * tMax;
  }
}

/** Fraction of the total turning reached at arc-length fraction s (g in the header). */
export function camberFraction(family: ProfileFamily, s: number): number {
  // turbine: g = s + k s (1 - s), g'(0) = 1 + k: about a third more turning up front
  return family === 'turbine' ? s + 0.35 * s * (1 - s) : s;
}

export interface SectionSpec {
  readonly family: ProfileFamily;
  /** Camber-line angle at the leading edge, rad (from +m toward +t). */
  readonly inletAngle: number;
  readonly exitAngle: number;
  /** Maximum thickness over chord. */
  readonly maxThickness: number;
  /** Meridional distance from the leading to the trailing edge, m. */
  readonly meridionalLength: number;
  /** Chord stations per side, leading and trailing edge included (>= 3). */
  readonly pointsPerSide: number;
}

export interface AirfoilSection {
  /**
   * Closed counter-clockwise loop, 2n - 2 points: the leading edge (index 0), the pressure
   * side to the trailing edge (index n - 1), then the suction side back.
   */
  readonly points: readonly BladeToBladePoint[];
  readonly teIndex: number;
  /** Camber line at the n chord stations. */
  readonly camber: readonly BladeToBladePoint[];
  /** Chord stations (arc-length fraction of the camber line), cosine-spaced. */
  readonly stations: readonly number[];
  readonly chord: number;
  /** Direction of the chord line from +m, rad (the stagger). */
  readonly chordAngle: number;
  readonly area: number;
  readonly centroid: BladeToBladePoint;
  /** Largest distance between the two sides at one station, m. */
  readonly maxThickness: number;
}

/** 4-point Gauss-Legendre nodes and weights on [0, 1]. */
const GL_NODES = [0.0694318442029737, 0.330009478207572, 0.669990521792428, 0.930568155797026];
const GL_WEIGHTS = [0.173927422568727, 0.326072577431273, 0.326072577431273, 0.173927422568727];
const GL_PANELS = 64;

/** The unit-arc-length camber line at fraction s (integral of the slope direction). */
function camberPoint(phi: (s: number) => number, s: number): BladeToBladePoint {
  let m = 0;
  let t = 0;
  const h = s / GL_PANELS;
  for (let k = 0; k < GL_PANELS; k++) {
    for (let q = 0; q < 4; q++) {
      const u = (k + ix(GL_NODES, q)) * h;
      const w = ix(GL_WEIGHTS, q) * h;
      const a = phi(u);
      m += w * Math.cos(a);
      t += w * Math.sin(a);
    }
  }
  return { m, t };
}

/** Shoelace area and centroid of a closed loop. */
export function polygonAreaCentroid(points: readonly BladeToBladePoint[]): {
  area: number;
  centroid: BladeToBladePoint;
} {
  let a = 0;
  let cm = 0;
  let ct = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    if (p === undefined || q === undefined) continue;
    const cross = p.m * q.t - q.m * p.t;
    a += cross;
    cm += (p.m + q.m) * cross;
    ct += (p.t + q.t) * cross;
  }
  a /= 2;
  return { area: a, centroid: a === 0 ? { m: 0, t: 0 } : { m: cm / (6 * a), t: ct / (6 * a) } };
}

/** A blade section on its metal angles; see the header for the construction. */
export function airfoilSection(spec: SectionSpec): AirfoilSection {
  const n = spec.pointsPerSide;
  if (!(Number.isInteger(n) && n >= 3)) throw new Error('airfoilSection: pointsPerSide >= 3');
  if (!(spec.meridionalLength > 0)) throw new Error('airfoilSection: meridionalLength > 0');
  if (!(spec.maxThickness > 0)) throw new Error('airfoilSection: maxThickness > 0');
  const { family, inletAngle: b1, exitAngle: b2 } = spec;
  const phi = (s: number) => b1 + (b2 - b1) * camberFraction(family, s);
  const end = camberPoint(phi, 1);
  const scale = spec.meridionalLength / end.m;
  const chord = Math.hypot(end.m, end.t) * scale;
  const stations: number[] = [];
  for (let i = 0; i < n; i++)
    stations.push(i === n - 1 ? 1 : (1 - Math.cos((Math.PI * i) / (n - 1))) / 2);
  const camber: BladeToBladePoint[] = [];
  const pressure: BladeToBladePoint[] = [];
  const suction: BladeToBladePoint[] = [];
  let maxT = 0;
  stations.forEach((s, i) => {
    const c = i === 0 ? { m: 0, t: 0 } : i === n - 1 ? end : camberPoint(phi, s);
    const cm = c.m * scale;
    const ct = c.t * scale;
    camber.push({ m: cm, t: ct });
    const y = i === 0 || i === n - 1 ? 0 : halfThickness(family, s, spec.maxThickness) * chord;
    const a = phi(s);
    // left normal of the camber direction (cos a, sin a)
    const nm = -Math.sin(a);
    const nt = Math.cos(a);
    suction.push({ m: cm + y * nm, t: ct + y * nt });
    pressure.push({ m: cm - y * nm, t: ct - y * nt });
    maxT = Math.max(maxT, 2 * y);
  });
  // counter-clockwise: out along the right-hand (pressure) side, back along the left one
  const points = [...pressure, ...suction.slice(1, n - 1).reverse()];
  const { area, centroid } = polygonAreaCentroid(points);
  return {
    points,
    teIndex: n - 1,
    camber,
    stations,
    chord,
    chordAngle: Math.atan2(end.t, end.m),
    area,
    centroid,
    maxThickness: maxT,
  };
}

const orient = (a: BladeToBladePoint, b: BladeToBladePoint, c: BladeToBladePoint): number =>
  (b.m - a.m) * (c.t - a.t) - (b.t - a.t) * (c.m - a.m);

function segmentsCross(
  a: BladeToBladePoint,
  b: BladeToBladePoint,
  c: BladeToBladePoint,
  d: BladeToBladePoint,
): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** True when no two non-adjacent edges of the closed loop cross. */
export function isSimplePolygon(points: readonly BladeToBladePoint[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = points[i];
      const b = points[(i + 1) % n];
      const c = points[j];
      const d = points[(j + 1) % n];
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  return true;
}
