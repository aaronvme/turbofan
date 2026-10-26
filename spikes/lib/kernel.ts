// WGSL for the representative fused per-RK-stage kernel (spike a). One dispatch per stage;
// three stages per iteration. Data shapes follow the plan's GPU design:
//   state: two array<vec4<f32>> buffers (A, B) x 3 copies (U^n, two stage outputs),
//          A = (rho', rho u, rho v, rho r w), B = (eta, rho Z, dt/V, 0);
//   tile:  TX x TY cells + a 2-cell halo of primitives in workgroup memory, face fluxes shared;
//   ghosts: every halo cell outside its block comes from a ghost index map entry
//          (source cell, BC code, outward normal) -> interfaces, axis, wall, far field, outflow.
// Per stage: conserved -> primitive (thermally perfect gas, Newton for T), BCs, MUSCL with the
// van Albada limiter on i- and j-faces with a first-order positivity fallback, SLAU2 fluxes,
// the axisymmetric source, local dt (stage 1), RK update.
//
// How this differs from the final W2 kernel is listed in docs/GPU_FACTS.md (spike a).

import { AIR, PRODUCTS, T_MID, type Poly } from './gas';
import type { Tile } from './mesh';

export const TILES: readonly Tile[] = [
  { x: 16, y: 8 },
  { x: 8, y: 8 },
  { x: 32, y: 4 },
];

/** 3-stage RK for upwind second-order schemes (van Leer, Tai & Powell, AIAA 89-1933). */
export const RK3_ALPHA: readonly [number, number, number] = [0.1918, 0.4929, 1.0];

export const PARAMS_BYTES = 80;

export interface StageParams {
  readonly rhoInf: number;
  readonly pInf: number;
  readonly uInf: number;
  readonly vInf: number;
  readonly h0Inf: number;
  readonly gasR: number;
  readonly cfl: number;
  readonly alpha: number;
  readonly tInf: number;
  readonly zMix: number;
  readonly gammaInf: number;
  readonly cInf: number;
  readonly eInf: number;
  readonly cvInf: number;
  /** 0, 1, 2. Stage 0 computes the local time step. */
  readonly stage: number;
  readonly wgBase: number;
  readonly ghostBase: number;
}

