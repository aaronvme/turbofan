// Conserved <-> primitive conversion with the solver's gauge variables, and initial fields.
//   A = (rho', rho u, rho v, rho r w),  B = (eta, rho Z, dt, 0)
//   rho' = rho - rhoInf,  eta = rho e0 - rho h0Inf + pInf  (= rho (h0 - h0Inf) - p')
// Same relations as the WGSL `toPrim`.

import { GAS_R, cpH, tempFromE, type Freestream } from './gas';
import { cellMetrics, type Layout, type Nodes } from './mesh';
import type { FluxPrim } from './slau2';

export interface GaugeContext {
  readonly rhoInf: number;
  readonly pInf: number;
  readonly h0Inf: number;
  readonly zMix: number;
  readonly tInf: number;
  readonly cvInf: number;
}

/** Products mass fraction per unit fuel-air ratio (stoichiometric FAR ~ 0.068). */
export const Z_MIX = 15;

export function gaugeContext(inf: Freestream, pInf: number, tInf: number): GaugeContext {
  return { rhoInf: inf.rho, pInf, h0Inf: inf.h0, zMix: Z_MIX, tInf, cvInf: inf.cv };
}

type Vec4 = [number, number, number, number];

export function primToCons(q: FluxPrim, rc: number, ctx: GaugeContext): [Vec4, Vec4] {
  const w = q.rw / rc;
  const T = (ctx.pInf + q.pp) / (q.rho * GAS_R);
  const y = Math.min(1, Math.max(0, q.z * ctx.zMix));
  const e = cpH(T, y).h - GAS_R * T;
  const e0 = e + 0.5 * (q.u * q.u + q.v * q.v + w * w);
  return [
    [q.rho - ctx.rhoInf, q.rho * q.u, q.rho * q.v, q.rho * q.rw],
    [q.rho * e0 - q.rho * ctx.h0Inf + ctx.pInf, q.rho * q.z, 0, 0],
  ];
}

export function consToPrim(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  rc: number,
  ctx: GaugeContext,
): FluxPrim {
  const rho = ctx.rhoInf + (a[0] ?? Number.NaN);
  const u = (a[1] ?? Number.NaN) / rho;
  const v = (a[2] ?? Number.NaN) / rho;
  const rw = (a[3] ?? Number.NaN) / rho;
  const z = (b[1] ?? Number.NaN) / rho;
  const w = rw / rc;
  const e =
    ((b[0] ?? Number.NaN) + rho * ctx.h0Inf - ctx.pInf) / rho - 0.5 * (u * u + v * v + w * w);
  const y = Math.min(1, Math.max(0, z * ctx.zMix));
  const T = tempFromE(e, y, ctx.tInf, ctx.cvInf);
  return { rho, u, v, rw, pp: rho * GAS_R * T - ctx.pInf, z };
}

/** Primitive field at a cell's node-average position and centroid radius. */
export type Field = (x: number, r: number) => FluxPrim;

export function initialState(
  nodes: Nodes,
  layout: Layout,
  ctx: GaugeContext,
  field: Field,
): { a: Float32Array; b: Float32Array } {
  const a = new Float32Array(4 * layout.nCells);
  const b = new Float32Array(4 * layout.nCells);
  const nx = nodes.ni + 1;
  for (const blk of layout.blocks) {
    for (let j = 0; j < blk.nj; j++) {
      for (let i = 0; i < blk.ni; i++) {
        const I = blk.i0 + i;
        const J = blk.j0 + j;
        const k = J * nx + I;
        const x =
          0.25 *
          ((nodes.x[k] ?? 0) +
            (nodes.x[k + 1] ?? 0) +
            (nodes.x[k + nx] ?? 0) +
            (nodes.x[k + nx + 1] ?? 0));
        const { rc } = cellMetrics(nodes, I, J);
        const [ca, cb] = primToCons(field(x, rc), rc, ctx);
        const c = blk.cellOffset + j * blk.ni + i;
        a.set(ca, 4 * c);
        b.set(cb, 4 * c);
      }
    }
  }
  return { a, b };
}
