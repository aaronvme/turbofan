// The combustor's heat and fuel sources (PHYSICS.md 2, 3.3 CP2; SOLVER.md 8): eta_b W_f LHV and
// W_f, from the cycle model's state, spread over the core duct's cells between stations 3 and 4.
// The fuel enters as mass at rest carrying no enthalpy at the src/thermo datum (0 at 298.15 K),
// as in the cycle model's balance h4 w4 = h3 w_comb + eta_b W_f LHV, so s_eta = q - h0_inf s_m
// (SOLVER.md 8: s_eta = s_E - h0_inf s_m) and the fuel's mass goes into rho' and rho Z alike.
// The rates do not depend on the state, so the point-implicit damping is 0.
import { combustionEfficiency, type CycleCalibration } from '../../cycle/engine';
import type { EngineDefinition } from '../../contracts/engine';
import type { ReferenceState } from '../reference/gas';
import type { SolverMesh } from '../reference/solverMesh';
import { NU } from '../reference/state';

export interface CombustorZone {
  readonly cells: Int32Array;
  /** Per zone cell: the axial heat-release profile sin^2(pi xi), xi from station 3 to 4. */
  readonly weight: Float64Array;
}

/**
 * The combustor's cells: the core block's columns between the station-3 and station-4 grid lines
 * (the combustor component's ends), every j. The profile is an assumed smooth release, 0 at the
 * diffuser exit and the nozzle-guide-vane inlet.
 */
export function combustorZone(mesh: SolverMesh, def: EngineDefinition): CombustorZone {
  const s3 = mesh.stations.find((s) => s.id === '3');
  const s4 = mesh.stations.find((s) => s.id === '4');
  const comb = def.flowpath.components.find((c) => c.id === 'combustor');
  if (s3 === undefined || s4 === undefined || comb === undefined || s3.block !== s4.block)
    throw new Error('combustorZone: stations 3 and 4 must be grid lines of one block');
  const block = mesh.blocks[s3.block];
  if (block === undefined) throw new Error('combustorZone: no block');
  const n = (s4.i - s3.i) * block.nj;
  const cells = new Int32Array(n);
  const weight = new Float64Array(n);
  let k = 0;
  for (let j = 0; j < block.nj; j++) {
    for (let i = s3.i; i < s4.i; i++) {
      const c = block.cellOffset + j * block.ni + i;
      const xi = ((mesh.cellX[c] as number) - comb.xStart) / (comb.xEnd - comb.xStart);
      const s = Math.sin(Math.PI * xi);
      cells[k] = c;
      weight[k] = s * s;
      k++;
    }
  }
  return { cells, weight };
}

/**
 * The combustor's rates (NU per cell, per unit gas volume) for a whole-engine heat release heatW
 * (W) and fuel flow (kg/s): per radian, so the cells' b V-weighted sums are heatW / (2 pi) and
 * fuel / (2 pi).
 */
export function combustorRates(
  mesh: SolverMesh,
  zone: CombustorZone,
  blockage: ArrayLike<number>,
  ref: ReferenceState,
  heatW: number,
  fuelKgPerS: number,
): Float64Array {
  const rate = new Float64Array(NU * mesh.nCells);
  let sum = 0;
  zone.cells.forEach((c, k) => {
    sum += (blockage[c] as number) * (mesh.cellVolR[c] as number) * (zone.weight[k] as number);
  });
  const q = heatW / (2 * Math.PI * sum);
  const m = fuelKgPerS / (2 * Math.PI * sum);
  zone.cells.forEach((c, k) => {
    const w = zone.weight[k] as number;
    const o = NU * c;
    rate[o] = m * w;
    rate[o + 4] = q * w - ref.h0 * m * w;
    rate[o + 5] = m * w;
  });
  return rate;
}

/** What the combustor source takes from the cycle state (CycleState fields and P2, T2). */
export interface CombustorInputs {
  readonly fuelFlowKgPerS: number;
  readonly combustorLit: boolean;
  readonly p2Pa: number;
  readonly t2K: number;
}

/** The heat release eta_b W_f LHV and the fuel flow of a cycle state (the cycle's own eta_b). */
export function combustorSourceFromCycle(
  cal: CycleCalibration,
  s: CombustorInputs,
): { readonly heatW: number; readonly fuelKgPerS: number; readonly etaB: number } {
  const etaB = combustionEfficiency(cal, s.fuelFlowKgPerS, s.p2Pa, s.t2K, s.combustorLit);
  return { heatW: etaB * s.fuelFlowKgPerS * cal.fuelLhvJPerKg, fuelKgPerS: s.fuelFlowKgPerS, etaB };
}