export function packParams(p: StageParams): ArrayBuffer {
  const buf = new ArrayBuffer(PARAMS_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  f.set([
    p.rhoInf,
    p.pInf,
    p.uInf,
    p.vInf,
    p.h0Inf,
    p.gasR,
    p.cfl,
    p.alpha,
    p.tInf,
    p.zMix,
    p.gammaInf,
    p.cInf,
    p.eInf,
    p.cvInf,
  ]);
  u.set([p.stage, p.wgBase, p.ghostBase], 14);
  return buf;
}

export function workgroupBytes(t: Tile): number {
  const nt = (t.x + 4) * (t.y + 4);
  const faces = (t.x + 1) * t.y + t.x * (t.y + 1);
  return nt * (16 + 8) + faces * (16 + 8);
}

function lit(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : x.toExponential(10);
}

function vec4(c: Poly): string {
  return `vec4f(${c.map(lit).join(', ')})`;
}

const COMMON = /* wgsl */ `
const BC_INTERFACE: u32 = 0u;
const BC_AXIS: u32 = 1u;
const BC_WALL: u32 = 2u;
const BC_FARFIELD: u32 = 3u;
const BC_OUTFLOW: u32 = 4u;

struct Params {
  rhoInf: f32, pInf: f32, uInf: f32, vInf: f32,
  h0Inf: f32, gasR: f32, cfl: f32, alpha: f32,
  tInf: f32, zMix: f32, gammaInf: f32, cInf: f32,
  eInf: f32, cvInf: f32, stage: u32, wgBase: u32,
  ghostBase: u32, pad0: u32, pad1: u32, pad2: u32,
}

@group(0) @binding(0) var<uniform> P: Params;
`;

// Placeholder coefficients (spikes/lib/gas.ts): the arithmetic of the real thermo, not its data.
const GAS = /* wgsl */ `
const T_MID: f32 = ${lit(T_MID)};
const AIR_LO: vec4f = ${vec4(AIR.lo)};
const AIR_HI: vec4f = ${vec4(AIR.hi)};
const PRD_LO: vec4f = ${vec4(PRODUCTS.lo)};
const PRD_HI: vec4f = ${vec4(PRODUCTS.hi)};
const AIR_DHI: f32 = ${lit(AIR.dHi)};
const PRD_DHI: f32 = ${lit(PRODUCTS.dHi)};

// (cp, h) for products mass fraction y. Mixing the coefficients is mixing cp and h.
fn cpH(T: f32, y: f32) -> vec2f {
  let hi = T > T_MID;
  let c = mix(select(AIR_LO, AIR_HI, hi), select(PRD_LO, PRD_HI, hi), y);
  let d = select(0.0, mix(AIR_DHI, PRD_DHI, y), hi);
  let cpR = c.x + T * (c.y + T * (c.z + T * c.w));
  let hR = T * (c.x + T * (c.y * 0.5 + T * (c.z * (1.0 / 3.0) + T * (c.w * 0.25)))) + d;
  return vec2f(cpR, hR) * P.gasR;
}

// T from internal energy: linearised start around the freestream, two Newton steps.
fn tempFromE(e: f32, y: f32) -> f32 {
  var T = P.tInf + (e - P.eInf) / P.cvInf;
  for (var k = 0u; k < 2u; k++) {
    let g = cpH(T, y);
    T -= (g.y - P.gasR * T - e) / (g.x - P.gasR);
  }
  return T;
}
`;

// SLAU2 (Kitamura & Shima 2013); mirrored in f64 by spikes/lib/slau2.ts.
const SLAU2 = /* wgsl */ `
struct Flux { a: vec4f, b: vec2f }

struct Side { rho: f32, vn: f32, q2: f32, c: f32, dh0: f32 }

fn sideOf(q0: vec4f, q1: vec2f, n: vec2f, invR: f32) -> Side {
  let w = q0.w * invR;
  let T = (P.pInf + q1.x) / (q0.x * P.gasR);
  let y = clamp(q1.y * P.zMix, 0.0, 1.0);
  let g = cpH(T, y);
  let gam = g.x / (g.x - P.gasR);
  let q2 = q0.y * q0.y + q0.z * q0.z + w * w;
  return Side(q0.x, q0.y * n.x + q0.z * n.y, q2, sqrt(gam * P.gasR * T), g.y + 0.5 * q2 - P.h0Inf);
}

fn betaPlus(m: f32) -> f32 {
  return select(0.25 * (2.0 - m) * (m + 1.0) * (m + 1.0), 0.5 * (1.0 + sign(m)), abs(m) >= 1.0);
}

fn betaMinus(m: f32) -> f32 {
  return select(0.25 * (2.0 + m) * (m - 1.0) * (m - 1.0), 0.5 * (1.0 - sign(m)), abs(m) >= 1.0);
}

// Face states (rho, u, v, rw), (p', Z); per-radian face vector S; face radius rf.
fn slau2(qL0: vec4f, qL1: vec2f, qR0: vec4f, qR1: vec2f, S: vec2f, rf: f32) -> Flux {
  let area = length(S);
  if (area <= 0.0) { return Flux(vec4f(0.0), vec2f(0.0)); }
  let n = S / area;
  let invR = 1.0 / rf;
  let l = sideOf(qL0, qL1, n, invR);
  let r = sideOf(qR0, qR1, n, invR);
  let cbar = 0.5 * (l.c + r.c);
  let mL = l.vn / cbar;
  let mR = r.vn / cbar;
  let qAvg = sqrt(0.5 * (l.q2 + r.q2));
  let mHat = min(1.0, qAvg / cbar);
  let chi = (1.0 - mHat) * (1.0 - mHat);
  let g = -max(min(mL, 0.0), -1.0) * min(max(mR, 0.0), 1.0);
  let vbar = (l.rho * abs(l.vn) + r.rho * abs(r.vn)) / (l.rho + r.rho);
  let vbarP = (1.0 - g) * vbar + g * abs(l.vn);
  let vbarM = (1.0 - g) * vbar + g * abs(r.vn);
  let mdot = 0.5 * (l.rho * (l.vn + vbarP) + r.rho * (r.vn - vbarM) - (chi / cbar) * (qR1.x - qL1.x));
  let bp = betaPlus(mL);
  let bm = betaMinus(mR);
  let pt = 0.5 * (qL1.x + qR1.x) + 0.5 * (bp - bm) * (qL1.x - qR1.x)
         + qAvg * (bp + bm - 1.0) * 0.5 * (l.rho + r.rho) * cbar;
  let mp = 0.5 * (mdot + abs(mdot));
  let mm = 0.5 * (mdot - abs(mdot));
  let fa = mp * vec4f(1.0, qL0.y, qL0.z, qL0.w) + mm * vec4f(1.0, qR0.y, qR0.z, qR0.w)
         + pt * vec4f(0.0, n.x, n.y, 0.0);
  let fb = mp * vec2f(l.dh0, qL1.y) + mm * vec2f(r.dh0, qR1.y);
  return Flux(fa * area, fb * area);
}
`;

function stageBody(): string {
  return /* wgsl */ `
@group(0) @binding(1) var<storage, read> qinA: array<vec4f>;
@group(0) @binding(2) var<storage, read> qinB: array<vec4f>;
@group(0) @binding(3) var<storage, read> q0A: array<vec4f>;
@group(0) @binding(4) var<storage, read> q0B: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> qoutA: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> qoutB: array<vec4f>;
@group(0) @binding(7) var<storage, read> geo: array<vec4f>;
@group(0) @binding(8) var<storage, read> topo: array<vec4u>;

var<workgroup> sq0: array<vec4f, NT>; // rho, u, v, r w
var<workgroup> sq1: array<vec2f, NT>; // p', Z
var<workgroup> fi0: array<vec4f, NFI>;
var<workgroup> fi1: array<vec2f, NFI>;
var<workgroup> fj0: array<vec4f, NFJ>;
var<workgroup> fj1: array<vec2f, NFJ>;

struct Prim { q0: vec4f, q1: vec2f, c: f32 }

fn toPrim(a: vec4f, b: vec4f, rc: f32) -> Prim {
  let rho = P.rhoInf + a.x;
  let inv = 1.0 / rho;
  let u = a.y * inv;
  let v = a.z * inv;
  let rw = a.w * inv;
  let w = rw / rc;
  let z = b.y * inv;
  let y = clamp(z * P.zMix, 0.0, 1.0);
  let e = (b.x + rho * P.h0Inf - P.pInf) * inv - 0.5 * (u * u + v * v + w * w);
  let T = tempFromE(e, y);
  let g = cpH(T, y);
  let gam = g.x / (g.x - P.gasR);
  return Prim(vec4f(rho, u, v, rw), vec2f(rho * P.gasR * T - P.pInf, z), sqrt(gam * P.gasR * T));
}

// Characteristic far field from the Riemann invariants normal to the boundary (frozen gamma).
fn farField(pr: Prim, n: vec2f) -> Prim {
  let gm1 = P.gammaInf - 1.0;
  let vi = pr.q0.yz;
  let vinf = vec2f(P.uInf, P.vInf);
  let vni = dot(vi, n);
  let vnInf = dot(vinf, n);
  let rp = vni + 2.0 * pr.c / gm1;
  let rm = vnInf - 2.0 * P.cInf / gm1;
  let vnb = 0.5 * (rp + rm);
  let cb = 0.25 * gm1 * (rp - rm);
  let inflow = vnb < 0.0;
  let rhoRef = select(pr.q0.x, P.rhoInf, inflow);
  let pRef = select(P.pInf + pr.q1.x, P.pInf, inflow);
  let s = pRef / pow(rhoRef, P.gammaInf);
  let rhob = pow(cb * cb / (P.gammaInf * s), 1.0 / gm1);
  let pb = rhob * cb * cb / P.gammaInf;
  let vt = select(vi - vni * n, vinf - vnInf * n, inflow);
  let vb = vt + vnb * n;
  return Prim(vec4f(rhob, vb, select(pr.q0.w, 0.0, inflow)),
              vec2f(pb - P.pInf, select(pr.q1.y, 0.0, inflow)), cb);
}

fn applyBC(pr: Prim, code: u32, n: vec2f) -> Prim {
  var o = pr;
  switch code {
    case BC_AXIS: { o.q0.z = -o.q0.z; }
    case BC_WALL: {
      let vel = o.q0.yz;
      let vr = vel - 2.0 * dot(vel, n) * n;
      o.q0 = vec4f(o.q0.x, vr, o.q0.w);
    }
    case BC_FARFIELD: { o = farField(pr, n); }
    case BC_OUTFLOW: { if (dot(o.q0.yz, n) < pr.c) { o.q1.x = 0.0; } }
    default: {}
  }
  return o;
}

fn ghostSlot(i: i32, j: i32, ni: i32, nj: i32) -> u32 {
  let w = ni + 4;
  if (j < 0) { return u32((j + 2) * w + i + 2); }
  if (j >= nj) { return u32(2 * w + (j - nj) * w + i + 2); }
  if (i < 0) { return u32(4 * w + (i + 2) * nj + j); }
  return u32(4 * w + 2 * nj + (i - ni) * nj + j);
}

fn vanAlbada4(a: vec4f, b: vec4f) -> vec4f {
  let ab = a * b;
  return select(vec4f(0.0), ab * (a + b) / (a * a + b * b + vec4f(1e-30)), ab > vec4f(0.0));
}

fn vanAlbada2(a: vec2f, b: vec2f) -> vec2f {
  let ab = a * b;
  return select(vec2f(0.0), ab * (a + b) / (a * a + b * b + vec2f(1e-30)), ab > vec2f(0.0));
}

// MUSCL on the 4-cell stencil l2 l1 | r1 r2 (workgroup indices), then SLAU2.
fn faceFlux(l2: u32, l1: u32, r1: u32, r2: u32, S: vec2f, rf: f32) -> Flux {
  let a2 = sq0[l2];
  let a1 = sq0[l1];
  let b1 = sq0[r1];
  let b2 = sq0[r2];
  let c2 = sq1[l2];
  let c1 = sq1[l1];
  let d1 = sq1[r1];
  let d2 = sq1[r2];
  var qL0 = a1 + 0.5 * vanAlbada4(a1 - a2, b1 - a1);
  var qR0 = b1 - 0.5 * vanAlbada4(b1 - a1, b2 - b1);
  var qL1 = c1 + 0.5 * vanAlbada2(c1 - c2, d1 - c1);
  var qR1 = d1 - 0.5 * vanAlbada2(d1 - c1, d2 - d1);
  // Positivity fallback: a side whose reconstructed rho or p is not positive goes first order.
  let badL = qL0.x <= 0.0 || P.pInf + qL1.x <= 0.0;
  let badR = qR0.x <= 0.0 || P.pInf + qR1.x <= 0.0;
  qL0 = select(qL0, a1, badL);
  qL1 = select(qL1, c1, badL);
  qR0 = select(qR0, b1, badR);
  qR1 = select(qR1, d1, badR);
  return slau2(qL0, qL1, qR0, qR1, S, rf);
}

@compute @workgroup_size(TX, TY)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let info = topo[P.wgBase + wid.x];   // (block, tile i, tile j, 0)
  let d0 = topo[2u * info.x];          // (cell offset, ni, nj, ghost offset)
  let d1 = topo[2u * info.x + 1u];     // (face slot vec4 base, 0, 0, 0)
  let ni = i32(d0.y);
  let nj = i32(d0.z);
  let i0 = i32(info.y * TX);
  let j0 = i32(info.z * TY);

  // 1. Tile + 2-cell halo -> primitives in workgroup memory. Halo corners are in no stencil.
  for (var t = lid; t < NT; t += NTHREADS) {
    let lx = i32(t % HX);
    let ly = i32(t / HX);
    let coreX = lx >= 2 && lx < i32(TX) + 2;
    let coreY = ly >= 2 && ly < i32(TY) + 2;
    let gi = i0 + lx - 2;
    let gj = j0 + ly - 2;
    if ((!coreX && !coreY) || gi > ni + 1 || gj > nj + 1) { continue; }
    var pr: Prim;
    if (gi >= 0 && gi < ni && gj >= 0 && gj < nj) {
      let c = d0.x + u32(gj * ni + gi);
      pr = toPrim(qinA[c], qinB[c], geo[c].y);
    } else {
      let g = topo[P.ghostBase + d0.w + ghostSlot(gi, gj, ni, nj)];
      pr = applyBC(toPrim(qinA[g.x], qinB[g.x], geo[g.x].y), g.y,
                   vec2f(bitcast<f32>(g.z), bitcast<f32>(g.w)));
    }
    sq0[t] = pr.q0;
    sq1[t] = pr.q1;
  }
  workgroupBarrier();

  // 2. Fluxes through every i-face and j-face of the tile, shared by the two cells.
  for (var f = lid; f < NFI; f += NTHREADS) {
    let fx = f % (TX + 1u);
    let fy = f / (TX + 1u);
    let gi = i0 + i32(fx);
    let gj = j0 + i32(fy);
    var F = Flux(vec4f(0.0), vec2f(0.0));
    if (gi <= ni && gj < nj) {
      let s = d1.x + 2u * u32(gj * (ni + 1) + gi);
      let g0 = geo[s];
      let g1 = geo[s + 1u];
      let row = (fy + 2u) * HX;
      F = faceFlux(row + fx, row + fx + 1u, row + fx + 2u, row + fx + 3u, g0.xy, g1.x);
    }
    fi0[f] = F.a;
    fi1[f] = F.b;
  }
  for (var f = lid; f < NFJ; f += NTHREADS) {
    let fx = f % TX;
    let fy = f / TX;
    let gi = i0 + i32(fx);
    let gj = j0 + i32(fy);
    var F = Flux(vec4f(0.0), vec2f(0.0));
    if (gi < ni && gj <= nj) {
      let s = d1.x + 2u * u32(gj * (ni + 1) + gi);
      let g0 = geo[s];
      let g1 = geo[s + 1u];
      let col = fx + 2u;
      F = faceFlux(fy * HX + col, (fy + 1u) * HX + col, (fy + 2u) * HX + col,
                   (fy + 3u) * HX + col, g0.zw, g1.y);
    }
    fj0[f] = F.a;
    fj1[f] = F.b;
  }
  workgroupBarrier();

  // 3. Residual, axisymmetric source, local time step (stage 1), RK update.
  let tx = lid % TX;
  let ty = lid / TX;
  let gi = i0 + i32(tx);
  let gj = j0 + i32(ty);
  if (gi >= ni || gj >= nj) { return; }
  let c = d0.x + u32(gj * ni + gi);
  let fw = ty * (TX + 1u) + tx;
  let fs = ty * TX + tx;
  var r0 = fi0[fw + 1u] - fi0[fw] + fj0[fs + TX] - fj0[fs];
  let r1 = fi1[fw + 1u] - fi1[fw] + fj1[fs + TX] - fj1[fs];
  let h = (ty + 2u) * HX + tx + 2u;
  let q = sq0[h];
  let pp = sq1[h].x;
  let cg = geo[c];
  let w = q.w / cg.y;
  // Per radian, radial momentum gains (p' + rho w^2) A with A = V / rc. Same gauge p' as the
  // faces: exact for a uniform p' because each cell's faces sum to (0, A).
  r0.z -= (pp + q.x * w * w) * (cg.x / cg.y);
  var dtv: f32; // local dt / V
  if (P.stage == 0u) {
    let s = d1.x + 2u * u32(gj * (ni + 1) + gi);
    let sw = geo[s];
    let se = geo[s + 2u];
    let sn = geo[s + 2u * u32(ni + 1)];
    let si = 0.5 * (sw.xy + se.xy);
    let sj = 0.5 * (sw.zw + sn.zw);
    let T = (P.pInf + pp) / (q.x * P.gasR);
    let g = cpH(T, clamp(sq1[h].y * P.zMix, 0.0, 1.0));
    let cs = sqrt(g.x / (g.x - P.gasR) * P.gasR * T);
    let vel = q.yz;
    let lam = abs(dot(vel, si)) + cs * length(si) + abs(dot(vel, sj)) + cs * length(sj);
    dtv = P.cfl / lam;
  } else {
    dtv = qinB[c].z;
  }
  let k = P.alpha * dtv;
  let a0 = q0A[c];
  let b0 = q0B[c];
  qoutA[c] = a0 - k * r0;
  qoutB[c] = vec4f(b0.xy - k * r1, dtv, 0.0);
}
`;
}

export function stageKernelWgsl(tile: Tile): string {
  const { x, y } = tile;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 2 || y < 2 || x * y > 256) {
    throw new Error(`unsupported tile ${x} x ${y} (need integers >= 2, at most 256 threads)`);
  }
  const header = /* wgsl */ `
const TX: u32 = ${x}u;
const TY: u32 = ${y}u;
const HX: u32 = TX + 4u;
const HY: u32 = TY + 4u;
const NT: u32 = HX * HY;
const NTHREADS: u32 = TX * TY;
const NFI: u32 = (TX + 1u) * TY;
const NFJ: u32 = TX * (TY + 1u);
`;
  return header + COMMON + GAS + SLAU2 + stageBody();
}

/**
 * Test kernel: SLAU2 for a list of faces, using exactly the stage kernel's code. Per face,
 * input 4 vec4: (rho, u, v, rw)_L, (p', Z, Sx, Sr)_L, (rho, u, v, rw)_R, (p', Z, rf, 0)_R;
 * output 2 vec4: flux (mass, x-mom, r-mom, ang-mom), (eta, rho Z, 0, 0).
 */
export function fluxProbeWgsl(): string {
  return (
    COMMON +
    GAS +
    SLAU2 +
    /* wgsl */ `
@group(0) @binding(1) var<storage, read> faces: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> fluxes: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let k = gid.x;
  if (k >= arrayLength(&faces) / 4u) { return; }
  let lA = faces[4u * k];
  let lB = faces[4u * k + 1u];
  let rA = faces[4u * k + 2u];
  let rB = faces[4u * k + 3u];
  let F = slau2(lA, lB.xy, rA, rB.xy, lB.zw, rB.z);
  fluxes[2u * k] = F.a;
  fluxes[2u * k + 1u] = vec4f(F.b, 0.0, 0.0);
}
`
  );
}
