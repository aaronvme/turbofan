// The station reduction (PHYSICS.md 2.2; the coupling's "every ~10 iterations, async readback"):
// mass-averaged Pt and Tt, the mass flow, the area-averaged static pressure and the swirl angle on
// each reduction station's grid line, and the gross thrust over both nozzle exits, from the
// field's primitive records. Pure: the app feeds it a readback of the station cells' primitives,
// the tests the oracle's.
//
// A station is an i-face line of one block (docs/MESH.md "Station map"). Each face's state is the
// mean of the primitives of its two cells (the upstream one alone on a block's last face, the
// nozzle exits), and its mass flux b_f rho (u n_x + v n_r) |S_f| (SOLVER.md 2: per radian, so x 2 pi
// for the annulus). Tt solves h(Tt) - h(T) = q^2 / 2 and Pt = p exp((phi(Tt) - phi(T)) / R) on the
// thermally perfect mixture (SOLVER.md 3).
import type { ReducedStation, StationReduction } from '../../contracts/flow';
import { SOLVER_REDUCTION_STATIONS, type SolverReductionStationId } from '../../contracts/stations';
import {
  cpMix,
  enthalpyDelta,
  entropyDelta,
  gasConstantMix,
  productsFraction,
  type ReferenceState,
} from '../reference/gas';
import type { SolverMesh } from '../reference/solverMesh';
import { NP } from '../reference/state';

export interface StationLine {
  readonly id: string;
  readonly block: number;
  /** Per face (one per j): the i-face index, and the cells on its two sides (-1: none). */
  readonly faces: Int32Array;
  readonly upstream: Int32Array;
  readonly downstream: Int32Array;
}

/** The grid line of every station of the mesh asset. */
export function stationLines(mesh: SolverMesh): StationLine[] {
  return mesh.stations.map((s) => {
    const b = mesh.blocks[s.block];
    if (b === undefined) throw new Error(`stationLines: station ${s.id} names block ${s.block}`);
    const faces = new Int32Array(b.nj);
    const up = new Int32Array(b.nj);
    const down = new Int32Array(b.nj);
    for (let j = 0; j < b.nj; j++) {
      faces[j] = b.iFaceOffset + j * (b.ni + 1) + s.i;
      up[j] = s.i > 0 ? b.cellOffset + j * b.ni + s.i - 1 : -1;
      down[j] = s.i < b.ni ? b.cellOffset + j * b.ni + s.i : -1;
    }
    return { id: s.id, block: s.block, faces, upstream: up, downstream: down };
  });
}

/** Every cell a reduction reads (for a gather readback), sorted, without repeats. */
export function stationCells(lines: readonly StationLine[]): Int32Array {
  const set = new Set<number>();
  for (const l of lines) {
    for (const c of l.upstream) if (c >= 0) set.add(c);
    for (const c of l.downstream) if (c >= 0) set.add(c);
  }
  return Int32Array.from([...set].sort((a, b) => a - b));
}

/** Total temperature rise tau with h(T + tau) - h(T) = dh0 (Newton on cp, from dh0 / cp). */
export function totalTemperatureRise(
  ref: ReferenceState,
  t: number,
  phi: number,
  dh0: number,
): number {
  let tau = dh0 / cpMix(ref.gas, t, phi);
  for (let k = 0; k < 4; k++) {
    tau -= (enthalpyDelta(ref.gas, t, tau, phi) - dh0) / cpMix(ref.gas, t + tau, phi);
  }
  return tau;
}

interface FaceState {
  rho: number;
  u: number;
  v: number;
  w: number;
  p: number;
  t: number;
  z: number;
}

function faceState(
  ref: ReferenceState,
  prim: ArrayLike<number>,
  cellR: ArrayLike<number>,
  a: number,
  b: number,
  out: FaceState,
): void {
  const cells = a >= 0 && b >= 0 ? [a, b] : [a >= 0 ? a : b];
  const g = 1 / cells.length;
  out.rho = out.u = out.v = out.w = out.p = out.t = out.z = 0;
  for (const c of cells) {
    const o = NP * c;
    out.rho += g * (ref.rho + (prim[o] as number));
    out.u += g * (prim[o + 1] as number);
    out.v += g * (prim[o + 2] as number);
    out.w += (g * (prim[o + 3] as number)) / (cellR[c] as number);
    out.p += g * (ref.p + (prim[o + 4] as number));
    out.z += g * (prim[o + 5] as number);
    out.t += g * (ref.t + (prim[o + 6] as number));
  }
}

