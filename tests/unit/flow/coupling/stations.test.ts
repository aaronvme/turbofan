// The coupling's station reduction on the 130k mesh: mass-averaged Pt and Tt, the mass flow and
// the gross thrust, against the exact values of uniform fields.
import { describe, expect, it, vi } from 'vitest';
import { SOLVER_REDUCTION_STATIONS } from '../../../../src/contracts/stations';
import { ENGINE_DEFINITION as DEF } from '../../../../src/engine/definition';
import { meshRows, rowBlockageField } from '../../../../src/flow/coupling/rows';
import {
  lineThrust,
  reduceStation,
  reduceStations,
  stationCells,
  stationLines,
  totalTemperatureRise,
} from '../../../../src/flow/coupling/stations';
import {
  THERMALLY_PERFECT,
  enthalpyDelta,
  referenceState,
} from '../../../../src/flow/reference/gas';
import { NP } from '../../../../src/flow/reference/state';
import { isentropicTemperature } from '../../../../src/thermo/gas';
import { engineSolverMesh } from './engineMesh';

// the 130k mesh: each test walks every cell, a few seconds on a loaded laptop (vitest's default
// 5 s timed out under coverage)
vi.setConfig({ testTimeout: 120_000 });

const mesh = engineSolverMesh();
const ref = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});
const lines = stationLines(mesh);
const blockage = rowBlockageField(mesh, meshRows(mesh, DEF));

/** A uniform axial stream at the static (p, T) and speed u, Z = 0, as primitive records. */
function uniform(u: number, dp = 0, dt = 0): Float64Array {
  const P = new Float64Array(NP * (mesh.nCells + mesh.nGhosts));
  const rho = (ref.p + dp) / (ref.r * (ref.t + dt));
  for (let c = 0; c < mesh.nCells; c++) {
    P[NP * c] = rho - ref.rho;
    P[NP * c + 1] = u;
    P[NP * c + 4] = dp;
    P[NP * c + 6] = dt;
  }
  return P;
}

describe('the station lines', () => {
  it("finds every reduction station's grid line, one face per j, with its cells", () => {
    for (const id of SOLVER_REDUCTION_STATIONS) expect(lines.some((l) => l.id === id)).toBe(true);
    for (const l of lines) {
      const b = mesh.blocks[l.block];
      expect(l.faces.length).toBe(b?.nj);
      l.faces.forEach((_, j) => {
        expect((l.upstream[j] ?? -1) >= 0 || (l.downstream[j] ?? -1) >= 0).toBe(true);
      });
    }
    const cells = stationCells(lines);
    for (let k = 1; k < cells.length; k++) expect(cells[k] ?? 0).toBeGreaterThan(cells[k - 1] ?? 0);
  });
});

describe('the reduction of a uniform stream', () => {
  const u = 150;
  const P = uniform(u, 2000, 10);
  const t = ref.t + 10;
  const p = ref.p + 2000;
  const rho = p / (ref.r * t);

  it('gives the total temperature and pressure of the stream (thermally perfect)', () => {
    const tau = totalTemperatureRise(ref, t, 0, 0.5 * u * u);
    expect(enthalpyDelta(THERMALLY_PERFECT, t, tau, 0)).toBeCloseTo(0.5 * u * u, 6);
    for (const id of ['2', '13', '25'] as const) {
      const line = lines.find((l) => l.id === id);
      if (line === undefined) throw new Error(id);
      const s = reduceStation(mesh, ref, line, P, blockage);
      expect(s.ttMassAvgK).toBeCloseTo(t + tau, 9);
      // Pt is the isentrope through the static state to Tt (src/thermo, an independent inverse)
      expect(isentropicTemperature(t, s.ptMassAvgPa / p, 0)).toBeCloseTo(t + tau, 6);
      expect(s.psAreaAvgPa).toBeCloseTo(p, 6);
      expect(s.swirlAngleMassAvgRad).toBe(0);
    }
  });

  it("gives the mass flow rho u A of the station's annulus, and the momentum thrust", () => {
    const line = lines.find((l) => l.id === '2');
    if (line === undefined) throw new Error('2');
    const s = reduceStation(mesh, ref, line, P, blockage);
    let ax = 0;
    line.faces.forEach((f) => (ax += 2 * Math.PI * (mesh.iArea[f] ?? NaN) * (mesh.iNx[f] ?? NaN)));
    expect(Math.abs(s.massFlowKgPerS / (rho * u * ax) - 1)).toBeLessThan(1e-12);
    // at the fan face the annulus is a radial line from the spinner to the casing
    expect(Math.abs(s.areaM2 / ax - 1)).toBeLessThan(1e-9);
    // the nozzle exits: m u + (p - p_inf) A_x
    for (const id of ['18', '8'] as const) {
      const l = lines.find((k) => k.id === id);
      if (l === undefined) throw new Error(id);
      const st = reduceStation(mesh, ref, l, P, blockage);
      let a = 0;
      l.faces.forEach((f) => (a += 2 * Math.PI * (mesh.iArea[f] ?? NaN) * (mesh.iNx[f] ?? NaN)));
      expect(
        Math.abs(lineThrust(mesh, ref, l, P, blockage) / (st.massFlowKgPerS * u + 2000 * a) - 1),
      ).toBeLessThan(1e-12);
    }
    const all = reduceStations(mesh, ref, lines, P, blockage, 40, { lp: 1, hp: 2 });
    expect(all.iteration).toBe(40);
    // integer-like keys enumerate first in JS, so compare the sets
    expect(Object.keys(all.stations).sort()).toEqual([...SOLVER_REDUCTION_STATIONS].sort());
    expect(all.grossThrustN).toBeGreaterThan(0);
    expect(all.lpTorqueNm).toBe(1);
    expect(all.hpTorqueNm).toBe(2);
  });

  it('throws on a station the mesh does not have', () => {
    expect(() => reduceStations(mesh, ref, lines.slice(1), P, blockage, 0)).toThrow(/no station/);
  });
});
