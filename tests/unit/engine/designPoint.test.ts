import { describe, expect, it } from 'vitest';
import { estimateDesignPoint } from '../../../src/engine/designPoint';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { factValue } from '../../../src/engine/facts';
import { STATION_IDS } from '../../../src/contracts/stations';
import { THRESHOLDS } from '../../../src/contracts/thresholds';

const dp = ENGINE_DEFINITION.designPoint;
const est = estimateDesignPoint(dp, factValue('fuelLhv'));
const p0 = dp.ambient.pressurePa;

describe('design-point estimate (the derivation in ENGINE_FACTS.md)', () => {
  it('reproduces the temperatures in the ENGINE_FACTS table', () => {
    const t = (id: (typeof STATION_IDS)[number]) => est.stations[id].ttK;
    expect(t('13')).toBeCloseTo(330.9, 1);
    expect(t('21')).toBeCloseTo(327.9, 1);
    expect(t('24')).toBeCloseTo(391.8, 1);
    expect(t('3')).toBeCloseTo(836.0, 1);
    expect(Math.abs(t('4') - 1745.9)).toBeLessThan(0.5);
    expect(Math.abs(t('41') - 1626.6)).toBeLessThan(0.5);
    expect(Math.abs(t('45') - 1243.1)).toBeLessThan(0.5);
    expect(Math.abs(t('49.5') - 1174)).toBeLessThan(1);
    expect(Math.abs(t('5') - 965.6)).toBeLessThan(0.5);
    expect(est.stations['4'].fuelAirRatio).toBeCloseTo(0.025, 3);
  });

  it('the assumed T4 is the energy-balance result', () => {
    expect(Math.abs(est.stations['4'].ttK - factValue('t4Takeoff'))).toBeLessThan(0.5);
    expect(dp.t4K).toBe(factValue('t4Takeoff'));
  });

  it('sizes the nozzles to the assumed areas, choked core and unchoked bypass', () => {
    expect(est.coreNozzle.areaM2).toBeCloseTo(factValue('coreNozzleArea'), 3);
    expect(est.bypassNozzle.areaM2).toBeCloseTo(factValue('bypassNozzleArea'), 3);
    expect(est.coreNozzle.choked).toBe(true);
    expect(est.bypassNozzle.choked).toBe(false);
    expect(est.stations['5'].ptPa / p0).toBeCloseTo(2.64, 2);
  });

  it('closes on the published thrust and TSFC inside C1 and C3', () => {
    const c1 = THRESHOLDS.C1.values.maxRelativeError.value;
    const c3 = THRESHOLDS.C3.values.maxRelativeError.value;
    expect(Math.abs(est.netThrustN / factValue('takeoffThrust') - 1)).toBeLessThan(c1);
    expect(Math.abs(est.tsfcKgPerNs / factValue('tsfcTakeoff') - 1)).toBeLessThan(c3);
    expect(est.netThrustN / 1000).toBeCloseTo(123.9, 1);
    expect(est.grossThrustN).toBe(est.netThrustN); // static: no ram drag
  });

  it('honours the definition: OPR = P3/P2, BPR, flows and FAR bookkeeping', () => {
    const s = est.stations;
    expect(s['3'].ptPa / s['2'].ptPa).toBeCloseTo(dp.pressureRatios.overall, 9);
    expect(s['13'].wKgPerS / s['21'].wKgPerS).toBeCloseTo(dp.bypassRatio, 9);
    expect(s['2'].wKgPerS).toBeCloseTo(dp.totalAirflowKgPerS, 9);
    // mass: everything that enters, plus fuel, leaves through the two nozzles
    expect(s['9'].wKgPerS + s['19'].wKgPerS).toBeCloseTo(
      dp.totalAirflowKgPerS + dp.fuelFlowKgPerS,
      9,
    );
    expect(s['9'].fuelAirRatio * (s['9'].wKgPerS - dp.fuelFlowKgPerS)).toBeCloseTo(
      dp.fuelFlowKgPerS,
      9,
    );
    for (const id of ['0', '1', '2', '13', '21', '3', '19'] as const)
      expect(s[id].fuelAirRatio).toBe(0);
  });

  it('balances the shafts: turbine work = compressor work / mechanical efficiency', () => {
    const s = est.stations;
    const hot = est.gas.hot.cpJPerKgK;
    expect(s['41'].wKgPerS * hot * (s['41'].ttK - s['45'].ttK)).toBeCloseTo(
      est.hpShaftPowerW / est.mechanicalEfficiency,
      3,
    );
    expect(s['45'].wKgPerS * hot * (s['45'].ttK - s['5'].ttK)).toBeCloseTo(
      est.lpShaftPowerW / est.mechanicalEfficiency,
      3,
    );
    expect(est.hpShaftPowerW / 1e6).toBeCloseTo(26.28, 2);
    expect(est.lpShaftPowerW / 1e6).toBeCloseTo(19.02, 2);
  });

  it('fills every station with positive totals, pressure falling through the turbines', () => {
    for (const id of STATION_IDS) {
      const st = est.stations[id];
      expect(st.ptPa).toBeGreaterThan(0);
      expect(st.ttK).toBeGreaterThan(0);
      expect(st.wKgPerS).toBeGreaterThan(0);
    }
    const order = ['3', '4', '41', '45', '49.5', '5', '8'] as const;
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1];
      const b = order[i];
      if (a === undefined || b === undefined) continue;
      expect(est.stations[b].ptPa).toBeLessThanOrEqual(est.stations[a].ptPa);
    }
  });

  it('handles flight Mach: ram totals at the inlet and ram drag', () => {
    const flying = estimateDesignPoint(
      { ...dp, ambient: { ...dp.ambient, machNumber: 0.2 } },
      factValue('fuelLhv'),
    );
    expect(flying.stations['2'].ttK).toBeCloseTo(dp.ambient.temperatureK * 1.008, 6);
    expect(flying.netThrustN).toBeLessThan(flying.grossThrustN);
  });
});
