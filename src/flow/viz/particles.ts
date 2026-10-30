// Particle math of the flow visuals (w2/flowviz): pure, unit-tested, and mirrored line for line
// by the WGSL particle kernel (src/flow/viz/wgsl), so the GPU path can be checked against it.
//
// The solver field is 2D axisymmetric with swirl: at (x, r) it gives u_x, u_r and u_theta. A
// particle is therefore advanced in (x, r, theta), where the swirl is exact (d theta / dt =
// u_theta / r keeps r unchanged in a pure vortex, which a Cartesian step would not), and only
// drawn in 3D: (x, r cos theta, r sin theta) in the engine frame of PHYSICS.md 2.1 (x axial,
// theta right-handed about +x, so theta = 0 is +y and theta = pi/2 is +z).

export interface Cylindrical {
  readonly x: number;
  readonly r: number;
  readonly theta: number;
}

/** What a sampler of the field returns at (x, r): m/s and the fluid fraction (0 = solid). */
export interface MeridionalVelocity {
  readonly ux: number;
  readonly ur: number;
  readonly ut: number;
  readonly fluid: number;
}

/** The field at (x, r), or null outside it. */
export type MeridionalSampler = (x: number, r: number) => MeridionalVelocity | null;

export function toCartesian(x: number, r: number, theta: number): [number, number, number] {
  return [x, r * Math.cos(theta), r * Math.sin(theta)];
}

export function toCylindrical(p: readonly [number, number, number]): Cylindrical {
  return { x: p[0], r: Math.hypot(p[1], p[2]), theta: Math.atan2(p[2], p[1]) };
}

/** The 3D velocity at azimuth theta: u_x x-hat + u_r e_r + u_theta e_theta, e_theta = x-hat cross e_r. */
export function velocity3D(
  theta: number,
  ux: number,
  ur: number,
  ut: number,
): [number, number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [ux, ur * c - ut * s, ur * s + ut * c];
}

/** Below this radius, u_theta / r uses this radius (u_theta is odd in r, so it vanishes there). */
const AXIS_R = 1e-4;
/** A particle in a texel that is less than half fluid has hit a wall. */
export const MIN_FLUID = 0.5;

const alive = (v: MeridionalVelocity | null): v is MeridionalVelocity =>
  v !== null && v.fluid >= MIN_FLUID;

/**
 * One midpoint (RK2) step of dt seconds; null when the particle leaves the field or enters
 * solid, at the midpoint or at the end. The step is the plain midpoint rule in the full
 * meridional plane, r of either sign, on the field's odd extension (sampleCpuField's ghost row:
 * u_r and u_theta change sign across the axis). So a midpoint beyond the axis gives the end step
 * the mirrored u_r (W2V-N12), and a step that ends beyond it is folded back to the far side.
 */
export function advectParticle(
  p: Cylindrical,
  dt: number,
  sample: MeridionalSampler,
): Cylindrical | null {
  const v0 = sample(p.x, p.r);
  if (!alive(v0)) return null;
  const q = midpointFrom(p, dt, v0, sample);
  if (q === null || !alive(sample(q.x, q.r))) return null;
  return q;
}

/** The midpoint step from p, whose field sample v0 is known (alive); the end is not checked. */
function midpointFrom(
  p: Cylindrical,
  dt: number,
  v0: MeridionalVelocity,
  sample: MeridionalSampler,
): Cylindrical | null {
  const mx = p.x + 0.5 * dt * v0.ux;
  const mrSigned = p.r + 0.5 * dt * v0.ur;
  const mr = Math.abs(mrSigned);
  const v1 = sample(mx, mr);
  if (!alive(v1)) return null;
  // u_r is odd in r: beyond the axis the extension's radial velocity is the mirror's, negated;
  // theta's rate u_theta / r is even (both odd), so it needs no sign
  const ur = mrSigned < 0 ? -v1.ur : v1.ur;
  const x = p.x + dt * v1.ux;
  let r = p.r + dt * ur;
  let theta = p.theta + (dt * v1.ut) / Math.max(mr, AXIS_R);
  if (r < 0) {
    r = -r;
    theta += Math.PI;
  }
  return { x, r, theta };
}

/**
 * W2V-I4: the frame's step dt as midpoint substeps that move at most `cellM` in (x, r) each, so the
 * fluid checks (each substep's start, midpoint and end) are at most half a texel apart and a
 * one-texel wall cannot be skipped. Each substep divides the time left evenly into steps no
 * longer than cellM / |u_m| at its start (u_m the meridional speed). After `maxSubsteps` the rest
 * of dt is dropped: a tracer that fast at that dilation falls behind the flow, never through a
 * wall. One substep (motion under a texel) is exactly advectParticle.
 */
export function advectSubstepped(
  p: Cylindrical,
  dt: number,
  sample: MeridionalSampler,
  cellM: number,
  maxSubsteps: number,
): Cylindrical | null {
  let q: Cylindrical = p;
  let v = sample(p.x, p.r);
  if (!alive(v)) return null;
  let left = dt;
  for (let k = 0; k < maxSubsteps && left > 0; k++) {
    const um = Math.hypot(v.ux, v.ur);
    const n = um * left > cellM ? Math.ceil((um * left) / cellM) : 1;
    const h = left / n;
    const next = midpointFrom(q, h, v, sample);
    if (next === null) return null;
    q = next;
    left -= h;
    v = sample(q.x, q.r);
    if (!alive(v)) return null;
  }
  return q;
}

/** mulberry32: a small, fast, seeded PRNG in [0, 1) (deterministic tests; GPU uses a hash). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An annular slab x in [x0, x1], r in [r0, r1] where particles are born, with a share weight. */
export interface SeedZone {
  readonly id: string;
  readonly weight: number;
  readonly x0: number;
  readonly x1: number;
  readonly r0: number;
  readonly r1: number;
}

export interface Seed extends Cylindrical {
  readonly zone: string;
}

/** A birth point: a zone by weight, then uniform by volume in it (r from the area CDF). */
export function seedParticle(rng: () => number, zones: readonly SeedZone[]): Seed {
  const total = zones.reduce((s, z) => s + z.weight, 0);
  let pick = rng() * total;
  let zone = zones[zones.length - 1];
  for (const z of zones) {
    if (pick < z.weight) {
      zone = z;
      break;
    }
    pick -= z.weight;
  }
  if (zone === undefined) throw new Error('seedParticle: no zones');
  const x = zone.x0 + rng() * (zone.x1 - zone.x0);
  const r = Math.sqrt(zone.r0 ** 2 + rng() * (zone.r1 ** 2 - zone.r0 ** 2));
  return { zone: zone.id, x, r, theta: 2 * Math.PI * rng() };
}

const smooth = (e0: number, e1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Fraction of a particle's life spent fading in and out. */
export const FADE = 0.15;
/**
 * The fade-in never takes longer than this, s: a particle born in a fast jet leaves the field
 * within half a second, and a fade-in of 15 % of its life would hide it for all of that.
 */
export const FADE_IN_MAX_S = 0.12;

/**
 * Opacity of a particle aged `age` of `life` seconds; `edge` is its distance to where it must
 * die (the field's end or a wall) as a fraction of the fade distance, 1 or more = far from it.
 */
export function particleAlpha(age: number, life: number, edge: number): number {
  const u = age / life;
  const fadeIn = Math.min(FADE * life, FADE_IN_MAX_S);
  return smooth(0, fadeIn, age) * (1 - smooth(1 - FADE, 1, u)) * smooth(0, 1, edge);
}
