// The GPU solver's WGSL modules (docs/SOLVER.md), generated per solver from its layout (buffer
// section offsets and the tile are compile-time constants) and its gas model.
//
// Per RK stage, in one compute pass:
//   1. prim:  conserved -> primitive record per cell (section 4)
//   2. ghost: every ghost's primitives from its source cell(s) and BC (section 5)
//   3. (sources, if the solver has a source model: rates and damping per cell, section 8)
//   4. stage: the fused per-tile kernel: tile + 2-cell halo of primitives in workgroup memory,
//      MUSCL slopes (section 6), SLAU2 or wall face fluxes x b_f (section 7), the residual with
//      the pressure/swirl source and the volume sources (sections 8-9), the local time step and
//      beta^2 at stage 1 (section 10), the RK update (tracking or SSP-RK3), and the stage-1
//      density-residual partial sums (section 11).
// Physical time adds a global-dt reduction before the step (lambda, dtFinal) and a clock update
// after it (advanceTime).
//
// Bitwise symmetry: every face flux is computed by one call site (one loop over the tile's i- and
// j-faces) and every slope by one call site, from primitives that are computed once per cell and
// copied (not recomputed) into interface ghosts.
import { GHOST_LAYERS } from '../../reference/solverMesh';
import type { GasModel } from '../../reference/gas';
import type { GpuLayout, Tile } from '../layout';
import { paramsStructWgsl } from '../params';
import { BOUNDARY_WGSL } from './boundary';
import { fluxWgsl, type LimiterKind } from './flux';
import { gasWgsl } from './gas';

export interface KernelOptions {
  readonly gas: GasModel;
  readonly layout: GpuLayout;
  readonly limiter?: LimiterKind;
  /** The stage kernel reads per-cell source rates and damping (4 vec4 per cell). */
  readonly sources?: boolean;
  /** Test only: the stage kernel writes every face flux it computes (2 vec4 per tile face). */
  readonly faceDump?: boolean;
}

/** Workgroup memory of the stage kernel, bytes (WebGPU's default limit is 16384). */
export function stageWorkgroupBytes(t: Tile): number {
  const nt = (t.x + 4) * (t.y + 4);
  const ns = (t.x + 2) * t.y + t.x * (t.y + 2);
  return nt * (16 + 8 + 4) + ns * (16 + 8) + 4 * t.x * t.y;
}

/** Face slots of one tile (i-faces then j-faces): the face-dump stride. */
export function tileFaceSlots(t: Tile): number {
  return (t.x + 1) * t.y + t.x * (t.y + 1);
}

/** The scalar slots after the 2 x nWorkgroups partials of the reduction buffer. */
export const SCALAR = { dt: 0, timeHi: 1, timeLo: 2, count: 4 } as const;

export function reductionLength(layout: GpuLayout): number {
  return 2 * layout.workgroups + SCALAR.count;
}

/** The density-residual L2 of section 11 from the stage kernel's per-tile sums of squares. */
export function residualFromPartials(red: ArrayLike<number>, layout: GpuLayout): number {
  let sum = 0;
  for (let w = 0; w < layout.workgroups; w++) sum += red[w] ?? NaN;
  return Math.sqrt(sum / layout.nCells);
}

/** The physical-mode clock: the compensated sum hi - lo of advanceTime. */
export function timeFromReduction(red: ArrayLike<number>, layout: GpuLayout): number {
  const base = 2 * layout.workgroups;
  return (red[base + SCALAR.timeHi] ?? NaN) - (red[base + SCALAR.timeLo] ?? NaN);
}

function header(o: KernelOptions): string {
  const L = o.layout;
  const r = 2 * L.workgroups;
  return `${paramsStructWgsl()}
@group(0) @binding(0) var<uniform> P: Params;
const CELL_GEO: u32 = ${L.geo.cellGeo}u;
const CELL_B: u32 = ${L.geo.cellB}u;
const FACE: u32 = ${L.geo.face}u;
const EXT_B: u32 = ${L.geo.extB}u;
const BLOCKS: u32 = ${L.topo.blocks}u;
const TILES: u32 = ${L.topo.tiles}u;
const GHOSTS: u32 = ${L.topo.ghosts}u;
const GHOST_LAYERS: i32 = ${GHOST_LAYERS};
const RED_LAMBDA: u32 = ${L.workgroups}u;
const SCALAR_DT: u32 = ${r + SCALAR.dt}u;
const SCALAR_TIME_HI: u32 = ${r + SCALAR.timeHi}u;
const SCALAR_TIME_LO: u32 = ${r + SCALAR.timeLo}u;
${gasWgsl(o.gas)}`;
}

