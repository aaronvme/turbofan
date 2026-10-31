// D4-92 (b), W2H-B1, gated by PHYSICS.md P5b (D4-94): a held gas path recovers within a
// pre-registered bound on the DEFAULT reference model, at every frame step the app runs. Critic pass
// 15's scenario, from the app's own controls: ISA SLS, take-off at 3 s, Fault -> Surge at 10 s,
// Fault -> Flameout at 20 s, then the auto relight; 35 s. With D4-84's bounded retry it held
// 4.1-7.9 s at frame steps of 0.020-0.025 s, N1 climbing to 168-218 % on the held power balance,
// where D4-13's unbounded retry holds at most 0.15 s. The bound, written before the fix (D4-92 (b))
// and made a contract row by D4-94: at every frame step from 1/120 to 1/30 s, every held episode
// recovers within 0.5 s of sim time, and N1 never exceeds its redline while held.
//
// An episode is counted at step level, as the critic's probe counts it (tools/cycle/held-reach.ts
// prints the same table): a run of consecutive steps whose state is 'held', its length the steps
// times the frame step. Slow (a 35 s run per frame step): in the slow mutation set.
import { describe, expect, it, vi } from 'vitest';
import { ISA_SLS, type AmbientConditions } from '../../../src/contracts/ambient';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../../../src/contracts/cycle';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { ESCALATE_AFTER_S } from '../../../src/cycle/heldRetry';
import { createCycleModel } from '../../../src/cycle/model';
import { factValue } from '../../../src/engine/facts';
import { lazy } from './fixtures';

const TIMEOUT_MS = 300_000;
const P5B = THRESHOLDS.P5b.values;
/** P5b: every held episode recovers within this much sim time, s. */
const RECOVERY_BOUND_S = P5B.maxHeldEpisodeS.value;
/**
 * P5b's sample of its frame steps, 1/120 to 1/30 s, with the steps critic pass 15 saw run away
 * (the row lists them).
 */
const FRAME_STEPS_S = [1 / 120, 1 / 60, 0.02, 0.0205, 0.021, 0.025, 1 / 30];
/** The N1 redline, % (ENGINE_FACTS n1MaxRpm, TCDS IV.2: 104 %). */
const N1_REDLINE_PERCENT = (100 * factValue('n1MaxRpm')) / factValue('n1ReferenceRpm');
const SCENARIO_S = P5B.scenarioS.value;

interface Episode {
  readonly startS: number;
  steps: number;
  maxN1Percent: number;
}

interface Run {
  readonly episodes: readonly Episode[];
  readonly threw: unknown;
  readonly endS: number;
}

/** Critic pass 15's scenario (W2H-B1) on the default model at one frame step. */
function scenario(dtS: number, ambient: AmbientConditions = ISA_SLS): Run {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const m = createCycleModel();
  m.reset('groundIdle', ambient);
  const inputs = (t: number): CycleInputs => ({
    ...DEFAULT_CYCLE_INPUTS,
    fuelLever: 'run',
    ignition: 'auto',
    ambient,
    throttleLever: t < P5B.takeoffAtS.value ? 0 : 1,
  });
  const episodes: Episode[] = [];
  let open: Episode | null = null;
  let threw: unknown = null;
  let t = 0;
  try {
    for (let i = 0; i < Math.round(SCENARIO_S / dtS); i++) {
      t = i * dtS;
      if (Math.abs(t - P5B.surgeAtS.value) < dtS / 2) m.injectFault('surge');
      if (Math.abs(t - P5B.flameoutAtS.value) < dtS / 2) m.injectFault('flameout');
      const s = m.step(dtS, inputs(t));
      if (s.gasPathSolve.status !== 'held') {
        open = null;
        continue;
      }
      if (open === null) {
        open = { startS: t, steps: 0, maxN1Percent: 0 };
        episodes.push(open);
      }
      open.steps++;
      open.maxN1Percent = Math.max(open.maxN1Percent, s.n1Percent);
    }
  } catch (e) {
    threw = e;
  }
  warn.mockRestore();
  return { episodes, threw, endS: t };
}

const runs = new Map<number, () => Run>(FRAME_STEPS_S.map((dt) => [dt, lazy(() => scenario(dt))]));
const at = (dt: number): Run => {
  const r = runs.get(dt);
  if (r === undefined) throw new Error(`no run at dt ${dt}`);
  return r();
};

describe('P5b (D4-92 (b), D4-94): a held episode on the default model recovers within 0.5 s', () => {
  it.each(FRAME_STEPS_S)(
    'TO + surge + flameout + relight at dt %f s: every episode <= 0.5 s, N1 <= redline while held',
    { timeout: TIMEOUT_MS },
    (dt) => {
      const r = at(dt);
      expect(r.threw, `the run threw at ${r.endS.toFixed(3)} s`).toBeNull();
      // every episode that breaks the bound, so a failure shows them all
      const late = r.episodes
        .filter((e) => e.steps * dt > RECOVERY_BOUND_S + 1e-9)
        .map((e) => `from ${e.startS.toFixed(3)} s: held ${(e.steps * dt).toFixed(3)} s`);
      const over = r.episodes
        .filter((e) => e.maxN1Percent > N1_REDLINE_PERCENT)
        .map((e) => `from ${e.startS.toFixed(3)} s: N1 ${e.maxN1Percent.toFixed(1)} % held`);
      expect(late, `held longer than ${RECOVERY_BOUND_S} s`).toEqual([]);
      expect(over, `N1 above the ${N1_REDLINE_PERCENT.toFixed(1)} % redline while held`).toEqual(
        [],
      );
    },
  );

  it(
    'the scenario holds the gas path (or it would not test the bound)',
    { timeout: 4 * TIMEOUT_MS },
    () => {
      const held = FRAME_STEPS_S.reduce((k, dt) => k + at(dt).episodes.length, 0);
      expect(held).toBeGreaterThan(0);
    },
  );

  it('the redline is 104 % N1 (ENGINE_FACTS n1MaxRpm)', () => {
    expect(N1_REDLINE_PERCENT).toBeCloseTo(104, 1);
  });

  it("the sampled frame steps span P5b's range, 1/120 to 1/30 s, both ends included", () => {
    const fastest = 1 / P5B.maxStepRateHz.value;
    const slowest = 1 / P5B.minStepRateHz.value;
    expect(Math.min(...FRAME_STEPS_S)).toBe(fastest);
    expect(Math.max(...FRAME_STEPS_S)).toBe(slowest);
    for (const dt of FRAME_STEPS_S) {
      expect(dt).toBeGreaterThanOrEqual(fastest);
      expect(dt).toBeLessThanOrEqual(slowest);
    }
  });

  it("the escalation is P5b's recorded exception: once per episode, after 0.25 s held", () => {
    expect(ESCALATE_AFTER_S).toBe(P5B.escalateAfterS.value);
    expect(ESCALATE_AFTER_S).toBeLessThan(RECOVERY_BOUND_S);
  });
});
