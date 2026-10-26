// The transient model off the happy path: rejected inputs, ambient changes, each FADEC limiter
// taking over, the decel schedule, flameout and relight, fuel cutoff, start aborts and a surge
// episode's fuel cut. Thresholds and limits come from facts.ts / the engine definition.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  validateCycleState,
  type CycleInputs,
  type CycleModel,
  type CycleState,
  type FadecLimiter,
} from '../../../src/contracts/cycle';
import type { EngineDefinition } from '../../../src/contracts/engine';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { factValue } from '../../../src/engine/facts';
import { createCycleModel } from '../../../src/cycle/model';

const refs = { n1Rpm: factValue('n1ReferenceRpm'), n2Rpm: factValue('n2ReferenceRpm') };
const inputs = (over: Partial<CycleInputs> = {}): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  ...over,
});

function run(m: CycleModel, seconds: number, dt: number, f: () => CycleInputs): CycleState[] {
  const out: CycleState[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) out.push(m.step(dt, f()));
  return out;
}

const last = (s: readonly CycleState[]): CycleState => {
  const x = s[s.length - 1];
  if (x === undefined) throw new Error('no states');
  return x;
};

/** The FADEC's own margin under each overspeed redline (model.ts: limit - 1 %). */
const OVERSPEED_MARGIN_PERCENT = 1;

describe('CycleModel.step input checks', () => {
  it('rejects invalid inputs and time steps without advancing the state', () => {
    const m = createCycleModel();
    const before = m.reset('groundIdle', ISA_SLS);
    expect(() => m.step(0.05, inputs({ throttleLever: 1.5 }))).toThrow(/invalid cycle inputs/);
    expect(() => m.step(-0.01, inputs())).toThrow(/dtS/);
    expect(() => m.step(1.5, inputs())).toThrow(/dtS/);
    expect(() => m.step(Number.NaN, inputs())).toThrow(/dtS/);
    expect(m.state()).toBe(before);
    // dt = 0 is allowed: no time passes
    expect(m.step(0, inputs()).timeS).toBe(0);
  });
});

