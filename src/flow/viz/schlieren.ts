// Schlieren and heat haze of the flow visuals (w2/flowviz round 2): what the simulated density
// field does to light, pure and mirrored by the TSL raymarch in src/render/flowViz.ts.
//
// A ray through a refractive field turns by eps = (1/n) integral grad_perp(n) ds (Merzkirch,
// Flow Visualization, 2nd ed., 1987, ch. 3; Settles, Schlieren and Shadowgraph Techniques,
// 2001, eq. 2.4), with Gladstone-Dale n - 1 = K rho (src/flow/viz/optics.ts), so
// eps = K integral grad_perp(rho) ds to first order (n ~ 1 + 3e-4). The field is axisymmetric:
// grad rho = (d rho/dx, d rho/dr e_r), e_r = (0, y, z) / r. The screen components of eps are
// its projections on the ray's right and up vectors (both normal to the ray, so the parallel
// part of grad rho drops out). The image of a knife-edge schlieren system (Settles 2001,
// eq. 3.5) is I/I0 = 1 + eps f / a about a 50 % cut-off: grey 0.5 at rest, black or white at
// eps = -+a/f. Heat haze is the same deflection seen as an apparent shift of the background.

export type Vec3 = readonly [number, number, number];

/** d rho/dx and d rho/dr at (x, r), kg/m^4; null outside the field (counts as 0). */
export type DensityGradient = (x: number, r: number) => { gx: number; gr: number } | null;

export interface DeflectionRay {
  readonly origin: Vec3;
  /** Unit direction. */
  readonly dir: Vec3;
  /** Unit vectors normal to dir: the screen's right and up at this pixel. */
  readonly right: Vec3;
  readonly up: Vec3;
  /** The field's extent: x in [xMin, xMax], r <= rMax. */
  readonly xMin: number;
  readonly xMax: number;
  readonly rMax: number;
  /** Midpoint-rule samples over the ray's span inside the field. */
  readonly steps: number;
  /** The ray stops here (the first opaque surface), m along it; default unbounded. */
  readonly tMax?: number;
}

export interface Deflection {
  /** Deflection toward right and up, rad. */
  readonly ex: number;
  readonly ey: number;
  /** Where along the ray the deflection happens (|d eps|-weighted mean distance), m; 0 if none. */
  readonly centroidM: number;
}

/** The ray's span [t0, t1] inside x in [xMin, xMax], r <= rMax (null: it misses). */
export function rayCylinderSpan(
  o: Vec3,
  d: Vec3,
  xMin: number,
  xMax: number,
  rMax: number,
): [number, number] | null {
  let t0 = 0;
  let t1 = Infinity;
  // the x slab
  if (Math.abs(d[0]) < 1e-12) {
    if (o[0] < xMin || o[0] > xMax) return null;
  } else {
    const a = (xMin - o[0]) / d[0];
    const b = (xMax - o[0]) / d[0];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  // the cylinder y^2 + z^2 <= R^2
  const qa = d[1] * d[1] + d[2] * d[2];
  const qb = 2 * (o[1] * d[1] + o[2] * d[2]);
  const qc = o[1] * o[1] + o[2] * o[2] - rMax * rMax;
  if (qa < 1e-12) {
    if (qc > 0) return null;
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc <= 0) return null;
    const s = Math.sqrt(disc);
    t0 = Math.max(t0, (-qb - s) / (2 * qa));
    t1 = Math.min(t1, (-qb + s) / (2 * qa));
  }
  return t1 > t0 ? [t0, t1] : null;
}

/** eps along one ray through the axisymmetric field (K: Gladstone-Dale, m^3/kg). */
export function rayDeflection(ray: DeflectionRay, grad: DensityGradient, k: number): Deflection {
  const span = rayCylinderSpan(ray.origin, ray.dir, ray.xMin, ray.xMax, ray.rMax);
  if (span === null) return { ex: 0, ey: 0, centroidM: 0 };
  const t0 = span[0];
  const t1 = Math.min(span[1], ray.tMax ?? Infinity);
  if (!(t1 > t0)) return { ex: 0, ey: 0, centroidM: 0 };
  const ds = (t1 - t0) / ray.steps;
  let ex = 0;
  let ey = 0;
  let w = 0;
  let wt = 0;
  const [o, d, R, U] = [ray.origin, ray.dir, ray.right, ray.up];
  for (let i = 0; i < ray.steps; i++) {
    const t = t0 + (i + 0.5) * ds;
    const x = o[0] + t * d[0];
    const y = o[1] + t * d[1];
    const z = o[2] + t * d[2];
    const r = Math.hypot(y, z);
    const g = grad(x, r);
    if (g === null) continue;
    // grad rho in 3D; on the axis d rho/dr is 0 (rho is even in r)
    const ey3 = r > 1e-9 ? (g.gr * y) / r : 0;
    const ez3 = r > 1e-9 ? (g.gr * z) / r : 0;
    const dx = k * ds * (g.gx * R[0] + ey3 * R[1] + ez3 * R[2]);
    const dy = k * ds * (g.gx * U[0] + ey3 * U[1] + ez3 * U[2]);
    ex += dx;
    ey += dy;
    const m = Math.hypot(dx, dy);
    w += m;
    wt += m * t;
  }
  return { ex, ey, centroidM: w > 0 ? wt / w : 0 };
}

/** Knife-edge schlieren intensity, 0..1 (0.5 = no deflection), for a cut-off a/f in rad. */
export function knifeEdgeIntensity(eps: number, rangeRad: number): number {
  return Math.min(1, Math.max(0, 0.5 + (0.5 * eps) / rangeRad));
}

/** Shifts smaller than this are not drawn (sub-pixel: the haze pass skips them), px. */
export const HAZE_MIN_SHIFT_PX = 0.05;

/**
 * The apparent shift of the background, px: the ray turns by eps at distance zGas, so it meets
 * a background at zBg displaced by eps (zBg - zGas), which the camera sees at that over zBg.
 * A background nearer than the gas is not displaced by it.
 */
export function hazeShiftPx(
  eps: number,
  zGasM: number,
  zBgM: number,
  fovYRad: number,
  heightPx: number,
): number {
  if (zBgM <= zGasM) return 0;
  const radPerPx = (2 * Math.tan(fovYRad / 2)) / heightPx;
  return (eps * (zBgM - zGasM)) / zBgM / radPerPx;
}
