import { describe, expect, it } from 'vitest';
import {
  MOCK_LABEL,
  createMockCycle,
  mockN1PercentFromN2,
  mockSteadyState,
} from '../../../src/mocks/mockCycle';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { factValue } from '../../../src/engine/facts';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  STOICHIOMETRIC_FAR,
  validateCycleState,
  type CycleInputs,
  type CycleState,
} from '../../../src/contracts/cycle';
import { flowTargetsFromCycleState } from '../../../src/contracts/flow';
import { findNonPlainData } from '../../../src/contracts/sim';
import { STATION_IDS } from '../../../src/contracts/stations';
import { THRESHOLDS } from '../../../src/contracts/thresholds';

const def = ENGINE_DEFINITION;
const v = factValue;
const REF = { n1Rpm: def.designPoint.n1Rpm, n2Rpm: def.designPoint.n2Rpm };
const DT = 1 / 60;
const RUN: CycleInputs = { ...DEFAULT_CYCLE_INPUTS, fuelLever: 'run', ignition: 'auto' };

/** EGT corrected from the run-up day (OAT 25 C) to the ambient: EGT / theta is held. */
const corrected = (egtK: number, ambientK = ISA_SLS.temperatureK) =>
  (egtK * ambientK) / v('runUpOat');

function run(
  model: ReturnType<typeof createMockCycle>,
  seconds: number,
  inputs: CycleInputs,
  each?: (s: CycleState) => void,
): CycleState {
  let s = model.state();
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    s = model.step(DT, inputs);
    each?.(s);
  }
  return s;
}

function idleModel() {
  const m = createMockCycle(def);
  m.reset('groundIdle');
  return m;
}

describe('mock cycle model: labelled, deterministic, plain data', () => {
  it('is labelled MOCK', () => {
    const m = createMockCycle(def);
    expect(MOCK_LABEL).toBe('MOCK');
    expect(m.label).toBe('MOCK');
    // W0C-I3: CycleModel.source is what the sim stamps into SimSnapshot.sources.cycle
    expect(m.source).toBe('mock');
    expect(m.definition).toBe(def);
  });

  it('gives bit-identical states for identical input sequences', () => {
    const script = (m: ReturnType<typeof createMockCycle>) => {
      m.reset('shutdown');
      const out: CycleState[] = [];
      out.push(run(m, 20, { ...DEFAULT_CYCLE_INPUTS, starter: true, ignition: 'auto' }));
      out.push(run(m, 45, { ...RUN, starter: true }));
      out.push(run(m, 6, { ...RUN, throttleLever: 1 }));
      m.injectFault('surge');
      out.push(run(m, 1, { ...RUN, throttleLever: 0.6 }));
      return out;
    };
    expect(script(createMockCycle(def))).toEqual(script(createMockCycle(def)));
  });

  it('every state is valid, plain, frozen data that later steps never change', () => {
    const m = idleModel();
    const first = m.step(DT, { ...RUN, throttleLever: 0.5 });
    const copy = structuredClone(first);
    let count = 0;
    run(m, 10, { ...RUN, throttleLever: 1 }, (s) => {
      if (count++ % 30 !== 0) return;
      expect(validateCycleState(s, REF)).toEqual([]);
      expect(findNonPlainData(s)).toBeNull();
      expect(Object.isFrozen(s.stations)).toBe(true);
    });
    expect(first).toEqual(copy);
  });

  it('W0C-N6: a zero step (paused) keeps the time but takes the new inputs', () => {
    const m = idleModel();
    const before = m.state();
    const paused = m.step(0, { ...RUN, throttleLever: 1 });
    expect(paused.timeS).toBe(before.timeS);
    expect(paused.n2Rpm).toBe(before.n2Rpm);
    // the FADEC sees the lever moved while paused
    expect(paused.fadec.limiter).toBe('accelSchedule');
    expect(before.fadec.limiter).not.toBe('accelSchedule');
    expect(m.state()).toBe(paused);
  });

  it('W0C-N6: refuses a step longer than a second instead of hanging', () => {
    const m = idleModel();
    // (a dt of 1e9 used to mean 5e10 substeps: a hang; 2 s shows the bound without one)
    expect(() => m.step(2, RUN)).toThrow(/dtS 2 must be finite and in \[0, 1\] s/);
    expect(() => m.step(1, RUN)).not.toThrow();
  });

  it('rejects invalid steps and inputs', () => {
    const m = idleModel();
    expect(() => m.step(-1, RUN)).toThrow(/dtS/);
    expect(() => m.step(Number.NaN, RUN)).toThrow(/dtS/);
    expect(() => m.step(DT, { ...RUN, throttleLever: 2 })).toThrow(/throttleLever/);
  });

  it('feeds the solver coupling (flowTargetsFromCycleState)', () => {
    const t = flowTargetsFromCycleState(mockSteadyState(def, 1), ISA_SLS);
    expect(t.stations['3'].ptPa).toBeGreaterThan(t.stations['2'].ptPa);
  });
});

