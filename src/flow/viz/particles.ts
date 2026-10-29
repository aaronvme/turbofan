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
 * solid, at the midpoint or at the end. A step through the axis reflects to the far side.
 */
export function advectParticle(
  p: Cylindrical,
  dt: number,
  sample: MeridionalSampler,
): Cylindrical | null {
  const v0 = sample(p.x, p.r);
  if (!alive(v0)) return null;
  const mx = p.x + 0.5 * dt * v0.ux;
  const mr = Math.abs(p.r + 0.5 * dt * v0.ur);
  const v1 = sample(mx, mr);
  if (!alive(v1)) return null;
  const x = p.x + dt * v1.ux;
  let r = p.r + dt * v1.ur;
  let theta = p.theta + (dt * v1.ut) / Math.max(mr, AXIS_R);
  if (r < 0) {
    r = -r;
    theta += Math.PI;
  }
  if (!alive(sample(x, r))) return null;
  return { x, r, theta };
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
const FADE = 0.15;

/**
 * Opacity of a particle aged `age` of `life` seconds; `edge` is its distance to where it must
 * die (the field's end or a wall) as a fraction of the fade distance, 1 or more = far from it.
 */
export function particleAlpha(age: number, life: number, edge: number): number {
  const u = age / life;
  return smooth(0, FADE, u) * (1 - smooth(1 - FADE, 1, u)) * smooth(0, 1, edge);
}
