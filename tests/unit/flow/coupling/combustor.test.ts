// The combustor's heat and fuel sources (PHYSICS.md 3.3 CP2) on the 130k mesh.
import { describe, expect, it, vi } from 'vitest';
import { THRESHOLDS } from '../../../../src/contracts/thresholds';
import { CYCLE_CALIBRATION, combustionEfficiency } from '../../../../src/cycle/engine';
import { ENGINE_DEFINITION as DEF } from '../../../../src/engine/definition';
import { factValue } from '../../../../src/engine/facts';
import {
  combustorRates,
  combustorSourceFromCycle,
  combustorZone,
} from '../../../../src/flow/coupling/combustor';
import { meshRows, rowBlockageField } from '../../../../src/flow/coupling/rows';
import { THERMALLY_PERFECT, referenceState } from '../../../../src/flow/reference/gas';
import { NU } from '../../../../src/flow/reference/state';
import { engineSolverMesh } from './engineMesh';

// the 130k mesh: each test walks every cell, a few seconds on a loaded laptop (vitest's default
// 5 s timed out under coverage)
vi.setConfig({ testTimeout: 120_000 });

const CP2 = THRESHOLDS.CP2.values;
const mesh = engineSolverMesh();
const blockage = rowBlockageField(mesh, meshRows(mesh, DEF));
const ref = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});
const zone = combustorZone(mesh, DEF);
const combustor = DEF.flowpath.components.find((c) => c.id === 'combustor');

/** The EEDB LTO fuel flows, idle to take-off (ENGINE_FACTS, [EEDB] 8CM066). */
const FUEL_FLOWS = [
  factValue('fuelFlowIdle'),
  factValue('fuelFlowApproach'),
  factValue('fuelFlowClimbOut'),
  factValue('fuelFlowTakeoff'),
];

describe('the combustor zone', () => {
  it("is the core cells between the combustor's ends, weighted 0 at both ends", () => {
    if (combustor === undefined) throw new Error('no combustor');
    expect(zone.cells.length).toBeGreaterThan(100);
    for (let k = 0; k < zone.cells.length; k++) {
      const x = mesh.cellX[zone.cells[k] ?? 0] ?? NaN;
      expect(x).toBeGreaterThan(combustor.xStart);
      expect(x).toBeLessThan(combustor.xEnd);
      expect(zone.weight[k] ?? NaN).toBeGreaterThan(0);
      expect(zone.weight[k] ?? NaN).toBeLessThanOrEqual(1);
    }
    // no blade row inside it
    for (const c of zone.cells) expect(blockage[c]).toBe(1);
  });
});

describe('CP2: the heat and the fuel integrate to the cycle model', () => {
  it.each(FUEL_FLOWS)('heat = eta_b W_f LHV and fuel = W_f within 0.1 %% at W_f %f kg/s', (wf) => {
    const etaB = combustionEfficiency(CYCLE_CALIBRATION, wf, 101325, 288.15, true);
    expect(etaB).toBeGreaterThan(0.9);
    expect(etaB).toBeLessThanOrEqual(1);
    const heatW = etaB * wf * CYCLE_CALIBRATION.fuelLhvJPerKg;
    const rate = combustorRates(mesh, zone, blockage, ref, heatW, wf);
    // per radian, so the whole annulus is 2 pi times the cell sums
    let heat = 0;
    let fuel = 0;
    let mass = 0;
    let momentum = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      const bv = 2 * Math.PI * (blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN);
      const o = NU * c;
      // s_eta = s_E - h0_inf s_m: the energy added is s_eta + h0_inf s_m (the fuel's own
      // enthalpy is 0 at the src/thermo datum, as in the cycle model's h4 balance)
      heat += bv * ((rate[o + 4] ?? NaN) + ref.h0 * (rate[o] ?? NaN));
      fuel += bv * (rate[o + 5] ?? NaN);
      mass += bv * (rate[o] ?? NaN);
      momentum += Math.abs(rate[o + 1] ?? NaN) + Math.abs(rate[o + 2] ?? NaN);
      momentum += Math.abs(rate[o + 3] ?? NaN);
    }
    expect(Math.abs(heat / heatW - 1)).toBeLessThanOrEqual(CP2.maxRelativeError.value);
    expect(Math.abs(fuel / wf - 1)).toBeLessThanOrEqual(CP2.maxRelativeError.value);
    // the fuel adds its mass, injected at rest
    expect(Math.abs(mass / wf - 1)).toBeLessThanOrEqual(CP2.maxRelativeError.value);
    expect(momentum).toBe(0);
  });

  it("takes the heat from the cycle state's fuel flow, its eta_b and the lit flag", () => {
    const wf = factValue('fuelFlowApproach');
    const lit = combustorSourceFromCycle(CYCLE_CALIBRATION, {
      fuelFlowKgPerS: wf,
      combustorLit: true,
      p2Pa: 101325,
      t2K: 288.15,
    });
    expect(lit.fuelKgPerS).toBe(wf);
    expect(lit.heatW).toBeCloseTo(
      combustionEfficiency(CYCLE_CALIBRATION, wf, 101325, 288.15, true) *
        wf *
        CYCLE_CALIBRATION.fuelLhvJPerKg,
      6,
    );
    const unlit = combustorSourceFromCycle(CYCLE_CALIBRATION, {
      fuelFlowKgPerS: wf,
      combustorLit: false,
      p2Pa: 101325,
      t2K: 288.15,
    });
    expect(unlit.heatW).toBe(0);
    expect(unlit.fuelKgPerS).toBe(wf);
  });

  it('writes nothing outside the zone and no source at zero fuel', () => {
    const rate = combustorRates(mesh, zone, blockage, ref, 0, 0);
    expect(rate.every((v) => v === 0)).toBe(true);
    const inZone = new Uint8Array(mesh.nCells);
    for (const c of zone.cells) inZone[c] = 1;
    const r = combustorRates(mesh, zone, blockage, ref, 1e7, 1);
    for (let c = 0; c < mesh.nCells; c++) {
      if (inZone[c] === 0) for (let m = 0; m < NU; m++) expect(r[NU * c + m]).toBe(0);
    }
  });
});