describe('FADEC limiters and schedules', { timeout: 120_000 }, () => {
  it('a hot day above the flat rating rebuilds the schedules: the N1 limiter caps the lever', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    const isa = last(run(m, 15, 0.05, () => inputs({ throttleLever: 1 })));
    expect(isa.fadec.limiter).toBe('n1Target');
    // 40 C: 10 K above flatRatingTemperature, so takeoff N1 is held at the 30 C corrected value
    const hot = { ...ISA_SLS, temperatureK: factValue('flatRatingTemperature') + 10 };
    const s = last(run(m, 15, 0.05, () => inputs({ throttleLever: 1, ambient: hot })));
    expect(s.fadec.n1TargetPercent).toBeGreaterThan(isa.fadec.n1TargetPercent);
    expect(s.fadec.limiter).toBe('n1Max');
    expect(s.n1Rpm).toBeLessThanOrEqual(factValue('n1MaxRpm'));
    expect(s.n1Percent).toBeCloseTo((100 * factValue('n1MaxRpm')) / refs.n1Rpm - 1, 1);
    // past the flat rating corner the engine can no longer make rated thrust
    expect(s.netThrustN).toBeLessThan(factValue('takeoffThrust'));
    expect(s.netThrustN).toBeGreaterThan(0.9 * factValue('takeoffThrust'));
    expect(s.egtDisplayedK).toBeLessThan(factValue('egtTakeoffLimit'));
    expect(validateCycleState(s, refs)).toEqual([]);
  });

  /** Lever to maximum over rampS (0 = a slam), held for the rest of the run. */
  function capped(def: EngineDefinition, seconds: number, rampS = 0): CycleState[] {
    const m = createCycleModel({}, def);
    m.reset('groundIdle', ISA_SLS);
    const lever = () => (rampS > 0 ? Math.min(1, m.state().timeS / rampS) : 1);
    return run(m, seconds, 0.05, () => inputs({ throttleLever: lever() }));
  }

  it('the N2 limiter holds N2 under a lowered N2 redline', () => {
    // the redline 1 % under the rated-takeoff N2 (100 %), so the limiter must take over from
    // the N1 loop. A 10 s lever advance: on a slam to a redline this close the limiter
    // overshoots it by up to 0.9 % (see the w1-cycle handoff).
    const n2Max = 0.99 * refs.n2Rpm;
    const s = capped(
      { ...ENGINE_DEFINITION, limits: { ...ENGINE_DEFINITION.limits, n2MaxRpm: n2Max } },
      25,
      10,
    );
    const end = last(s);
    expect(end.fadec.limiter).toBe('n2Max');
    expect(end.n2Percent).toBeCloseTo(99 - OVERSPEED_MARGIN_PERCENT, 1);
    for (const x of s) expect(x.n2Rpm).toBeLessThanOrEqual(n2Max);
  });

  it('the EGT limiter holds displayed EGT under a lowered transient limit', () => {
    // 1100 K displayed (827 C) is below the ISA takeoff EGT (about 1140 K), so it must bite
    const egtMax = 1100;
    const s = capped(
      { ...ENGINE_DEFINITION, limits: { ...ENGINE_DEFINITION.limits, egtTransientK: egtMax } },
      30,
    );
    const end = last(s);
    expect(end.fadec.limiter).toBe('egtMax');
    // settled on the limiter's target (5 K under the limit), without chattering off it
    expect(end.egtDisplayedK).toBeCloseTo(egtMax - 5, 0);
    for (const x of s.slice(-40)) expect(x.fadec.limiter).toBe('egtMax');
    for (const x of s) expect(x.egtDisplayedK).toBeLessThan(egtMax);
    expect(end.netThrustN).toBeLessThan(0.95 * factValue('takeoffThrust'));
  });

  it('a slam decel rides the decel schedule without flameout, then the idle floor takes over', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    run(m, 15, 0.05, () => inputs({ throttleLever: 1 }));
    const states = run(m, 45, 0.05, () => inputs({ throttleLever: 0 }));
    const seen = new Set<FadecLimiter>(states.map((s) => s.fadec.limiter));
    expect(seen.has('decelSchedule')).toBe(true);
    expect(last(states).fadec.limiter).toBe('idleFloor');
    for (const s of states) {
      expect(s.combustorLit).toBe(true);
      expect(s.flags.flameout).toBe(false);
      expect(s.flags.surge).toBe(false);
      expect(validateCycleState(s, refs)).toEqual([]);
    }
    const end = last(states);
    expect(end.n2Percent).toBeGreaterThanOrEqual(factValue('idleN2Min'));
    expect(end.n1Percent).toBeGreaterThanOrEqual(factValue('idleN1Min'));
    expect(end.n1Percent).toBeLessThanOrEqual(factValue('idleN1Max'));
  });

  it('the selected loop goes accel schedule -> n1Target on a slam accel from idle', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    const states = run(m, 15, 0.05, () => inputs({ throttleLever: 1 }));
    const seq = states.map((s) => s.fadec.limiter);
    const firstAccel = seq.indexOf('accelSchedule');
    expect(firstAccel).toBeGreaterThanOrEqual(0);
    expect(seq.lastIndexOf('n1Target')).toBeGreaterThan(firstAccel);
    expect(last(states).fadec.limiter).toBe('n1Target');
  });

  it('a definition without VSV schedules reports zero closure', () => {
    const m = createCycleModel({}, { ...ENGINE_DEFINITION, vsvSchedules: [] });
    expect(m.reset('groundIdle', ISA_SLS).vsvClosureRad).toBe(0);
    const ref = createCycleModel();
    // the reference schedule closes the VSVs at idle and opens them at takeoff
    expect(ref.reset('groundIdle', ISA_SLS).vsvClosureRad).toBeGreaterThan(0.1);
  });
});

