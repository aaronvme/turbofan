// The GPU particles' compute kernels (w2/flowviz round 2) and their TS mirror. The WGSL is the
// TS of src/flow/viz/particles.ts and seeding.ts line for line, so tests/gpu/flowParticles.test.ts
// can step both on the same field and compare: the advection (midpoint RK2 in x, r, theta),
// the bilinear field sample with the axis mirror of sampleCpuField (u_r and u_theta odd), the
// respawns (the PCG hash stream and seedParticle), the fades.
//
// One particle is three vec4f (48 B): pos = (x, r, theta, age), aux = (life, alpha, 0, 0),
// vel = (3D velocity, |u|), m/s. Age < 0: not born yet (staggered starts, no birth wave).
// A second kernel takes the density gradient of the field once per frame for the schlieren
// and the heat haze: (d g/dx, d g/dr, g, fluid fraction), g = (rho - rho_inf) / rho_inf (D0-4).

import type { CpuFieldTextures, FieldExtent } from '../../contracts/flow';
import { fromHalfBits, toHalfBits } from '../../contracts/half';
import {
  advectSubstepped,
  FADE,
  FADE_IN_MAX_S,
  MIN_FLUID,
  particleAlpha,
  type MeridionalSampler,
  type SeedZone,
} from './particles';
import { edgeFactor, EDGE_FADE_M, hashRng, respawnSeed, SPEED_FADE, speedFade } from './seeding';

export const PARTICLE_FLOATS = 12;
export const PARTICLE_BYTES = 4 * PARTICLE_FLOATS;
export const PARTICLE_WORKGROUP = 64;
export const MAX_SEED_ZONES = 4;
export const PARTICLE_PARAMS_BYTES = 160;
/**
 * W2V-I4: the most midpoint substeps one particle takes per frame, each at most one texel. 128 x
 * 6.8 mm covers the panel's fastest x1/10 at 60 Hz up to 525 m/s (the core jet is ~450); beyond
 * it a tracer falls behind the flow instead of tunnelling through a wall.
 */
export const MAX_SUBSTEPS = 128;

/** The substep length: the extent's smaller texel side, m. */
export function substepCellM(e: FieldExtent): number {
  return Math.min((e.xMax - e.xMin) / e.width, (e.rMax - e.rMin) / e.height);
}

export interface ParticleParams {
  readonly extent: FieldExtent;
  /** Simulated seconds this frame (dilated): the advection step. */
  readonly dtSimS: number;
  /** Wall seconds this frame: the ageing. */
  readonly dtWallS: number;
  /** Life of a particle, wall s: lifeMin + lifeSpan u. */
  readonly lifeMinS: number;
  readonly lifeSpanS: number;
  readonly count: number;
  readonly frame: number;
  readonly zones: readonly SeedZone[];
}

