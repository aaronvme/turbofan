// f64 mirror of one iteration (three RK stages) of the WGSL stage kernel, used as the test
// oracle in tests/gpu. Same formulas in the same order: ghost map + BCs on primitives, MUSCL
// with van Albada and the positivity fallback, SLAU2, the per-radian radial source, local dt in
// stage 1, low-storage RK with base U^n.

import { GAS_R, cpH, type Freestream } from './gas';
import { consToPrim, type GaugeContext } from './initial';
import { RK3_ALPHA } from './kernel';
import { BC, cellMetrics, faceVectors, ghostSlot, type Layout, type Nodes } from './mesh';
import { slau2Flux, type FluxPrim } from './slau2';

interface Prim extends FluxPrim {
  readonly c: number;
}

type State = { readonly a: ArrayLike<number>; readonly b: ArrayLike<number> };

function soundSpeed(q: FluxPrim, ctx: GaugeContext): number {
  const T = (ctx.pInf + q.pp) / (q.rho * GAS_R);
  const g = cpH(T, Math.min(1, Math.max(0, q.z * ctx.zMix)));
  return Math.sqrt((g.cp / (g.cp - GAS_R)) * GAS_R * T);
}

function farField(p: Prim, n: readonly [number, number], inf: Freestream): Prim {
  const gm1 = inf.gamma - 1;
  const vni = p.u * n[0] + p.v * n[1];
  const vnInf = inf.u * n[0];
  const rp = vni + (2 * p.c) / gm1;
  const rm = vnInf - (2 * inf.c) / gm1;
  const vnb = 0.5 * (rp + rm);
  const cb = 0.25 * gm1 * (rp - rm);
  const inflow = vnb < 0;
  const rhoRef = inflow ? inf.rho : p.rho;
  const pRef = inflow ? inf.p : inf.p + p.pp;
  const s = pRef / rhoRef ** inf.gamma;
  const rhob = ((cb * cb) / (inf.gamma * s)) ** (1 / gm1);
  const pb = (rhob * cb * cb) / inf.gamma;
  const vt = inflow ? [inf.u - vnInf * n[0], -vnInf * n[1]] : [p.u - vni * n[0], p.v - vni * n[1]];
  return {
    rho: rhob,
    u: (vt[0] ?? 0) + vnb * n[0],
    v: (vt[1] ?? 0) + vnb * n[1],
    rw: inflow ? 0 : p.rw,
    pp: pb - inf.p,
    z: inflow ? 0 : p.z,
    c: cb,
  };
}

function applyBC(p: Prim, code: number, n: readonly [number, number], inf: Freestream): Prim {
  switch (code) {
    case BC.AXIS:
      return { ...p, v: -p.v };
    case BC.WALL: {
      const vn = p.u * n[0] + p.v * n[1];
      return { ...p, u: p.u - 2 * vn * n[0], v: p.v - 2 * vn * n[1] };
    }
    case BC.FARFIELD:
      return farField(p, n, inf);
    case BC.OUTFLOW:
      return p.u * n[0] + p.v * n[1] < p.c ? { ...p, pp: 0 } : p;
    default:
      return p;
  }
}

function vanAlbada(a: number, b: number): number {
  const ab = a * b;
  return ab > 0 ? (ab * (a + b)) / (a * a + b * b + 1e-30) : 0;
}

const KEYS = ['rho', 'u', 'v', 'rw', 'pp', 'z'] as const;

function reconstruct(l2: FluxPrim, l1: FluxPrim, r1: FluxPrim, r2: FluxPrim, pInf: number) {
  const L: Record<(typeof KEYS)[number], number> = { rho: 0, u: 0, v: 0, rw: 0, pp: 0, z: 0 };
  const R = { ...L };
  for (const k of KEYS) {
    L[k] = l1[k] + 0.5 * vanAlbada(l1[k] - l2[k], r1[k] - l1[k]);
    R[k] = r1[k] - 0.5 * vanAlbada(r1[k] - l1[k], r2[k] - r1[k]);
  }
  const badL = L.rho <= 0 || pInf + L.pp <= 0;
  const badR = R.rho <= 0 || pInf + R.pp <= 0;
  return { L: badL ? l1 : L, R: badR ? r1 : R };
}

/** Logical (I, J) of every global cell. */
function cellCoords(layout: Layout): Int32Array {
  const out = new Int32Array(2 * layout.nCells);
  for (const b of layout.blocks) {
    for (let j = 0; j < b.nj; j++) {
      for (let i = 0; i < b.ni; i++) {
        const c = b.cellOffset + j * b.ni + i;
        out[2 * c] = b.i0 + i;
        out[2 * c + 1] = b.j0 + j;
      }
    }
  }
  return out;
}