const TILE_WGSL = (t: Tile) => /* wgsl */ `
const TX: u32 = ${t.x}u;
const TY: u32 = ${t.y}u;
const HX: u32 = TX + 4u;
const HY: u32 = TY + 4u;
const NT: u32 = HX * HY;
const NTH: u32 = TX * TY;
const NSI: u32 = (TX + 2u) * TY;
const NS: u32 = NSI + TX * (TY + 2u);
const NFI: u32 = (TX + 1u) * TY;
const NF: u32 = NFI + TX * (TY + 1u);
const FPT: u32 = (NF + NTH - 1u) / NTH;

// extended index of block-local (gi, gj): the cell, or the ghost there (section 2's table)
fn extIndex(gi: i32, gj: i32, d0: vec4u) -> u32 {
  let ni = i32(d0.y);
  let nj = i32(d0.z);
  if (gi >= 0 && gi < ni && gj >= 0 && gj < nj) { return d0.x + u32(gj * ni + gi); }
  var base: i32;
  var layer: i32;
  var c: i32;
  var n: i32;
  if (gi < 0) { base = 0; layer = -gi; c = gj; n = nj; }
  else if (gi >= ni) { base = GHOST_LAYERS * nj; layer = gi - ni + 1; c = gj; n = nj; }
  else if (gj < 0) { base = 2 * GHOST_LAYERS * nj; layer = -gj; c = gi; n = ni; }
  else { base = 2 * GHOST_LAYERS * nj + GHOST_LAYERS * ni; layer = gj - nj + 1; c = gi; n = ni; }
  return P.nCells + d0.w + u32(base + (layer - 1) * n + c);
}

fn extB(e: u32) -> f32 { return geo[EXT_B + e / 4u][e % 4u]; }

fn spectralRadius(vn: f32, c: f32, beta2: f32) -> f32 {
  let a = abs(vn);
  if (beta2 >= 1.0) { return a + c; }
  let d = 1.0 - beta2;
  return 0.5 * ((1.0 + beta2) * a + sqrt(d * d * a * a + 4.0 * beta2 * c * c));
}

// the cell's lambda of section 10 (face vectors as stored, b-weighted, max per direction)
fn cellLambda(fw: vec4f, fe: vec4f, fs: vec4f, fn_: vec4f, b: vec4f, u: f32, v: f32, c: f32,
              beta2: f32) -> f32 {
  let li = max(b.x * fw.z * spectralRadius(u * fw.x + v * fw.y, c, beta2),
               b.y * fe.z * spectralRadius(u * fe.x + v * fe.y, c, beta2));
  let lj = max(b.z * fs.z * spectralRadius(u * fs.x + v * fs.y, c, beta2),
               b.w * fn_.z * spectralRadius(u * fn_.x + v * fn_.y, c, beta2));
  return li + lj;
}
`;

/** Pass 1: primitives of every cell. Bindings: 1 U (read), 2 prim (rw), 3 geo. */
export function primKernelWgsl(o: KernelOptions): string {
  return `${header(o)}
@group(0) @binding(1) var<storage, read> U: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> prim: array<vec4f>;
@group(0) @binding(3) var<storage, read> geo: array<vec4f>;

@compute @workgroup_size(64)
fn primMain(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= P.nCells) { return; }
  let pr = consToPrim(U[2u * c], U[2u * c + 1u].xy, geo[CELL_GEO + c].x);
  prim[2u * c] = pr.a;
  prim[2u * c + 1u] = pr.b;
}
`;
}

/** Pass 2: ghosts. Bindings: 1 prim (rw), 2 topo. */
export function ghostKernelWgsl(o: KernelOptions): string {
  return `${header(o)}
@group(0) @binding(1) var<storage, read_write> prim: array<vec4f>;
@group(0) @binding(2) var<storage, read> topo: array<vec4u>;
${BOUNDARY_WGSL}`;
}

/**
 * Pass 4: the fused stage kernel. Bindings: 1 U_in, 2 U^n, 3 U_out (rw), 4 prim, 5 geo, 6 topo,
 * 7 reduction (rw), 8 sources (optional), 9 face dump (optional, rw).
 */