describe('mock magnitudes come from ENGINE_FACTS', () => {
  it('a cold engine at rest: ambient totals, no flow, no thrust', () => {
    const m = createMockCycle(def);
    const s = m.reset('shutdown');
    expect(s.n1Rpm).toBe(0);
    expect(s.n2Rpm).toBe(0);
    expect(s.fuelFlowKgPerS).toBe(0);
    expect(s.netThrustN).toBe(0);
    expect(s.tsfcKgPerNs).toBeNull();
    expect(s.combustorLit).toBe(false);
    expect(s.fadec.mode).toBe('off');
    for (const id of STATION_IDS) {
      expect(s.stations[id]).toEqual({
        ptPa: ISA_SLS.pressurePa,
        ttK: ISA_SLS.temperatureK,
        wKgPerS: 0,
        fuelAirRatio: 0,
      });
    }
    expect(s.egtMeasuredK).toBe(ISA_SLS.temperatureK);
  });

  it('ground idle sits inside the published idle ranges (the C4 targets)', () => {
    const s = idleModel().state();
    expect(s.n1Percent).toBeGreaterThanOrEqual(v('idleN1Min'));
    expect(s.n1Percent).toBeLessThanOrEqual(v('idleN1Max'));
    expect(s.n2Percent).toBeGreaterThanOrEqual(v('idleN2Min'));
    expect(s.n2Percent).toBeLessThanOrEqual(v('idleN2Max'));
    expect(s.egtDisplayedK).toBeLessThan(v('idleEgtMax'));
    expect(s.combustorLit).toBe(true);
    expect(s.fadec.mode).toBe('run');
    // under the 33.73(b) start point: at most 15 % of rated thrust
    expect(s.netThrustN / v('takeoffThrust')).toBeLessThan(v('accelStartMaxThrustFraction'));
  });

  it('full throttle settles on the measured static takeoff point and the rated thrust and fuel flow', () => {
    const s = run(idleModel(), 30, { ...RUN, throttleLever: 1 });
    expect(s.n1Percent).toBeCloseTo(v('staticTakeoffN1'), 2);
    expect(s.n2Percent).toBeCloseTo(v('staticTakeoffN2'), 2);
    expect(s.egtDisplayedK).toBeCloseTo(corrected(v('staticTakeoffEgt')), 1);
    expect(s.netThrustN).toBeCloseTo(v('takeoffThrust'), -1);
    expect(s.fuelFlowKgPerS).toBeCloseTo(v('fuelFlowTakeoff'), 4);
    expect(s.tsfcKgPerNs ?? 0).toBeCloseTo(v('tsfcTakeoff'), 9);
    expect(s.egtDisplayedK).toBeLessThan(def.limits.egtTakeoffRedlineK);
    // the lag has settled: the steady-state helper gives the same operating point
    const steady = mockSteadyState(def, 1);
    expect(steady.n2Percent).toBeCloseTo(s.n2Percent, 6);
    expect(steady.egtDisplayedK).toBeCloseTo(s.egtDisplayedK, 6);
  });

  it('passes through the measured MPA point (65 % N1, 89.3 % N2, 585 C) and the EEDB fuel points', () => {
    expect(mockN1PercentFromN2(v('mpaN2'))).toBeCloseTo(v('mpaN1'), 9);
    expect(mockN1PercentFromN2(v('staticTakeoffN2'))).toBeCloseTo(v('staticTakeoffN1'), 9);
    const idleN1 = (v('idleN1Low') + v('idleN1High')) / 2;
    const lever = (v('mpaN1') - idleN1) / (v('staticTakeoffN1') - idleN1);
    const s = mockSteadyState(def, lever);
    expect(s.n1Percent).toBeCloseTo(v('mpaN1'), 6);
    expect(s.n2Percent).toBeCloseTo(v('mpaN2'), 6);
    expect(s.egtDisplayedK).toBeCloseTo(corrected(v('mpaEgt')), 6);
    // EEDB climb-out point: 85 % thrust burns 1.031 kg/s
    const co = mockSteadyState(def, leverForThrust(0.85));
    expect(co.netThrustN / v('takeoffThrust')).toBeCloseTo(0.85, 6);
    expect(co.fuelFlowKgPerS).toBeCloseTo(v('fuelFlowClimbOut'), 6);
  });

  it('accelerates from ground idle to 95 % takeoff thrust within C5 after a lever slam', () => {
    const m = idleModel();
    const limit = THRESHOLDS.C5.values.maxTimeS.value;
    const fraction = THRESHOLDS.C5.values.thrustFraction.value;
    let t95 = Number.POSITIVE_INFINITY;
    let t = 0;
    run(m, 8, { ...RUN, throttleLever: 1 }, (s) => {
      t += DT;
      if (t95 === Number.POSITIVE_INFINITY && s.netThrustN >= fraction * v('takeoffThrust'))
        t95 = t;
    });
    expect(t95).toBeLessThanOrEqual(limit);
    expect(t95).toBeGreaterThan(2); // a spool-up, not a step
  });

  it('keeps the station totals physically ordered at takeoff', () => {
    const s = mockSteadyState(def, 1);
    const p = (id: (typeof STATION_IDS)[number]) => s.stations[id].ptPa;
    const t = (id: (typeof STATION_IDS)[number]) => s.stations[id].ttK;
    expect(p('21')).toBeGreaterThan(p('2'));
    expect(p('24')).toBeGreaterThan(p('21'));
    expect(p('25')).toBe(p('24'));
    expect(p('3') / p('2')).toBeCloseTo(def.designPoint.pressureRatios.overall, 6);
    expect(p('13') / p('2')).toBeCloseTo(def.designPoint.pressureRatios.fanBypass, 6);
    for (const [a, b] of [
      ['3', '4'],
      ['4', '41'],
      ['41', '45'],
      ['45', '49.5'],
      ['49.5', '5'],
      ['5', '8'],
    ] as const) {
      expect(p(b)).toBeLessThanOrEqual(p(a));
    }
    expect(p('8')).toBeGreaterThan(ISA_SLS.pressurePa);
    expect(t('4')).toBeGreaterThanOrEqual(t('41'));
    expect(t('41')).toBeGreaterThan(t('45'));
    expect(t('45')).toBeGreaterThan(t('49.5'));
    expect(t('49.5')).toBeGreaterThan(t('5'));
    expect(t('5')).toBeGreaterThan(ISA_SLS.temperatureK);
    expect(s.stations['4'].fuelAirRatio).toBeLessThan(STOICHIOMETRIC_FAR);
    expect(s.stations['2'].wKgPerS).toBeCloseTo(def.designPoint.totalAirflowKgPerS, 6);
    expect(s.egtMeasuredK).toBe(s.stations['49.5'].ttK);
  });

  it('adds the TCDS display shunt only above its N2 ramp', () => {
    const idle = idleModel().state(); // ~8770 rpm N2: above 8500, full shunt
    expect(idle.n2Rpm).toBeGreaterThan(def.limits.egtShunt.fullN2Rpm);
    expect(idle.egtDisplayedK - idle.egtMeasuredK).toBeCloseTo(def.limits.egtShunt.offsetK, 9);
    const m = createMockCycle(def);
    m.reset('shutdown');
    const cranking = run(m, 5, { ...DEFAULT_CYCLE_INPUTS, starter: true });
    expect(cranking.n2Rpm).toBeLessThan(def.limits.egtShunt.rampStartN2Rpm);
    expect(cranking.egtDisplayedK).toBe(cranking.egtMeasuredK);
  });
});