export function referenceIteration(
  nodes: Nodes,
  layout: Layout,
  ghosts: Uint32Array,
  inf: Freestream,
  ctx: GaugeContext,
  cfl: number,
  initial: State,
): { a: Float64Array; b: Float64Array } {
  const n = layout.nCells;
  const ij = cellCoords(layout);
  const rc = new Float64Array(n);
  const vol = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    const m = cellMetrics(nodes, ij[2 * c] ?? 0, ij[2 * c + 1] ?? 0);
    rc[c] = m.rc;
    vol[c] = m.vol;
  }
  const ghostF32 = new Float32Array(ghosts.buffer, ghosts.byteOffset, ghosts.length);
  const flux = { pInf: ctx.pInf, h0Inf: ctx.h0Inf, zMix: ctx.zMix };

  const base = { a: Float64Array.from(initial.a), b: Float64Array.from(initial.b) };
  const dtv = new Float64Array(n);
  let input: State = base;

  for (let stage = 0; stage < 3; stage++) {
    const prim = (c: number): Prim => {
      const q = consToPrim(
        [
          input.a[4 * c] ?? 0,
          input.a[4 * c + 1] ?? 0,
          input.a[4 * c + 2] ?? 0,
          input.a[4 * c + 3] ?? 0,
        ],
        [input.b[4 * c] ?? 0, input.b[4 * c + 1] ?? 0],
        rc[c] ?? 1,
        ctx,
      );
      return { ...q, c: soundSpeed(q, ctx) };
    };
    const out = { a: new Float64Array(4 * n), b: new Float64Array(4 * n) };

    for (const b of layout.blocks) {
      const at = (i: number, j: number): Prim => {
        if (i >= 0 && i < b.ni && j >= 0 && j < b.nj) return prim(b.cellOffset + j * b.ni + i);
        const k = 4 * (b.ghostOffset + ghostSlot(i, j, b.ni, b.nj));
        const nrm: [number, number] = [ghostF32[k + 2] ?? 0, ghostF32[k + 3] ?? 0];
        return applyBC(prim(ghosts[k] ?? 0), ghosts[k + 1] ?? 0, nrm, inf);
      };
      const iFlux = (i: number, j: number) => {
        const f = faceVectors(nodes, b.i0 + i, b.j0 + j);
        const { L, R } = reconstruct(at(i - 2, j), at(i - 1, j), at(i, j), at(i + 1, j), ctx.pInf);
        return slau2Flux(L, R, f.si, f.rfi, flux);
      };
      const jFlux = (i: number, j: number) => {
        const f = faceVectors(nodes, b.i0 + i, b.j0 + j);
        const { L, R } = reconstruct(at(i, j - 2), at(i, j - 1), at(i, j), at(i, j + 1), ctx.pInf);
        return slau2Flux(L, R, f.sj, f.rfj, flux);
      };

      for (let j = 0; j < b.nj; j++) {
        for (let i = 0; i < b.ni; i++) {
          const c = b.cellOffset + j * b.ni + i;
          const fw = iFlux(i, j);
          const fe = iFlux(i + 1, j);
          const fs = jFlux(i, j);
          const fn = jFlux(i, j + 1);
          const res = fw.map((_, k) => (fe[k] ?? 0) - (fw[k] ?? 0) + (fn[k] ?? 0) - (fs[k] ?? 0));
          const q = at(i, j);
          const r = rc[c] ?? 1;
          const w = q.rw / r;
          res[2] = (res[2] ?? 0) - (q.pp + q.rho * w * w) * ((vol[c] ?? 0) / r);
          if (stage === 0) {
            const W = faceVectors(nodes, b.i0 + i, b.j0 + j);
            const E = faceVectors(nodes, b.i0 + i + 1, b.j0 + j);
            const N = faceVectors(nodes, b.i0 + i, b.j0 + j + 1);
            const si = [0.5 * (W.si[0] + E.si[0]), 0.5 * (W.si[1] + E.si[1])] as const;
            const sj = [0.5 * (W.sj[0] + N.sj[0]), 0.5 * (W.sj[1] + N.sj[1])] as const;
            const lam =
              Math.abs(q.u * si[0] + q.v * si[1]) +
              q.c * Math.hypot(si[0], si[1]) +
              Math.abs(q.u * sj[0] + q.v * sj[1]) +
              q.c * Math.hypot(sj[0], sj[1]);
            dtv[c] = cfl / lam;
          }
          const k = (RK3_ALPHA[stage] ?? Number.NaN) * (dtv[c] ?? 0);
          for (let m = 0; m < 4; m++)
            out.a[4 * c + m] = (base.a[4 * c + m] ?? 0) - k * (res[m] ?? 0);
          out.b[4 * c] = (base.b[4 * c] ?? 0) - k * (res[4] ?? 0);
          out.b[4 * c + 1] = (base.b[4 * c + 1] ?? 0) - k * (res[5] ?? 0);
          out.b[4 * c + 2] = dtv[c] ?? 0;
        }
      }
    }
    input = out;
  }
  return { a: Float64Array.from(input.a), b: Float64Array.from(input.b) };
}