export function stageKernelWgsl(o: KernelOptions): string {
  const t = o.layout.tile;
  const src = o.sources === true;
  const dump = o.faceDump === true;
  return `${header(o)}
${fluxWgsl(o.limiter)}
${TILE_WGSL(t)}
@group(0) @binding(1) var<storage, read> Uin: array<vec4f>;
@group(0) @binding(2) var<storage, read> U0: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> Uout: array<vec4f>;
@group(0) @binding(4) var<storage, read> prim: array<vec4f>;
@group(0) @binding(5) var<storage, read> geo: array<vec4f>;
@group(0) @binding(6) var<storage, read> topo: array<vec4u>;
@group(0) @binding(7) var<storage, read_write> red: array<f32>;
@group(0) @binding(10) var<storage, read_write> lo: array<vec4f>;
${src ? '@group(0) @binding(8) var<storage, read> src: array<vec4f>;' : ''}
${dump ? '@group(0) @binding(9) var<storage, read_write> dump: array<vec4f>;' : ''}

var<workgroup> wqa: array<vec4f, NT>;  // rho', u, v, rw
var<workgroup> wqb: array<vec2f, NT>;  // p', Z
var<workgroup> wb: array<f32, NT>;     // b; negative: a slip-wall ghost
var<workgroup> wsa: array<vec4f, NS>;  // slopes, then face fluxes (mass, x-mom, r-mom, ang-mom)
var<workgroup> wsb: array<vec2f, NS>;  // slopes, then face fluxes (eta, rho Z)
var<workgroup> wred: array<f32, NTH>;

// the face states and flux of tile face f (i-faces first): the one call site of SLAU2
fn tileFace(f: u32, i0: i32, j0: i32, d0: vec4u, d1: vec4u) -> Flux {
  let ni = i32(d0.y);
  let nj = i32(d0.z);
  var gi: i32;
  var gj: i32;
  var valid: bool;
  var l: u32;
  var r: u32;
  var sl: u32;
  var sr: u32;
  var face: u32;
  if (f < NFI) {
    let fx = f % (TX + 1u);
    let fy = f / (TX + 1u);
    gi = i0 + i32(fx);
    gj = j0 + i32(fy);
    valid = gi <= ni && gj < nj;
    l = (fy + 2u) * HX + fx + 1u;
    r = l + 1u;
    sl = fy * (TX + 2u) + fx;
    sr = sl + 1u;
    face = d1.x + u32(gj * (ni + 1) + gi);
  } else {
    let k = f - NFI;
    let fx = k % TX;
    let fy = k / TX;
    gi = i0 + i32(fx);
    gj = j0 + i32(fy);
    valid = gi < ni && gj <= nj;
    l = (fy + 1u) * HX + fx + 2u;
    r = l + HX;
    sl = NSI + fy * TX + fx;
    sr = sl + TX;
    face = d1.y + u32(gj * ni + gi);
  }
  if (!valid) { return Flux(vec4f(0.0), vec2f(0.0)); }
  let fd = geo[FACE + face];
  let area = fd.z;
  if (!(area > 0.0)) { return Flux(vec4f(0.0), vec2f(0.0)); }
  let qLa = wqa[l] + 0.5 * wsa[sl];
  let qLb = wqb[l] + 0.5 * wsb[sl];
  let qRa = wqa[r] - 0.5 * wsa[sr];
  let qRb = wqb[r] - 0.5 * wsb[sr];
  let n = fd.xy;
  let bl = wb[l];
  let br = wb[r];
  let bf = 0.5 * (abs(bl) + abs(br));
  var F: Flux;
  if (bl < 0.0 || br < 0.0) {
    // slip wall: only the wall pressure, the interior cell's face value (section 7)
    let pw = select(qLb.x, qRb.x, bl < 0.0);
    F = Flux(area * vec4f(0.0, pw * n.x, pw * n.y, 0.0), vec2f(0.0));
  } else {
    F = slau2(qLa, qLb, qRa, qRb, n, area, fd.w, P.machCut);
  }
  return Flux(bf * F.a, bf * F.b);
}

// SOLVER.md 10's increment update, dU <- dU - (1 - beta^2) (dp / c^2) (1, u, v, rw, Dh0, Z), in an
// algebraically identical but cancellation-free order. With c^2 = cp R T / cv (soundSpeed) and
// cv = cp - R, dp / c^2 = dRho - n with the non-acoustic density increment
//   n = (Y dRho - d eta + u d(rho u) + v d(rho v) + w d(rho r w) / r_c) / (cp T),
//   Y = R T - (R_inf T_inf + (u_inf^2 + q^2) / 2 - De) = R_inf T' + dR T - (u_inf^2 + q^2) / 2 + De,
// and the density increment becomes n + beta^2 (dRho - n). The literal order computes it as
// dRho - (1 - beta^2) dp / c^2, the difference of two numbers equal to within beta^2, which in f32
// leaves a relative error ~1e-7 / beta^2 (2.7e-2 on ladder L8's sink at beta^2 = minMach^2 = 9e-6;
// found by the 12.2 oracle comparison). The other components keep the literal form: their
// preconditioning term is not the dominant part of the increment.
fn preconditionIncrement(da: vec4f, db: vec2f, q: vec4f, z: f32, tP: f32, c: f32, rc: f32,
                         beta2: f32) -> Flux {
  let u = P.uInf + q.y;
  let v = q.z;
  let rw = q.w;
  let w = rw / rc;
  let phi = productsFraction(z);
  let t = P.tInf + tP;
  let cp = cpMix(t, phi);
  let q2 = u * u + v * v + w * w;
  let dRho = da.x;
  let y = P.rInf * tP + gasRDelta(phi) * t - 0.5 * (P.uInf * P.uInf + q2) + deltaE(tP, phi);
  let n = (y * dRho - db.x + u * da.y + v * da.z + (w * da.w) / rc) / (cp * t);
  let m = dRho - n;
  let k = (1.0 - beta2) * m;
  let dh0 = deltaH(tP, phi) + 0.5 * dq2(q.y, v, w);
  return Flux(vec4f(n + beta2 * m, da.y - k * u, da.z - k * v, da.w - k * rw),
              db - k * vec2f(dh0, z));
}

// Neumaier's compensated sum of the six residual components (a: 4, b: 2 in xy): running sums s
// and the accumulated rounding errors c
struct Acc6 { sa: vec4f, sb: vec4f, ca: vec4f, cb: vec4f }
fn neumaier4(s: vec4f, x: vec4f) -> vec4f {
  let t = s + x;
  return select((x - t) + s, (s - t) + x, abs(s) >= abs(x));
}
fn acc6(a: Acc6, xa: vec4f, xb: vec4f) -> Acc6 {
  return Acc6(a.sa + xa, a.sb + xb, a.ca + neumaier4(a.sa, xa), a.cb + neumaier4(a.sb, xb));
}

// U^n+1 = (hi + lo) + d as a compensated sum (Knuth's TwoSum): the new hi and the rounding error
// of hi + (lo + d), carried in lo so that increments below hi's ulp accumulate (SOLVER.md 13)
struct Sum4 { hi: vec4f, lo: vec4f }
fn twoSum4(a: vec4f, b: vec4f) -> Sum4 {
  let s = a + b;
  let bb = s - a;
  return Sum4(s, (a - (s - bb)) + (b - bb));
}

@compute @workgroup_size(TX, TY)
fn stageMain(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let info = topo[TILES + wid.x];
  let d0 = topo[BLOCKS + 2u * info.x];      // cell offset, ni, nj, ghost offset
  let d1 = topo[BLOCKS + 2u * info.x + 1u]; // i-face base, j-face base (in FACE units)
  let ni = i32(d0.y);
  let nj = i32(d0.z);
  let i0 = i32(info.y * TX);
  let j0 = i32(info.z * TY);

  // 1. the tile and its 2-cell halo (no corners): cells, or ghosts after their BCs
  for (var t = lid; t < NT; t += NTH) {
    let gi = i0 + i32(t % HX) - 2;
    let gj = j0 + i32(t / HX) - 2;
    let inI = gi >= 0 && gi < ni;
    let inJ = gj >= 0 && gj < nj;
    let ok = (inI && inJ) || (inJ && gi >= -2 && gi <= ni + 1) || (inI && gj >= -2 && gj <= nj + 1);
    if (ok) {
      let e = extIndex(gi, gj, d0);
      wqa[t] = prim[2u * e];
      wqb[t] = prim[2u * e + 1u].xy;
      wb[t] = extB(e);
    } else {
      wqa[t] = vec4f(0.0);
      wqb[t] = vec2f(0.0);
      wb[t] = 1.0;
    }
  }
  workgroupBarrier();

  // 2. limited slopes: i-direction at positions -1..TX of each row, j-direction likewise
  for (var k = lid; k < NS; k += NTH) {
    var c: u32;
    var st: u32;
    var valid: bool;
    if (k < NSI) {
      let sx = k % (TX + 2u);
      let sy = k / (TX + 2u);
      c = (sy + 2u) * HX + sx + 1u;
      st = 1u;
      valid = i0 + i32(sx) - 1 <= ni && j0 + i32(sy) < nj;
    } else {
      let m = k - NSI;
      let sx = m % TX;
      let sy = m / TX;
      c = (sy + 1u) * HX + sx + 2u;
      st = HX;
      valid = i0 + i32(sx) < ni && j0 + i32(sy) - 1 <= nj;
    }
    var s = Slope(vec4f(0.0), vec2f(0.0));
    if (valid) {
      s = limitedSlopes(wqa[c - st], wqb[c - st], wqa[c], wqb[c], wqa[c + st], wqb[c + st]);
    }
    wsa[k] = s.a;
    wsb[k] = s.b;
  }
  workgroupBarrier();

  // 3. face fluxes (x b_f), kept in registers until every slope has been read
  var fa: array<vec4f, FPT>;
  var fb: array<vec2f, FPT>;
  for (var m = 0u; m < FPT; m++) {
    let f = lid + m * NTH;
    if (f < NF) {
      let F = tileFace(f, i0, j0, d0, d1);
      fa[m] = F.a;
      fb[m] = F.b;
    }
  }
  workgroupBarrier();
  for (var m = 0u; m < FPT; m++) {
    let f = lid + m * NTH;
    if (f < NF) {
      wsa[f] = fa[m];
      wsb[f] = fb[m];
      ${dump ? 'dump[2u * (wid.x * NF + f)] = fa[m]; dump[2u * (wid.x * NF + f) + 1u] = vec4f(fb[m], 0.0, 0.0);' : ''}
    }
  }
  workgroupBarrier();

  // 4. residual, sources, local time step, update
  let tx = lid % TX;
  let ty = lid / TX;
  let gi = i0 + i32(tx);
  let gj = j0 + i32(ty);
  let inside = gi < ni && gj < nj;
  var res0 = 0.0;
  if (inside) {
    let c = d0.x + u32(gj * ni + gi);
    let h = (ty + 2u) * HX + tx + 2u;
    let fw = ty * (TX + 1u) + tx;
    let fs = NFI + ty * TX + tx;
    let q = wqa[h];
    let pz = prim[2u * c + 1u];       // p', Z, T', c
    let cg = geo[CELL_GEO + c];       // r_c, A, V, sum of b S_x over the flow faces
    let cb = geo[CELL_B + c];         // b, b S_x, b S_r, b V
    let rho = P.rhoInf + q.x;
    let uc = P.uInf + q.y;
    let w = q.w / cg.x;
    // R = sum of the outward face fluxes - the pressure/swirl source - the volume sources, as a
    // compensated (Neumaier) sum per component (SOLVER.md 13). The face fluxes are gauge flux
    // differences F - F_inf(S); the free stream's part of the flow faces comes back as
    // F_inf(sum of b S over the flow faces) = (rho_inf u_inf, rho_inf u_inf^2) cg.w.
    let mInf = P.rhoInf * P.uInf;
    var acc = Acc6(-wsa[fw], -vec4f(wsb[fw], 0.0, 0.0), vec4f(0.0), vec4f(0.0));
    acc = acc6(acc, wsa[fw + 1u], vec4f(wsb[fw + 1u], 0.0, 0.0));
    acc = acc6(acc, -wsa[fs], -vec4f(wsb[fs], 0.0, 0.0));
    acc = acc6(acc, wsa[fs + TX], vec4f(wsb[fs + TX], 0.0, 0.0));
    acc = acc6(acc, vec4f(mInf * cg.w, (mInf * P.uInf) * cg.w, 0.0, 0.0), vec4f(0.0));
    acc = acc6(acc, -vec4f(0.0, pz.x * cb.y, pz.x * cb.z + cb.x * rho * w * w * cg.y, 0.0),
               vec4f(0.0));
    var da = vec4f(0.0);
    var db = vec2f(0.0);
    ${
      src
        ? `acc = acc6(acc, -cb.w * src[4u * c], -cb.w * vec4f(src[4u * c + 1u].xy, 0.0, 0.0));
    da = src[4u * c + 2u];
    db = src[4u * c + 3u].xy;`
        : ''
    }
    let ra = acc.sa + acc.ca;
    let rb = (acc.sb + acc.cb).xy;
    res0 = ra.x / cb.w;
    let ua = Uin[2u * c];
    let ub = Uin[2u * c + 1u];
    var outA: vec4f;
    var outB: vec4f;
    if (P.mode == 0u) {
      var tau: f32;
      var beta2: f32;
      if (P.stage == 0u) {
        beta2 = 1.0;
        if (P.precondition == 1u) {
          let dpMax = max(max(abs(wqb[h - 1u].x - pz.x), abs(wqb[h + 1u].x - pz.x)),
                          max(abs(wqb[h - HX].x - pz.x), abs(wqb[h + HX].x - pz.x)));
          let c2 = pz.w * pz.w;
          beta2 = min(1.0, max(max((uc * uc + q.z * q.z + w * w) / c2, P.minMach2),
                               dpMax / (rho * c2)));
        }
        let bc = abs(wb[h]);
        let bfs = 0.5 * vec4f(bc + abs(wb[h - 1u]), bc + abs(wb[h + 1u]),
                              bc + abs(wb[h - HX]), bc + abs(wb[h + HX]));
        let iw = d1.x + u32(gj * (ni + 1) + gi);
        let js = d1.y + u32(gj * ni + gi);
        let lam = cellLambda(geo[FACE + iw], geo[FACE + iw + 1u], geo[FACE + js],
                             geo[FACE + js + u32(ni)], bfs, uc, q.z, pz.w, beta2);
        tau = P.cfl / lam;
      } else {
        tau = ub.z;
        beta2 = ub.w;
      }
      let at = P.alpha * tau;
      let adt = P.alpha * (tau * cb.w);
      var d = Flux(-(at * ra) / (1.0 + adt * da), -(at * rb) / (1.0 + adt * db));
      if (beta2 < 1.0) {
        d = preconditionIncrement(d.a, d.b, q, pz.y, pz.z, pz.w, cg.x, beta2);
      }
      let ba = U0[2u * c];
      let bb = U0[2u * c + 1u];
      if (P.stage == 2u) {
        let sa = twoSum4(ba, lo[2u * c] + d.a);
        let sb = twoSum4(vec4f(bb.xy, 0.0, 0.0), lo[2u * c + 1u] + vec4f(d.b, 0.0, 0.0));
        lo[2u * c] = sa.lo;
        lo[2u * c + 1u] = sb.lo;
        outA = sa.hi;
        outB = vec4f(sb.hi.xy, tau, beta2);
      } else {
        outA = ba + d.a;
        outB = vec4f(bb.xy + d.b, tau, beta2);
      }
    } else {
      let dt = red[SCALAR_DT];
      let tau = dt / cb.w;
      // dt L(U^(k-1)) with the point-implicit factor: E(U^(k-1)) = U^(k-1) + inc
      let incA = -(tau * ra) / (1.0 + dt * da);
      let incB = -(tau * rb) / (1.0 + dt * db);
      let ea = ua + incA;
      let eb = ub.xy + incB;
      // U^n+1 = U^n + (1/6) inc_1 + (1/6) inc_2 + (2/3) inc_3 (the Butcher form of SSP-RK3): the
      // low part collects the weighted increments, and stage 3 adds it to U^n compensated
      let la = lo[2u * c] + P.wInc * incA;
      let lb = lo[2u * c + 1u] + vec4f(P.wInc * incB, 0.0, 0.0);
      if (P.stage == 2u) {
        let sa = twoSum4(U0[2u * c], la);
        let sb = twoSum4(vec4f(U0[2u * c + 1u].xy, 0.0, 0.0), lb);
        lo[2u * c] = sa.lo;
        lo[2u * c + 1u] = sb.lo;
        outA = sa.hi;
        outB = vec4f(sb.hi.xy, 0.0, 1.0);
      } else {
        lo[2u * c] = la;
        lo[2u * c + 1u] = lb;
        if (P.stage == 0u) {
          outA = ea;
          outB = vec4f(eb, 0.0, 1.0);
        } else {
          let ba = U0[2u * c];
          let bb = U0[2u * c + 1u];
          outA = P.w0 * ba + P.w1 * ea;
          outB = vec4f(P.w0 * bb.xy + P.w1 * eb, 0.0, 1.0);
        }
      }
    }
    Uout[2u * c] = outA;
    Uout[2u * c + 1u] = outB;
  }

  // 5. the stage-1 density residual: sum over the tile of (R_rho / (b V))^2 (section 11)
  if (P.stage == 0u) {
    wred[lid] = res0 * res0;
    workgroupBarrier();
    for (var s = ${nextPow2(t.x * t.y) / 2}u; s > 0u; s >>= 1u) {
      if (lid < s && lid + s < NTH) { wred[lid] += wred[lid + s]; }
      workgroupBarrier();
    }
    if (lid == 0u) { red[wid.x] = wred[0]; }
  }
}
`;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Physical time, before a step: min_c (b V / lambda_c) per tile (lambda unpreconditioned, section
 * 10) into red[RED_LAMBDA + wg]. Bindings: 4 prim, 5 geo, 6 topo, 7 reduction (rw).
 */
export function lambdaKernelWgsl(o: KernelOptions): string {
  const t = o.layout.tile;
  return `${header(o)}
${TILE_WGSL(t)}
@group(0) @binding(4) var<storage, read> prim: array<vec4f>;
@group(0) @binding(5) var<storage, read> geo: array<vec4f>;
@group(0) @binding(6) var<storage, read> topo: array<vec4u>;
@group(0) @binding(7) var<storage, read_write> red: array<f32>;

var<workgroup> wmin: array<f32, NTH>;

@compute @workgroup_size(TX, TY)
fn lambdaMain(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let info = topo[TILES + wid.x];
  let d0 = topo[BLOCKS + 2u * info.x];
  let d1 = topo[BLOCKS + 2u * info.x + 1u];
  let ni = i32(d0.y);
  let nj = i32(d0.z);
  let gi = i32(info.y * TX + lid % TX);
  let gj = i32(info.z * TY + lid / TX);
  var v = 3.0e38;
  if (gi < ni && gj < nj) {
    let c = d0.x + u32(gj * ni + gi);
    let qa = prim[2u * c];
    let qb = prim[2u * c + 1u];
    let bc = abs(extB(c));
    let bfs = 0.5 * vec4f(bc + abs(extB(extIndex(gi - 1, gj, d0))),
                          bc + abs(extB(extIndex(gi + 1, gj, d0))),
                          bc + abs(extB(extIndex(gi, gj - 1, d0))),
                          bc + abs(extB(extIndex(gi, gj + 1, d0))));
    let iw = d1.x + u32(gj * (ni + 1) + gi);
    let js = d1.y + u32(gj * ni + gi);
    let lam = cellLambda(geo[FACE + iw], geo[FACE + iw + 1u], geo[FACE + js],
                         geo[FACE + js + u32(ni)], bfs, P.uInf + qa.y, qa.z, qb.w, 1.0);
    v = geo[CELL_B + c].w / lam;
  }
  wmin[lid] = v;
  workgroupBarrier();
  for (var s = ${nextPow2(t.x * t.y) / 2}u; s > 0u; s >>= 1u) {
    if (lid < s && lid + s < NTH) { wmin[lid] = min(wmin[lid], wmin[lid + s]); }
    workgroupBarrier();
  }
  if (lid == 0u) { red[RED_LAMBDA + wid.x] = wmin[0]; }
}
`;
}

/** Physical time: dt = CFL_phys min over the tile minima (one workgroup). Binding 7. */
export function dtKernelWgsl(o: KernelOptions): string {
  return `${header(o)}
@group(0) @binding(7) var<storage, read_write> red: array<f32>;
var<workgroup> wmin: array<f32, 256>;

@compute @workgroup_size(256)
fn dtMain(@builtin(local_invocation_index) lid: u32) {
  var v = 3.0e38;
  for (var k = lid; k < P.nWorkgroups; k += 256u) { v = min(v, red[RED_LAMBDA + k]); }
  wmin[lid] = v;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (lid < s) { wmin[lid] = min(wmin[lid], wmin[lid + s]); }
    workgroupBarrier();
  }
  if (lid == 0u) { red[SCALAR_DT] = P.cflPhysical * wmin[0]; }
}

// after a step: time += dt, compensated (Kahan) so a long run keeps the f32 dt's precision
@compute @workgroup_size(1)
fn advanceTime() {
  let y = red[SCALAR_DT] - red[SCALAR_TIME_LO];
  let hi = red[SCALAR_TIME_HI];
  let t = hi + y;
  red[SCALAR_TIME_LO] = (t - hi) - y;
  red[SCALAR_TIME_HI] = t;
}
`;
}

/** vec4 records per cell of the built-in source model's coefficients. */
export const CELL_SOURCE_VEC4 = 8;

/**
 * The built-in cell source model (section 8), per cell and component, from the stage's state:
 *   rate = rate0 + rho aRho - kU U + s_m (1, u, v, rw, Delta h0, Z),  s_m = -kMass rho
 *   damping = the given d
 * (the last term is massSourceRates: a mass source at the local state, carrying its h0). This
 * covers a constant source, a force density proportional to rho (ladder L9) and a point-implicit
 * sink at the local state (ladder L8). Coefficients, 8 vec4 per cell: rate0 (4), (rate0 (2),
 * kMass, 0), aRho (4), (aRho (2), 0, 0), kU (4), (kU (2), 0, 0), d (4), (d (2), 0, 0).
 * Bindings: 1 U_stage, 2 coefficients, 3 sources (rw), 4 prim, 5 geo.
 */
export function cellSourceKernelWgsl(o: KernelOptions): string {
  return `${header(o)}
@group(0) @binding(1) var<storage, read> U: array<vec4f>;
@group(0) @binding(2) var<storage, read> coef: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> src: array<vec4f>;
@group(0) @binding(4) var<storage, read> prim: array<vec4f>;
@group(0) @binding(5) var<storage, read> geo: array<vec4f>;

@compute @workgroup_size(64)
fn sourceMain(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= P.nCells) { return; }
  let o = ${CELL_SOURCE_VEC4}u * c;
  let qa = prim[2u * c];
  let qb = prim[2u * c + 1u];
  let rho = P.rhoInf + qa.x;
  // kU U on the absolute momentum: the state holds (rho u)' = rho u - rho_inf u_inf
  let ua = U[2u * c] + vec4f(0.0, P.rhoInf * P.uInf, 0.0, 0.0);
  var ra = coef[o] + rho * coef[o + 2u] - coef[o + 4u] * ua;
  var rb = coef[o + 1u].xy + rho * coef[o + 3u].xy - coef[o + 5u].xy * U[2u * c + 1u].xy;
  let kMass = coef[o + 1u].z;
  if (kMass != 0.0) {
    let sm = -kMass * rho;
    let w = qa.w / geo[CELL_GEO + c].x;
    let dh0 = deltaH(qb.z, productsFraction(qb.y)) + 0.5 * dq2(qa.y, qa.z, w);
    ra += vec4f(sm, sm * (P.uInf + qa.y), sm * qa.z, sm * qa.w);
    rb += vec2f(sm * dh0, sm * qb.y);
  }
  src[4u * c] = ra;
  src[4u * c + 1u] = vec4f(rb, 0.0, 0.0);
  src[4u * c + 2u] = coef[o + 6u];
  src[4u * c + 3u] = vec4f(coef[o + 7u].xy, 0.0, 0.0);
}
`;
}

/**
 * Test probes of the device functions (no solver state), 4 vec4 in and 4 vec4 out per record:
 * - probeFlux: in (L.a), (L.p', L.Z, n_x, n_r), (R.a), (R.p', R.Z, area, r_f); out SLAU2 (a), (b).
 * - probeGas: in (U.a), (eta, rho Z, r_c, T'), (Z, 0, 0, 0), (x, y, tau, 0); out the primitive
 *   record (a), (b); (temperatureGauge(deltaE(T')), deltaE(T'), deltaH(T'), cp(T_inf + T'));
 *   (log1p x, expm1 y, entropyDelta(T_inf, tau), enthalpyDelta(T_inf, tau)).
 * - probeSlope: in m.a, c.a, p.a, (m.p', c.p', p.p', 0) (Z = 0); out the slopes (a), (b), and
 *   vanAlbada(m.a, c.a), vanAlbada(-c.a, -m.a) (odd and symmetric: the negation of the first).
 * Bindings: 1 in, 2 out (rw).
 */
export function probeKernelWgsl(o: KernelOptions): string {
  return `${header(o)}
${fluxWgsl(o.limiter)}
@group(0) @binding(1) var<storage, read> pin: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> pout: array<vec4f>;

@compute @workgroup_size(64)
fn probeFlux(@builtin(global_invocation_id) gid: vec3u) {
  let k = gid.x;
  if (k >= arrayLength(&pin) / 4u) { return; }
  let la = pin[4u * k];
  let lb = pin[4u * k + 1u];
  let ra = pin[4u * k + 2u];
  let rb = pin[4u * k + 3u];
  let F = slau2(la, lb.xy, ra, rb.xy, lb.zw, rb.z, rb.w, P.machCut);
  pout[4u * k] = F.a;
  pout[4u * k + 1u] = vec4f(F.b, 0.0, 0.0);
}

@compute @workgroup_size(64)
fn probeGas(@builtin(global_invocation_id) gid: vec3u) {
  let k = gid.x;
  if (k >= arrayLength(&pin) / 4u) { return; }
  let ua = pin[4u * k];
  let ub = pin[4u * k + 1u];
  let pr = consToPrim(ua, ub.xy, ub.z);
  let phi = productsFraction(pin[4u * k + 2u].x);
  let de = deltaE(ub.w, phi);
  pout[4u * k] = pr.a;
  pout[4u * k + 1u] = pr.b;
  pout[4u * k + 2u] = vec4f(temperatureGauge(de, phi), de, deltaH(ub.w, phi),
                            cpMix(P.tInf + ub.w, phi));
  let x = pin[4u * k + 3u];
  pout[4u * k + 3u] = vec4f(log1pf(x.x), expm1f(x.y), entropyDelta(P.tInf, x.z, phi),
                            enthalpyDelta(P.tInf, x.z, phi));
}

@compute @workgroup_size(64)
fn probeSlope(@builtin(global_invocation_id) gid: vec3u) {
  let k = gid.x;
  if (k >= arrayLength(&pin) / 4u) { return; }
  let ma = pin[4u * k];
  let ca = pin[4u * k + 1u];
  let pa = pin[4u * k + 2u];
  let pp = pin[4u * k + 3u];
  let s = limitedSlopes(ma, vec2f(pp.x, 0.0), ca, vec2f(pp.y, 0.0), pa, vec2f(pp.z, 0.0));
  pout[4u * k] = s.a;
  pout[4u * k + 1u] = vec4f(s.b, 0.0, 0.0);
  pout[4u * k + 2u] = vanAlbada4(ma, ca);
  pout[4u * k + 3u] = vanAlbada4(-ca, -ma);
}
`;
}

/**
 * The render resample (contracts flow.ts, D0-4): per texel, the primitives of up to four cells
 * (resampleMap.ts) interpolated into the state texture ((p - p_inf)/p_inf, (rho - rho_inf)/rho_inf,
 * T, Z) and the velocity texture (u_x, u_r, u_theta, fluid fraction). A texel with no cell gets
 * the exact ambient: (0, 0, T_inf, 0) and (u_inf, 0, 0, 0). Bindings: 1 prim, 2 geo, 3 map (2 vec4u
 * per texel: cells, bits of (w0, w1, w2, fluid fraction)), 4 state texture, 5 velocity texture.
 */
export function resampleKernelWgsl(o: KernelOptions): string {
  return `${header(o)}
@group(0) @binding(1) var<storage, read> prim: array<vec4f>;
@group(0) @binding(2) var<storage, read> geo: array<vec4f>;
@group(0) @binding(3) var<storage, read> map: array<vec4u>;
@group(0) @binding(4) var outState: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outVel: texture_storage_2d<rgba16float, write>;

const NO_CELL: u32 = 0xffffffffu;

@compute @workgroup_size(8, 8)
fn resampleMain(@builtin(global_invocation_id) g: vec3u) {
  let size = textureDimensions(outState);
  if (g.x >= size.x || g.y >= size.y) { return; }
  let t = g.y * size.x + g.x;
  let cells = map[2u * t];
  let wb = map[2u * t + 1u];
  let w = vec4f(bitcast<f32>(wb.x), bitcast<f32>(wb.y), bitcast<f32>(wb.z), 0.0);
  let fluid = bitcast<f32>(wb.w);
  if (cells.x == NO_CELL) {
    textureStore(outState, g.xy, vec4f(0.0, 0.0, P.tInf, 0.0));
    textureStore(outVel, g.xy, vec4f(P.uInf, 0.0, 0.0, 0.0));
    return;
  }
  let ws = vec4f(w.x, w.y, w.z, 1.0 - (w.x + w.y + w.z));
  var a = vec4f(0.0);  // rho', u, v, w
  var b = vec4f(0.0);  // p', Z, T', 0
  for (var k = 0u; k < 4u; k++) {
    let c = cells[k];
    let wk = ws[k];
    if (wk != 0.0 && c != NO_CELL) {
      let qa = prim[2u * c];
      let qb = prim[2u * c + 1u];
      a += wk * vec4f(qa.x, qa.y, qa.z, qa.w / geo[CELL_GEO + c].x);
      b += wk * vec4f(qb.x, qb.y, qb.z, 0.0);
    }
  }
  textureStore(outState, g.xy, vec4f(b.x / P.pInf, a.x / P.rhoInf, P.tInf + b.z, b.y));
  textureStore(outVel, g.xy, vec4f(P.uInf + a.y, a.z, a.w, fluid));
}
`;
}