describe('flameout, relight and shutdown', { timeout: 120_000 }, () => {
  it('auto ignition relights a flameout after the light-off delay and recovers to idle', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    m.injectFault('flameout');
    const states = run(m, 15, 0.05, () => inputs());
    const first = states[0];
    expect(first?.combustorLit).toBe(false);
    expect(first?.flags.flameout).toBe(true);
    expect(first?.ignitersOn).toBe(true);
    const relit = states.findIndex((s) => s.combustorLit);
    expect(relit).toBeGreaterThan(0);
    const tRelight = states[relit]?.timeS ?? 0;
    expect(tRelight).toBeGreaterThanOrEqual(factValue('lightOffDelay'));
    expect(tRelight).toBeLessThan(factValue('lightOffDelay') + 0.2);
    // unlit: no fuel and the spools run down; lit again: back to the idle floor
    for (const s of states.slice(0, relit)) expect(s.fuelFlowKgPerS).toBe(0);
    expect(states[relit - 1]?.n2Percent ?? Infinity).toBeLessThan(factValue('idleN2Min'));
    const end = last(states);
    expect(end.fadec.mode).toBe('run');
    expect(end.ignitersOn).toBe(false);
    expect(end.n2Percent).toBeGreaterThanOrEqual(factValue('idleN2Min'));
    for (const s of states) expect(validateCycleState(s, refs)).toEqual([]);
  });

  it('with the igniters off a flameout stays out and both spools run down', () => {
    const m = createCycleModel();
    const idle = m.reset('groundIdle', ISA_SLS);
    m.injectFault('flameout');
    const states = run(m, 10, 0.1, () => inputs({ ignition: 'off' }));
    for (const s of states) {
      expect(s.combustorLit).toBe(false);
      expect(s.ignitersOn).toBe(false);
      expect(s.fuelFlowKgPerS).toBe(0);
    }
    const end = last(states);
    expect(end.n1Rpm).toBeLessThan(0.8 * idle.n1Rpm);
    expect(end.n2Rpm).toBeLessThan(0.8 * idle.n2Rpm);
  });

  it('fuel cutoff shuts the engine down; the starter during the run-down re-enters a start', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    const states = run(m, 20, 0.1, () => inputs({ fuelLever: 'cutoff' }));
    let prev = Infinity;
    for (const s of states) {
      expect(s.fadec.mode).toBe('shutdown');
      expect(s.startPhase).toBe('none');
      expect(s.combustorLit).toBe(false);
      expect(s.fuelFlowKgPerS).toBe(0);
      expect(s.fadec.limiter).toBe('none');
      expect(s.n2Rpm).toBeLessThan(prev);
      prev = s.n2Rpm;
    }
    const s = m.step(0.1, inputs({ fuelLever: 'cutoff', starter: true }));
    expect(s.fadec.mode).toBe('start');
    expect(s.startPhase).toBe('cranking');
    expect(s.starterEngaged).toBe(true);
  });
});

describe('start aborts', { timeout: 120_000 }, () => {
  it('releasing the starter while cranking aborts the start', () => {
    const m = createCycleModel();
    m.reset('shutdown', ISA_SLS);
    const crank = last(run(m, 8, 0.1, () => inputs({ starter: true, fuelLever: 'cutoff' })));
    expect(crank.startPhase).toBe('cranking');
    expect(crank.starterEngaged).toBe(true);
    expect(crank.n2Percent).toBeGreaterThan(10);
    const s = m.step(0.1, inputs({ starter: false, fuelLever: 'cutoff' }));
    expect(s.startPhase).toBe('aborted');
    expect(s.starterEngaged).toBe(false);
    const later = last(run(m, 5, 0.1, () => inputs({ starter: false, fuelLever: 'cutoff' })));
    expect(later.n2Rpm).toBeLessThan(s.n2Rpm);
    expect(later.fuelFlowKgPerS).toBe(0);
  });

  it('fuel cutoff after light-off puts out the fire; with the starter held it is a dry crank', () => {
    const m = createCycleModel();
    m.reset('shutdown', ISA_SLS);
    let fuel = false;
    let lit: CycleState | null = null;
    for (let i = 0; i < 400 && lit === null; i++) {
      if (m.state().n2Percent >= factValue('startFuelOnN2')) fuel = true;
      const s = m.step(0.1, inputs({ starter: true, fuelLever: fuel ? 'run' : 'cutoff' }));
      if (s.combustorLit) lit = s;
    }
    expect(lit?.startPhase).toBe('accelerating');
    const cut = m.step(0.1, inputs({ starter: true, fuelLever: 'cutoff' }));
    expect(cut.combustorLit).toBe(false);
    expect(cut.fuelFlowKgPerS).toBe(0);
    expect(cut.startPhase).toBe('cranking');
    const released = m.step(0.1, inputs({ starter: false, fuelLever: 'cutoff' }));
    expect(released.startPhase).toBe('aborted');
  });
});

describe('surge episode', { timeout: 120_000 }, () => {
  it('cuts the fuel at onset, reports a negative HPC margin, and ends after the episode', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    const before = last(run(m, 10, 0.05, () => inputs({ throttleLever: 0.6 })));
    expect(before.flags.surge).toBe(false);
    m.injectFault('surge');
    const onset = m.step(0.02, inputs({ throttleLever: 0.6 }));
    expect(onset.flags.surge).toBe(true);
    expect(onset.hpc.surgeMarginFraction).toBeLessThan(0);
    expect(onset.fuelFlowKgPerS).toBeLessThan(0.85 * before.fuelFlowKgPerS);
    const after = run(m, 1, 0.02, () => inputs({ throttleLever: 0.6 }));
    expect(last(after).flags.surge).toBe(false);
    expect(last(after).hpc.surgeMarginFraction).toBeGreaterThan(0);
  });
});