/** The kernel's uniform block (layout in the WGSL `Params` below). */
export function packParticleParams(p: ParticleParams): ArrayBuffer {
  if (p.zones.length === 0 || p.zones.length > MAX_SEED_ZONES)
    throw new Error(`particles: 1..${MAX_SEED_ZONES} seed zones, got ${p.zones.length}`);
  const buf = new ArrayBuffer(PARTICLE_PARAMS_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const e = p.extent;
  f.set([e.xMin, e.xMax, e.rMin, e.rMax], 0);
  f.set([e.width, e.height, EDGE_FADE_M, substepCellM(e)], 4);
  f.set([p.dtSimS, p.dtWallS, p.lifeMinS, p.lifeSpanS], 8);
  f.set([SPEED_FADE[0], SPEED_FADE[1], MAX_SUBSTEPS, MIN_FLUID], 12);
  u.set([p.count, p.frame >>> 0, p.zones.length, 0], 16);
  p.zones.forEach((z, k) => {
    f.set([z.x0, z.x1, z.r0, z.r1], 20 + 4 * k);
    f[36 + k] = z.weight;
  });
  return buf;
}

const AXIS_R = 1e-4;

export function particleKernelWgsl(): string {
  return /* wgsl */ `
struct Params {
  ext: vec4f,    // xMin, xMax, rMin, rMax
  tex: vec4f,    // width, height, edge fade m, substep cell m
  time: vec4f,   // dt sim, dt wall, life min, life span
  fade: vec4f,   // speed fade from, to, max substeps, min fluid
  counts: vec4u, // count, frame, zones, 0
  zones: array<vec4f, ${MAX_SEED_ZONES}>, // x0, x1, r0, r1
  weights: vec4f,
}
struct Particle { pos: vec4f, aux: vec4f, vel: vec4f }

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var velTex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> parts: array<Particle>;

const PI = 3.14159265358979;
const TWO_PI = 6.28318530717959;
const AXIS_R = ${AXIS_R};
const FADE = ${FADE};
const FADE_IN_MAX_S = ${FADE_IN_MAX_S};

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
var<private> rngState: u32;
fn rnd() -> f32 {
  rngState = pcg(rngState);
  return f32(rngState >> 8u) / 16777216.0;
}

// texel (i, j) of the velocity: clamp to edge, the ghost row below the axis mirrored (odd u_r, u_theta)
fn fetchV(i: i32, j: i32) -> vec4f {
  let w = i32(P.tex.x);
  let h = i32(P.tex.y);
  var row = j;
  var odd = 1.0;
  if (row < 0) {
    row = -1 - row;
    odd = -1.0;
  }
  row = clamp(row, 0, h - 1);
  let v = textureLoad(velTex, vec2i(clamp(i, 0, w - 1), row), 0);
  return vec4f(v.x, odd * v.y, odd * v.z, v.w);
}

// (u_x, u_r, u_theta, fluid) at (x, r); fluid = -1 outside the field
fn sampleV(x: f32, r: f32) -> vec4f {
  if (x < P.ext.x || x > P.ext.y || r < P.ext.z || r > P.ext.w) {
    return vec4f(0.0, 0.0, 0.0, -1.0);
  }
  let fx = (x - P.ext.x) / (P.ext.y - P.ext.x) * P.tex.x - 0.5;
  let fr = (r - P.ext.z) / (P.ext.w - P.ext.z) * P.tex.y - 0.5;
  let i0 = i32(floor(fx));
  let j0 = i32(floor(fr));
  let tx = fx - floor(fx);
  let tr = fr - floor(fr);
  let a = fetchV(i0, j0) + tx * (fetchV(i0 + 1, j0) - fetchV(i0, j0));
  let b = fetchV(i0, j0 + 1) + tx * (fetchV(i0 + 1, j0 + 1) - fetchV(i0, j0 + 1));
  return a + tr * (b - a);
}

fn alive(v: vec4f) -> bool { return v.w >= P.fade.w; }

fn smooth01(e0: f32, e1: f32, v: f32) -> f32 {
  let t = clamp((v - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@compute @workgroup_size(${PARTICLE_WORKGROUP})
fn particleMain(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.counts.x) { return; }
  let p = parts[i];
  let dt = P.time.x;
  var age = p.pos.w + P.time.y;
  var x = p.pos.x;
  var r = p.pos.y;
  var th = p.pos.z;
  var life = p.aux.x;
  var respawn = false;
  if (p.pos.w < 0.0) {
    if (age < 0.0) {
      parts[i].pos.w = age;
      parts[i].aux.y = 0.0;
      return;
    }
    respawn = true;
  } else if (age >= life) {
    respawn = true;
  } else {
    // W2V-I4: midpoint substeps of at most one texel each (particles.ts advectSubstepped)
    var v = sampleV(x, r);
    var left = dt;
    let maxSub = u32(P.fade.z);
    if (!alive(v)) { respawn = true; }
    for (var k = 0u; k < maxSub && left > 0.0 && !respawn; k++) {
      let um = length(v.xy);
      var n = 1.0;
      if (um * left > P.tex.w) { n = ceil(um * left / P.tex.w); }
      let h = left / n;
      let mx = x + 0.5 * h * v.x;
      let mrs = r + 0.5 * h * v.y;
      let mr = abs(mrs);
      let v1 = sampleV(mx, mr);
      if (!alive(v1)) {
        respawn = true;
      } else {
        // the odd extension across the axis (W2V-N12): u_r changes sign, u_theta / r does not
        let ur = select(v1.y, -v1.y, mrs < 0.0);
        x = x + h * v1.x;
        r = r + h * ur;
        th = th + h * v1.z / max(mr, AXIS_R);
        if (r < 0.0) {
          r = -r;
          th = th + PI;
        }
        left = left - h;
        v = sampleV(x, r);
        if (!alive(v)) { respawn = true; }
      }
    }
  }
  if (respawn) {
    rngState = pcg((i * 0x9e3779b9u) ^ pcg(P.counts.y));
    var total = 0.0;
    for (var k = 0u; k < P.counts.z; k++) { total += P.weights[k]; }
    var pick = rnd() * total;
    var zone = P.zones[P.counts.z - 1u];
    for (var k = 0u; k < P.counts.z; k++) {
      if (pick < P.weights[k]) {
        zone = P.zones[k];
        break;
      }
      pick -= P.weights[k];
    }
    x = zone.x + rnd() * (zone.y - zone.x);
    r = sqrt(zone.z * zone.z + rnd() * (zone.w * zone.w - zone.z * zone.z));
    th = TWO_PI * rnd();
    life = P.time.z + P.time.w * rnd();
    age = 0.0;
  }
  th = th - TWO_PI * floor((th + PI) / TWO_PI);
  let v = sampleV(x, r);
  let c = cos(th);
  let s = sin(th);
  let v3 = vec3f(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
  let speed = length(v3);
  let u = age / life;
  let edge = clamp(min(P.ext.y - x, P.ext.w - r) / P.tex.z, 0.0, 1.0);
  let fadeIn = min(FADE * life, FADE_IN_MAX_S);
  var alpha = smooth01(0.0, fadeIn, age) * (1.0 - smooth01(1.0 - FADE, 1.0, u)) * smooth01(0.0, 1.0, edge);
  alpha = alpha * smooth01(P.fade.x, P.fade.y, speed) * select(0.0, 1.0, alive(v));
  parts[i] = Particle(vec4f(x, r, th, age), vec4f(life, alpha, 0.0, 0.0), vec4f(v3, speed));
}
`;
}

/** One particle as the kernel stores it. */
export interface ParticleRecord {
  readonly x: number;
  readonly r: number;
  readonly theta: number;
  readonly age: number;
  readonly life: number;
  readonly alpha: number;
  readonly vel: readonly [number, number, number];
  readonly speed: number;
}

export function readParticle(f: Float32Array, i: number): ParticleRecord {
  const o = PARTICLE_FLOATS * i;
  const g = (k: number) => f[o + k] ?? 0;
  return {
    x: g(0),
    r: g(1),
    theta: g(2),
    age: g(3),
    life: g(4),
    alpha: g(5),
    vel: [g(8), g(9), g(10)],
    speed: g(11),
  };
}

const TWO_PI = 2 * Math.PI;

/** The kernel's step of particle `index`, in f64: the oracle of the Dawn test. */
export function stepParticle(
  p: ParticleRecord,
  index: number,
  params: ParticleParams,
  sample: MeridionalSampler,
): ParticleRecord {
  let age = p.age + params.dtWallS;
  if (p.age < 0 && age < 0) return { ...p, age, alpha: 0 };
  let state: { x: number; r: number; theta: number } | null = null;
  let life = p.life;
  if (p.age >= 0 && age < life)
    state = advectSubstepped(p, params.dtSimS, sample, substepCellM(params.extent), MAX_SUBSTEPS);
  if (state === null) {
    const rng = hashRng(respawnSeed(index, params.frame) >>> 0);
    // respawnSeed is pcg(i * phi ^ pcg(frame)); hashRng's first draw hashes it once more, as
    // the kernel's rnd() does on rngState
    const z = seedZoneDraw(rng, params.zones);
    state = z;
    life = params.lifeMinS + params.lifeSpanS * rng();
    age = 0;
  }
  const theta = state.theta - TWO_PI * Math.floor((state.theta + Math.PI) / TWO_PI);
  const v = sample(state.x, state.r);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const vel: [number, number, number] =
    v === null ? [0, 0, 0] : [v.ux, v.ur * c - v.ut * s, v.ur * s + v.ut * c];
  const speed = Math.hypot(...vel);
  const ok = v !== null && v.fluid >= MIN_FLUID;
  const alpha =
    particleAlpha(age, life, edgeFactor(state.x, state.r, params.extent)) *
    speedFade(speed) *
    (ok ? 1 : 0);
  return { x: state.x, r: state.r, theta, age, life, alpha, vel, speed };
}

/** seedParticle's draws in the kernel's order (zone, x, r, theta). */
function seedZoneDraw(
  rng: () => number,
  zones: readonly SeedZone[],
): { x: number; r: number; theta: number } {
  const total = zones.reduce((t, z) => t + z.weight, 0);
  let pick = rng() * total;
  let zone = zones[zones.length - 1];
  for (const z of zones) {
    if (pick < z.weight) {
      zone = z;
      break;
    }
    pick -= z.weight;
  }
  if (zone === undefined) throw new Error('stepParticle: no zones');
  const x = zone.x0 + rng() * (zone.x1 - zone.x0);
  const r = Math.sqrt(zone.r0 ** 2 + rng() * (zone.r1 ** 2 - zone.r0 ** 2));
  return { x, r, theta: TWO_PI * rng() };
}

/** Particles not yet born, their starts spread over `spreadS` (no birth wave), seeded. */
export function initialParticles(count: number, spreadS: number, seed = 1): Float32Array {
  const f = new Float32Array(PARTICLE_FLOATS * count);
  const rng = hashRng(seed);
  for (let i = 0; i < count; i++) f[PARTICLE_FLOATS * i + 3] = -spreadS * rng() - 1e-6;
  return f;
}

export const GRADIENT_WORKGROUP = 8;

/**
 * The density-gradient kernel: (d g/dx, d g/dr, g, fluid) per texel, 1/m, central differences
 * (one-sided at the x ends; across the axis g is even, so row -1 is row 0), zero across walls
 * (a solid texel's values are unspecified, D0-4).
 */
export function gradientKernelWgsl(): string {
  return /* wgsl */ `
@group(0) @binding(0) var stateTex: texture_2d<f32>;
@group(0) @binding(1) var velTex: texture_2d<f32>;
@group(0) @binding(2) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> G: vec4f; // 1/dx, 1/dr, width, height

fn g(i: i32, j: i32) -> vec2f {
  let w = i32(G.z);
  let h = i32(G.w);
  let q = vec2i(clamp(i, 0, w - 1), clamp(select(j, -1 - j, j < 0), 0, h - 1));
  return vec2f(textureLoad(stateTex, q, 0).y, textureLoad(velTex, q, 0).w);
}

@compute @workgroup_size(${GRADIENT_WORKGROUP}, ${GRADIENT_WORKGROUP})
fn gradientMain(@builtin(global_invocation_id) gid: vec3u) {
  let w = i32(G.z);
  let h = i32(G.w);
  let i = i32(gid.x);
  let j = i32(gid.y);
  if (i >= w || j >= h) { return; }
  let c = g(i, j);
  let xm = g(max(i - 1, 0), j);
  let xp = g(min(i + 1, w - 1), j);
  let rm = g(i, j - 1);
  let rp = g(i, min(j + 1, h - 1));
  let spanX = f32(min(i + 1, w - 1) - max(i - 1, 0));
  let spanR = f32(min(j + 1, h - 1) - (j - 1));
  let wallX = min(min(xm.y, xp.y), c.y) < 0.5;
  let wallR = min(min(rm.y, rp.y), c.y) < 0.5;
  let gx = select((xp.x - xm.x) * G.x / spanX, 0.0, wallX);
  let gr = select((rp.x - rm.x) * G.y / spanR, 0.0, wallR);
  textureStore(outTex, vec2i(i, j), vec4f(gx, gr, c.x, c.y));
}
`;
}

/**
 * The gradient kernel in TS (the oracle of the schlieren and haze march, W2V-I3): (d g/dx,
 * d g/dr, g, fluid) per texel, 1/m, from a CPU field's f16 texels, rounded to f16 as the kernel's
 * rgba16float target stores it.
 */
export function densityGradientRaster(field: CpuFieldTextures): Float32Array {
  const e = field.extent;
  const w = e.width;
  const h = e.height;
  const idx = (i: number, j: number) => {
    const jj = Math.min(h - 1, Math.max(0, j < 0 ? -1 - j : j));
    return 4 * (jj * w + Math.min(w - 1, Math.max(0, i)));
  };
  const g = (i: number, j: number) => fromHalfBits(field.state[idx(i, j) + 1] ?? 0);
  const fl = (i: number, j: number) => fromHalfBits(field.velocity[idx(i, j) + 3] ?? 0);
  const invDx = w / (e.xMax - e.xMin);
  const invDr = h / (e.rMax - e.rMin);
  const f16 = (v: number) => fromHalfBits(toHalfBits(v));
  const out = new Float32Array(4 * w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const im = Math.max(i - 1, 0);
      const ip = Math.min(i + 1, w - 1);
      const jp = Math.min(j + 1, h - 1);
      const c = fl(i, j);
      const wallX = Math.min(fl(im, j), fl(ip, j), c) < 0.5;
      const wallR = Math.min(fl(i, j - 1), fl(i, jp), c) < 0.5;
      const gx = wallX ? 0 : ((g(ip, j) - g(im, j)) * invDx) / (ip - im);
      const gr = wallR ? 0 : ((g(i, jp) - g(i, j - 1)) * invDr) / (jp - (j - 1));
      out.set([f16(gx), f16(gr), f16(g(i, j)), f16(c)], 4 * (j * w + i));
    }
  }
  return out;
}

