import { describe, expect, it } from 'vitest';
import {
  ENGINE_DEFINITION,
  ENGINE_DESIGN_ESTIMATE,
  ENGINE_MEANLINE,
  TRF_AFT_FLANGE_X,
  buildEngine,
} from '../../../src/engine/definition';
import { axialVelocity } from '../../../src/engine/bladeDesign';
import { COLD_GAS, HOT_GAS } from '../../../src/engine/designPoint';
import { factValue } from '../../../src/engine/facts';
import { celsiusToKelvin } from '../../../src/engine/units';
import {
  casingRadiusAt,
  hubRadiusAt,
  radiusAt,
  validateEngineDefinition,
  type ComponentId,
  type FlowComponent,
} from '../../../src/contracts/engine';
import { findNonPlainData } from '../../../src/contracts/sim';
import type { PlaneStationId } from '../../../src/contracts/stations';

const def = ENGINE_DEFINITION;
const v = factValue;

function component(id: ComponentId): FlowComponent {
  const c = def.flowpath.components.find((k) => k.id === id);
  if (c === undefined) throw new Error(`no component ${id}`);
  return c;
}

function stationX(id: PlaneStationId): number {
  const s = def.stations.find((k) => k.id === id);
  if (s === undefined) throw new Error(`no station ${id}`);
  return s.x;
}

function annulusArea(id: ComponentId, x: number): number {
  const c = component(id);
  const rh = hubRadiusAt(def.flowpath, c, x);
  const rc = casingRadiusAt(def.flowpath, c, x);
  if (rh === null || rc === null) throw new Error(`no annulus in ${id} at x=${x}`);
  return Math.PI * (rc * rc - rh * rh);
}

const rows = (id: ComponentId) => def.bladeRows.filter((r) => r.component === id);
const rotors = (id: ComponentId) => rows(id).filter((r) => r.kind === 'rotor');

describe('the CFM56-7B27-class engine definition', () => {
  it('passes validateEngineDefinition with no problems', () => {
    expect(validateEngineDefinition(def)).toEqual([]);
  });

  it('is deep-frozen plain data, rebuilt identically every time', () => {
    expect(Object.isFrozen(def)).toBe(true);
    expect(Object.isFrozen(def.bladeRows[0])).toBe(true);
    expect(findNonPlainData(def)).toBeNull();
    expect(buildEngine().definition).toEqual(def);
  });

  it('rotates both spools clockwise seen from behind: -1 about +x (NTSB AAR-19/03)', () => {
    expect(def.rotation).toEqual({ lp: v('rotationSense'), hp: v('rotationSense') });
    expect(def.rotation.lp).toBe(-1);
  });

  it('puts the origin at the fan face and the stations in flow order', () => {
    expect(stationX('2')).toBe(0);
    expect(stationX('1')).toBe(def.flowpath.curves.nacelleInner.points[0]?.x); // the highlight
    expect(stationX('8')).toBe(stationX('9'));
    expect(stationX('18')).toBe(stationX('19'));
    // EGT is measured at the LPT stage 2 nozzle (TCDS E.004 IV.1.1)
    const n2 = def.bladeRows.find((r) => r.id === 'lpt-n2');
    expect(n2).toBeDefined();
    expect(stationX('49.5')).toBeCloseTo(n2?.leadingEdge.hub.x ?? Number.NaN, 12);
  });
});