/** One station's reduction (whole annulus) from the primitive records and the blockage. */
export function reduceStation(
  mesh: SolverMesh,
  ref: ReferenceState,
  line: StationLine,
  prim: ArrayLike<number>,
  blockage: ArrayLike<number>,
): ReducedStation {
  const s: FaceState = { rho: 0, u: 0, v: 0, w: 0, p: 0, t: 0, z: 0 };
  let mdot = 0;
  let pt = 0;
  let tt = 0;
  let swirl = 0;
  let ps = 0;
  let area = 0;
  line.faces.forEach((f, j) => {
    const a = line.upstream[j] as number;
    const b = line.downstream[j] as number;
    faceState(ref, prim, mesh.cellR, a, b, s);
    const ba = a >= 0 ? (blockage[a] as number) : 1;
    const bb = b >= 0 ? (blockage[b] as number) : ba;
    const af = 2 * Math.PI * 0.5 * ((a >= 0 ? ba : bb) + bb) * (mesh.iArea[f] as number);
    const m = s.rho * (s.u * (mesh.iNx[f] as number) + s.v * (mesh.iNr[f] as number)) * af;
    const phi = productsFraction(ref.gas, s.z);
    const tau = totalTemperatureRise(ref, s.t, phi, 0.5 * (s.u * s.u + s.v * s.v + s.w * s.w));
    const p0 = s.p * Math.exp(entropyDelta(ref.gas, s.t, tau, phi) / gasConstantMix(ref.gas, phi));
    mdot += m;
    pt += m * p0;
    tt += m * (s.t + tau);
    swirl += m * Math.atan2(s.w, s.u);
    ps += s.p * af;
    area += af;
  });
  return {
    massFlowKgPerS: mdot,
    ptMassAvgPa: pt / mdot,
    ttMassAvgK: tt / mdot,
    psAreaAvgPa: ps / area,
    swirlAngleMassAvgRad: swirl / mdot,
    areaM2: area,
  };
}

/**
 * Momentum plus pressure thrust through a nozzle-exit line, N: 2 pi sum b_f (m_f u + p' S_x),
 * the field's x-momentum flux less the ambient pressure's (the gross thrust of a static engine).
 */
export function lineThrust(
  mesh: SolverMesh,
  ref: ReferenceState,
  line: StationLine,
  prim: ArrayLike<number>,
  blockage: ArrayLike<number>,
): number {
  const s: FaceState = { rho: 0, u: 0, v: 0, w: 0, p: 0, t: 0, z: 0 };
  let thrust = 0;
  line.faces.forEach((f, j) => {
    const a = line.upstream[j] as number;
    const b = line.downstream[j] as number;
    faceState(ref, prim, mesh.cellR, a, b, s);
    const bf = b >= 0 && a >= 0 ? 0.5 * ((blockage[a] as number) + (blockage[b] as number)) : 1;
    const af = 2 * Math.PI * bf * (mesh.iArea[f] as number);
    const nx = mesh.iNx[f] as number;
    const m = s.rho * (s.u * nx + s.v * (mesh.iNr[f] as number)) * af;
    thrust += m * s.u + (s.p - ref.p) * nx * af;
  });
  return thrust;
}

/** The nozzle exits the gross thrust integrates over (the bypass and core nozzle throats). */
export const THRUST_STATIONS = ['18', '8'] as const;

/** The coupling's station reduction of a field (torques from the body-force rates, or 0). */
export function reduceStations(
  mesh: SolverMesh,
  ref: ReferenceState,
  lines: readonly StationLine[],
  prim: ArrayLike<number>,
  blockage: ArrayLike<number>,
  iteration: number,
  torques: { readonly lp: number; readonly hp: number } = { lp: 0, hp: 0 },
): StationReduction {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const at = (id: string) => {
    const l = byId.get(id);
    if (l === undefined) throw new Error(`reduceStations: the mesh has no station ${id}`);
    return l;
  };
  const stations = Object.fromEntries(
    SOLVER_REDUCTION_STATIONS.map((id) => [id, reduceStation(mesh, ref, at(id), prim, blockage)]),
  ) as Record<SolverReductionStationId, ReducedStation>;
  let thrust = 0;
  for (const id of THRUST_STATIONS) thrust += lineThrust(mesh, ref, at(id), prim, blockage);
  return {
    iteration,
    stations,
    grossThrustN: thrust,
    lpTorqueNm: torques.lp,
    hpTorqueNm: torques.hp,
  };
}