/** A bilinear, clamp-to-edge sample of the gradient raster at (x, r): the march's sampler. */
export function sampleGradientRaster(
  raster: Float32Array,
  e: FieldExtent,
  x: number,
  r: number,
): { gx: number; gr: number; g: number; fluid: number } {
  const fx = ((x - e.xMin) / (e.xMax - e.xMin)) * e.width - 0.5;
  const fr = ((r - e.rMin) / (e.rMax - e.rMin)) * e.height - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fr);
  const tx = Math.min(1, Math.max(0, fx - i0));
  const tr = Math.min(1, Math.max(0, fr - j0));
  const at = (i: number, j: number, c: number) =>
    raster[
      4 *
        (Math.min(e.height - 1, Math.max(0, j)) * e.width + Math.min(e.width - 1, Math.max(0, i))) +
        c
    ] ?? 0;
  const lerp = (c: number) => {
    const a = at(i0, j0, c) + tx * (at(i0 + 1, j0, c) - at(i0, j0, c));
    const b = at(i0, j0 + 1, c) + tx * (at(i0 + 1, j0 + 1, c) - at(i0, j0 + 1, c));
    return a + tr * (b - a);
  };
  return { gx: lerp(0), gr: lerp(1), g: lerp(2), fluid: lerp(3) };
}