describe('figures taken from ENGINE_FACTS', () => {
  it('ratings, limits and the start schedule', () => {
    expect(def.ratings).toEqual({
      takeoffThrustN: v('takeoffThrust'),
      maxContinuousThrustN: v('maxContinuousThrust'),
      flatRatingTemperatureK: v('flatRatingTemperature'),
    });
    expect(def.limits.n1MaxRpm).toBe(v('n1MaxRpm'));
    expect(def.limits.n2MaxRpm).toBe(v('n2MaxRpm'));
    expect(def.limits.egtTakeoffRedlineK).toBe(v('egtTakeoffLimit'));
    expect(def.limits.egtTakeoffRedlineK).toBeCloseTo(celsiusToKelvin(950), 9);
    expect(def.limits.egtMaxContinuousK).toBe(v('egtMaxContinuousLimit'));
    expect(def.limits.egtStartLimitK).toBe(v('egtStartLimit'));
    expect(def.limits.egtTransientK).toBe(v('egtTransientLimit'));
    expect(def.limits.egtTransientDurationS).toBe(v('egtTransientDuration'));
    expect(def.limits.egtShunt).toEqual({
      offsetK: v('egtShuntOffset'),
      rampStartN2Rpm: v('egtShuntRampStartN2'),
      fullN2Rpm: v('egtShuntFullN2'),
    });
    expect(def.startSchedule).toEqual({
      minFuelOnN2Percent: v('minFuelOnN2'),
      fuelOnN2Percent: v('startFuelOnN2'),
      starterCutoutN2Percent: v('starterCutoutN2'),
    });
  });

  it('the design point', () => {
    const dp = def.designPoint;
    expect(dp.ambient).toEqual({ pressurePa: 101325, temperatureK: 288.15, machNumber: 0 });
    expect(dp.totalAirflowKgPerS).toBe(v('totalAirflow'));
    expect(dp.bypassRatio).toBe(v('bypassRatio'));
    expect(dp.pressureRatios.overall).toBe(v('overallPressureRatio'));
    expect(dp.pressureRatios.fanBypass).toBe(v('fanBypassPressureRatio'));
    expect(dp.pressureRatios.fanCore).toBe(v('fanCorePressureRatio'));
    expect(dp.pressureRatios.booster).toBe(v('boosterPressureRatio'));
    expect(dp.pressureRatios.hpc).toBeCloseTo(29 / (1.5 * 1.75), 12);
    expect(dp.efficiencies).toEqual({
      fanBypass: v('etaFanBypass'),
      fanCore: v('etaFanCore'),
      booster: v('etaBooster'),
      hpc: v('etaHpc'),
      hpt: v('etaHpt'),
      lpt: v('etaLpt'),
      combustor: v('combustionEfficiency'),
    });
    expect(dp.combustorPressureLossFraction).toBe(v('combustorPressureLoss'));
    expect(dp.turbineCoolingFraction).toBe(v('turbineCoolingFraction'));
    expect(dp.t4K).toBe(v('t4Takeoff'));
    expect(dp.n1Rpm).toBe(v('n1ReferenceRpm'));
    expect(dp.n2Rpm).toBe(v('n2ReferenceRpm'));
    expect(dp.netThrustN).toBe(v('takeoffThrust'));
    expect(dp.fuelFlowKgPerS).toBe(v('fuelFlowTakeoff'));
  });

  it('stage counts (TCDS E.004 III.2) and the 19 HPC rows with 4 VSV rows', () => {
    expect(rotors('fan').length).toBe(v('fanStages'));
    expect(rotors('booster').length).toBe(v('boosterStages'));
    expect(rotors('hpc').length).toBe(v('hpcStages'));
    expect(rotors('hpt').length).toBe(v('hptStages'));
    expect(rotors('lpt').length).toBe(v('lptStages'));
    expect(rows('hpc').length).toBe(19);
    expect(rows('hpt').length).toBe(2);
    expect(rows('lpt').length).toBe(8);
    expect(def.bladeRows.filter((r) => r.kind === 'vsv').length).toBe(v('vsvRowCount'));
  });

  it('the fan: 24 blades, the published diameter and a tip chord near the published 11 in', () => {
    const [fan] = rotors('fan');
    if (fan === undefined) throw new Error('no fan rotor');
    expect(fan.count).toBe(v('fanBladeCount'));
    expect(fan.countConfidence).toBe('published');
    expect(fan.leadingEdge.tip.r).toBeCloseTo(v('fanDiameter') / 2, 12);
    expect(fan.tipClearance).toBe(v('fanTipClearance'));
    const casing = casingRadiusAt(def.flowpath, component('fan'), fan.leadingEdge.tip.x);
    expect(casing).toBeCloseTo(v('fanDiameter') / 2 + v('fanTipClearance'), 12);
    expect(Math.abs(fan.chord.tip / v('fanBladeChord') - 1)).toBeLessThan(0.05);
    expect(radiusAt(def.flowpath.curves.coreInner, 0)).toBe(v('fanHubRadius'));
  });

  it('the nacelle, the nozzles and the engine length', () => {
    const c = def.flowpath.curves;
    expect(c.nacelleInner.points[0]).toEqual({ x: stationX('1'), r: v('inletHighlightRadius') });
    expect(Math.max(...c.nacelleOuter.points.map((p) => p.r))).toBeCloseTo(
      v('nacelleMaxDiameter') / 2,
      12,
    );
    expect(annulusArea('bypassDuct', stationX('18')) / v('bypassNozzleArea') - 1).toBeCloseTo(0, 3);
    expect(annulusArea('exhaust', stationX('8')) / v('coreNozzleArea') - 1).toBeCloseTo(0, 3);
    expect(TRF_AFT_FLANGE_X - v('fanCaseFlangeX')).toBeCloseTo(v('engineLength'), 12);
    // the turbomachinery sits between the two flanges of the certified engine length
    for (const r of def.bladeRows) {
      expect(r.leadingEdge.hub.x).toBeGreaterThan(v('fanCaseFlangeX'));
      expect(r.trailingEdge.tip.x).toBeLessThan(TRF_AFT_FLANGE_X);
    }
  });

  it('VSV schedule and bleed ports', () => {
    const [sched] = def.vsvSchedules;
    if (sched === undefined) throw new Error('no VSV schedule');
    const first = sched.points[0];
    const last = sched.points[sched.points.length - 1];
    expect(first).toEqual({
      n2CorrectedPercent: v('vsvClosedBelowN2c'),
      closure: v('vsvMaxClosure'),
    });
    expect(last).toEqual({ n2CorrectedPercent: v('vsvOpenAboveN2c'), closure: 0 });
    const gains = def.bladeRows.filter((r) => r.kind === 'vsv').map((r) => r.vsv?.gain ?? -1);
    expect(gains[0]).toBe(1);
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1] ?? 0);
    const bleed = (id: string) => def.bleeds.find((b) => b.id === id);
    expect(bleed('bypass')).toMatchObject({ kind: 'customer', maxFraction: v('bleedBypassMax') });
    expect(bleed('hpc5')).toMatchObject({ kind: 'customer', maxFraction: v('bleedHpc5Max') });
    expect(bleed('hpc9')).toMatchObject({ kind: 'customer', maxFraction: v('bleedHpc9MaxLow') });
    expect(bleed('vbv')).toMatchObject({ kind: 'handling', maxFraction: v('vbvMaxFraction') });
    expect(bleed('tbv')).toMatchObject({ kind: 'handling', maxFraction: v('tbvMaxFraction') });
    expect(bleed('turbineCooling')).toMatchObject({
      kind: 'cooling',
      maxFraction: v('turbineCoolingFraction'),
    });
  });
});