/** The lever whose steady state gives this fraction of takeoff thrust (bisection). */
function leverForThrust(fraction: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mockSteadyState(def, mid).netThrustN / v('takeoffThrust') < fraction) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('mock start, shutdown and faults', () => {
  it('starts like the published ground run: fuel at 25 % N2, cut-out at 56 %, idle in about 60 s', () => {
    const m = createMockCycle(def);
    m.reset('shutdown');
    const phases = new Set<string>();
    let t = 0;
    let fuelOnAt = -1;
    let cutoutN2 = -1;
    let litAt = -1;
    let idleAt = -1;
    let peakEgt = 0;
    let prev = m.state();
    for (let i = 0; i < 90 / DT; i++) {
      // the pilot moves the start lever to idle at 25 % N2 (Widuri Table 5)
      const fuel = prev.n2Percent >= v('startFuelOnN2') || fuelOnAt >= 0;
      const s = m.step(DT, {
        ...DEFAULT_CYCLE_INPUTS,
        starter: true,
        ignition: 'auto',
        fuelLever: fuel ? 'run' : 'cutoff',
      });
      t += DT;
      phases.add(s.startPhase);
      if (fuel && fuelOnAt < 0) fuelOnAt = t;
      if (s.combustorLit && litAt < 0) litAt = t;
      if (prev.starterEngaged && !s.starterEngaged) cutoutN2 = s.n2Percent;
      if (idleAt < 0 && s.n2Percent >= v('idleN2Min') && s.startPhase === 'none') idleAt = t;
      peakEgt = Math.max(peakEgt, s.egtDisplayedK);
      prev = s;
    }
    expect([...phases]).toEqual(
      expect.arrayContaining(['cranking', 'ignition', 'accelerating', 'selfSustaining', 'none']),
    );
    expect(litAt - fuelOnAt).toBeCloseTo(v('lightOffDelay'), 1);
    expect(cutoutN2).toBeGreaterThanOrEqual(v('starterCutoutN2'));
    expect(cutoutN2).toBeLessThan(v('starterCutoutN2') + 0.5);
    expect(Math.abs(idleAt - v('startTime'))).toBeLessThan(10);
    expect(peakEgt).toBeLessThan(def.limits.egtStartLimitK);
    expect(peakEgt).toBeGreaterThan(corrected(v('startPeakEgt')) - 15);
    expect(prev.n2Percent).toBeGreaterThanOrEqual(v('idleN2Min'));
    expect(prev.fadec.mode).toBe('run');
    expect(prev.starterEngaged).toBe(false);
  });

  it('holds fuel back below the minimum fuel-on speed and flags a start with no light-off', () => {
    const m = createMockCycle(def);
    m.reset('shutdown');
    const early = run(m, 2, {
      ...DEFAULT_CYCLE_INPUTS,
      starter: true,
      fuelLever: 'run',
      ignition: 'auto',
    });
    expect(early.n2Percent).toBeLessThan(v('minFuelOnN2'));
    expect(early.fuelFlowKgPerS).toBe(0);
    // igniters off: fuel flows but never lights
    const wet = run(m, 30, {
      ...DEFAULT_CYCLE_INPUTS,
      starter: true,
      fuelLever: 'run',
      ignition: 'off',
    });
    expect(wet.fuelFlowKgPerS).toBeGreaterThan(0);
    expect(wet.combustorLit).toBe(false);
    expect(wet.flags.noLightOff).toBe(true);
    // releasing the start switch before light-off aborts the start
    const aborted = run(m, 1, { ...DEFAULT_CYCLE_INPUTS, fuelLever: 'cutoff' });
    expect(aborted.startPhase).toBe('aborted');
  });

  it('shuts down on fuel cut-off: unlit, spooling down, cooling', () => {
    const m = idleModel();
    const s = run(m, 30, { ...DEFAULT_CYCLE_INPUTS });
    expect(s.combustorLit).toBe(false);
    expect(s.fuelFlowKgPerS).toBe(0);
    expect(s.n2Percent).toBeLessThan(10);
    expect(s.egtDisplayedK).toBeLessThan(idleModel().state().egtDisplayedK);
    const off = run(m, 120, { ...DEFAULT_CYCLE_INPUTS });
    expect(off.fadec.mode).toBe('off');
  });

  it('flames out on demand and relights with the igniters on auto', () => {
    const m = idleModel();
    run(m, 1, { ...RUN, throttleLever: 0.8 });
    m.injectFault('flameout');
    const out = m.step(DT, { ...RUN, throttleLever: 0.8 });
    expect(out.flags.flameout).toBe(true);
    expect(out.combustorLit).toBe(false);
    expect(out.ignitersOn).toBe(true);
    const relit = run(m, v('lightOffDelay') + 0.5, { ...RUN, throttleLever: 0.8 });
    expect(relit.combustorLit).toBe(true);
    expect(relit.flags.flameout).toBe(false);
  });

  it('surges on demand for a few hundred milliseconds, with negative surge margin', () => {
    const m = idleModel();
    run(m, 10, { ...RUN, throttleLever: 1 });
    m.injectFault('surge');
    const s = m.step(DT, { ...RUN, throttleLever: 1 });
    expect(s.flags.surge).toBe(true);
    expect(s.hpc.surgeMarginFraction).toBeLessThan(0);
    const after = run(m, 1, { ...RUN, throttleLever: 1 });
    expect(after.flags.surge).toBe(false);
    expect(after.hpc.surgeMarginFraction).toBeGreaterThan(0);
  });

  it('follows the ambient: a hot day reads a hotter EGT at the same lever', () => {
    const hot = { ...ISA_SLS, temperatureK: 303.15 };
    const isa = mockSteadyState(def, 1);
    const day = mockSteadyState(def, 1, hot);
    expect(day.egtDisplayedK).toBeGreaterThan(isa.egtDisplayedK);
    expect(day.stations['0'].ttK).toBe(303.15);
    const m = createMockCycle(def);
    expect(m.reset('shutdown', hot).stations['2'].ttK).toBe(303.15);
  });
});