describe('the flowpath against the design-point estimate', () => {
  const est = ENGINE_DESIGN_ESTIMATE;

  /** Axial Mach number at a station plane, from continuity with the estimate's totals. */
  function stationMach(id: PlaneStationId, comp: ComponentId, hot = false): number {
    const s = est.stations[id];
    return axialVelocity({
      wKgPerS: s.wKgPerS,
      ttK: s.ttK,
      ptPa: s.ptPa,
      areaM2: annulusArea(comp, stationX(id)),
      cThetaMPerS: 0,
      gas: hot ? HOT_GAS : COLD_GAS,
    }).mach;
  }

  it('sees plausible axial Mach numbers at the duct stations', () => {
    const cases: [PlaneStationId, ComponentId, boolean, number, number][] = [
      ['2', 'fan', false, 0.5, 0.7],
      ['13', 'bypassDuct', false, 0.35, 0.6],
      ['21', 'booster', false, 0.35, 0.6],
      ['25', 'hpc', false, 0.35, 0.6],
      ['3', 'hpc', false, 0.2, 0.4],
      ['4', 'combustor', true, 0.05, 0.25],
      ['45', 'lpt', true, 0.2, 0.5],
      ['5', 'lpt', true, 0.25, 0.5],
    ];
    for (const [id, comp, hot, lo, hi] of cases) {
      const m = stationMach(id, comp, hot);
      expect(m, `station ${id}`).toBeGreaterThan(lo);
      expect(m, `station ${id}`).toBeLessThan(hi);
    }
  });

  it('designs every row on the mean line without choking', () => {
    expect(ENGINE_MEANLINE.length).toBe(def.bladeRows.length);
    for (const m of ENGINE_MEANLINE) {
      for (const plane of [m.inlet, m.exit]) {
        expect(plane.axialMach, m.rowId).toBeLessThan(0.95);
        expect(plane.cxMPerS, m.rowId).toBeGreaterThan(50);
      }
    }
  });

  it('Euler work on the mean line equals the cycle work of each component', () => {
    const work = (id: ComponentId) =>
      ENGINE_MEANLINE.filter((m) => m.component === id).reduce((a, m) => a + m.eulerWorkJPerKg, 0);
    const w = est.specificWorkJPerKg;
    expect(work('fan') / w.fan).toBeCloseTo(1, 9);
    expect(work('booster') / w.booster).toBeCloseTo(1, 9);
    expect(work('hpc') / w.hpc).toBeCloseTo(1, 9);
    expect(work('hpt') / -w.hpt).toBeCloseTo(1, 9);
    expect(work('lpt') / -w.lpt).toBeCloseTo(1, 9);
    expect(work('bypassDuct')).toBe(0); // the OGV is a stator
  });

  it('removes the swirl where the plan says: OGV, booster and HPC exit, LPT exit', () => {
    const exitSwirl = (rowId: string) => {
      const m = ENGINE_MEANLINE.find((k) => k.rowId === rowId);
      if (m === undefined) throw new Error(`no meanline row ${rowId}`);
      return m.exit.rcTheta;
    };
    expect(exitSwirl('fan-ogv')).toBe(0);
    expect(exitSwirl('booster-s3')).toBe(0);
    expect(exitSwirl('hpc-s9')).toBe(0);
    expect(exitSwirl('lpt-r4')).toBe(0);
    // the fan swirls the flow in the rotation direction (-theta)
    expect(exitSwirl('fan')).toBeLessThan(0);
  });

  it('keeps blade solidity and aspect ratios in the usual ranges', () => {
    for (const r of def.bladeRows) {
      const span = Math.hypot(
        r.leadingEdge.tip.x - r.leadingEdge.hub.x,
        r.leadingEdge.tip.r - r.leadingEdge.hub.r,
      );
      const solidity =
        (r.chord.mid * r.count) / (Math.PI * (r.leadingEdge.hub.r + r.leadingEdge.tip.r));
      expect(solidity, r.id).toBeGreaterThan(0.6);
      expect(solidity, r.id).toBeLessThan(2.5);
      expect(span / r.chord.mid, r.id).toBeGreaterThan(0.5);
      expect(span / r.chord.mid, r.id).toBeLessThan(6);
    }
  });
});
