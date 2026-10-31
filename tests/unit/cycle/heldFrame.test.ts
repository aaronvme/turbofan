// D4-84 on the whole model, gated by PHYSICS.md P5 (D4-90). The bar is "held frame <= 16.7 ms on
// the same ramp" (the W1K-I2 part-power fit's 1 s lever ramp from ground idle, the case
// tests/browser/app.test.tsx's W2F-N5 row runs, stepped at the app's 60 Hz). Node cannot gate a
// frame time on a shared machine, so P5 gates the step's work in the budget's own deterministic
// unit, gas-path evaluations: a step that starts held spends at most the budget plus one Newton
// iteration, and any step at most that plus one converged direct solve. The wall time is a record
// (tools/cycle/held-cost.ts here, the browser row there).
import { describe, expect, it, vi } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  type CycleInputs,
  type CycleState,
} from '../../../src/contracts/cycle';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import {
  PART_POWER_FIT_CALIBRATION,
  gasPathEvaluations,
  referenceEngine,
  solveGasPath,
  type GasPathSolution,
} from '../../../src/cycle/engine';
import { HELD_RETRY_BUDGET, RETRY_OVERSHOOT, UNBOUNDED_RETRY } from '../../../src/cycle/heldRetry';
import { ACCEPTED_RESIDUAL } from '../../../src/cycle/matchedSolve';
import { createCycleModel, type CycleModelOptions } from '../../../src/cycle/model';
import { withCalibration } from '../../../src/cycle/partPower';
import { lazy } from './fixtures';

const TIMEOUT_MS = 240_000;
const P5 = THRESHOLDS.P5.values;
const DT = 1 / P5.stepRateHz.value;
/** The browser row boots at idle and waits 3 s before the ramp. */
const RAMP_FROM_S = 3;
/**
 * W2H-N3: the gated run lasts 20 s from the ramp's start, the length tools/cycle/held-cost.ts and
 * the handoffs measure (it was 10 s, which left the fit's second held episode, then at 13.05 s,
 * outside). P5's row does not state a length; the handoff asks for one.
 */
const GATED_S = 20;
/**
 * The largest converged direct solve in the whole cycle suite: 77 gas-path evaluations (10 Newton
 * iterations; an instrumented run of tests/unit/cycle, 2026-10-30). A 60 Hz step has two
 * snapshots, so a step that starts matched carries at most one converged solve before its retry.
 */
const CONVERGED_DIRECT = 80;

const fit = lazy(() => withCalibration(referenceEngine(), PART_POWER_FIT_CALIBRATION));
const inputs = (over: Partial<CycleInputs> = {}): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  ...over,
});

interface Step {
  readonly s: CycleState;
  readonly evals: number;
  readonly cause: string | null;
  /** D4-92 (c): this step ran an episode's one escalation (D4-13's whole walk, unbudgeted). */
  readonly escalated: boolean;
}

/** The fit at ground idle, the lever ramped to take-off over 1 s from RAMP_FROM_S, at 60 Hz. */
function ramp(seconds: number, opts: CycleModelOptions = {}) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const m = createCycleModel({ engine: fit(), ...opts });
  m.reset('groundIdle', ISA_SLS);
  const steps: Step[] = [];
  const n = Math.round((RAMP_FROM_S + seconds) / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const ramped = (t - RAMP_FROM_S) / P5.leverRampS.value;
    const lever = t < RAMP_FROM_S ? 0 : Math.max(0.01, Math.min(1, ramped));
    const e0 = gasPathEvaluations();
    const x0 = m.heldRetryEscalations();
    const s = m.step(DT, inputs({ throttleLever: lever }));
    const escalated = m.heldRetryEscalations() > x0;
    steps.push({ s, evals: gasPathEvaluations() - e0, cause: m.lostSolveCause(), escalated });
  }
  const warnings = warn.mock.calls.length;
  warn.mockRestore();
  return { m, steps, warnings };
}

const held = (s: Step | undefined) => s?.s.gasPathSolve.status === 'held';

describe('D4-84: the held frame on the part-power fit ramp', { timeout: TIMEOUT_MS }, () => {
  const run = lazy(() => ramp(GATED_S));

  it('the case holds the gas path (or it would not test the bar)', () => {
    const { steps } = run();
    expect(steps.some(held)).toBe(true);
    expect(steps[steps.length - 1]?.s.gasPathSolve.lostSolves ?? 0).toBeGreaterThan(0);
  });

  it("the retry's own bounds fit the P5 row", () => {
    expect(HELD_RETRY_BUDGET + RETRY_OVERSHOOT).toBeLessThanOrEqual(
      P5.maxHeldStepEvaluations.value,
    );
    expect(HELD_RETRY_BUDGET + RETRY_OVERSHOOT + CONVERGED_DIRECT).toBeLessThanOrEqual(
      P5.maxStepEvaluations.value,
    );
  });

  it('P5: a step that starts held spends at most the budget plus one Newton iteration', () => {
    const { steps } = run();
    let checked = 0;
    steps.forEach((k, i) => {
      // D4-92 (c): an episode's one escalation is the exception beside P5, like the sub-idle entry
      if (!held(steps[i - 1]) || k.escalated) return;
      checked++;
      expect(k.evals, `step at ${k.s.timeS.toFixed(3)} s`).toBeLessThanOrEqual(
        P5.maxHeldStepEvaluations.value,
      );
    });
    expect(checked).toBeGreaterThan(10);
  });

  it('P5: every step of the ramp, held or matched, at most one converged direct solve more', () => {
    const { steps } = run();
    const worst = Math.max(...steps.filter((k) => !k.escalated).map((k) => k.evals));
    expect(worst).toBeLessThanOrEqual(P5.maxStepEvaluations.value);
  });

  it('D4-92 (c): the exception beside P5 is at most one escalated step per held episode', () => {
    const { steps, warnings } = run();
    const escalated = steps.filter((k) => k.escalated);
    expect(escalated.length).toBeGreaterThan(0);
    // the warnings count the episodes exactly (W2F-I1)
    expect(escalated.length).toBeLessThanOrEqual(warnings);
    escalated.forEach((k) => {
      expect(k.s.gasPathSolve.lostSolves).toBeGreaterThan(0);
    });
  });

  it('the hold stays visible: status, count, cause, one warning per held episode (W2F-I1)', () => {
    const { steps, warnings } = run();
    // An episode is a run of lost snapshots; a 60 Hz step has two, so one that loses a solve after
    // a matched step starts exactly one episode, and one after a held step at most one (its first
    // snapshot matched, its second lost).
    let surely = 0;
    let atMost = 0;
    let lost = 0;
    steps.forEach((k, i) => {
      const n = k.s.gasPathSolve.lostSolves;
      if (held(k)) {
        expect(n).toBeGreaterThan(lost);
        expect(k.cause).not.toBeNull();
      } else {
        expect(k.s.gasPathSolve.status).toBe('matched');
      }
      if (n > lost) {
        atMost++;
        if (!held(steps[i - 1])) surely++;
      }
      lost = n;
    });
    expect(surely).toBeGreaterThan(0);
    expect(warnings).toBeGreaterThanOrEqual(surely);
    expect(warnings).toBeLessThanOrEqual(atMost);
    // once per episode, not once per lost solve
    expect(warnings).toBeLessThan(lost / 10);
  });

  it('the solve recovers, on the root an unbudgeted solve finds from its warm start', () => {
    const calls: { args: Parameters<typeof solveGasPath>; out: GasPathSolution }[] = [];
    const recording: typeof solveGasPath = (...args) => {
      const out = solveGasPath(...args);
      calls.push({ args, out });
      return out;
    };
    const { steps } = ramp(10, { gasPathSolver: recording });
    const back = steps.findIndex((k, i) => held(steps[i - 1]) && !held(k));
    expect(back, 'a recovery').toBeGreaterThan(0);
    // the recovering solve: the last accepted call (the step's last snapshot is matched)
    const accepted = calls.filter(
      (k) =>
        k.out.maxResidual < ACCEPTED_RESIDUAL && k.out.stopped !== true && (k.out.x[1] ?? 0) > 1,
    );
    const at = accepted.find((k) => k.out.point.netThrustN === steps[back]?.s.netThrustN);
    expect(at, 'the solve behind the recovered state').toBeDefined();
    if (at === undefined) return;
    const [e, c, n1, n2, wf, guess] = at.args;
    // unbudgeted from the same warm start: the same iterates, so the same root to the bit
    expect(solveGasPath(e, c, n1, n2, wf, guess).x).toEqual(at.out.x);
    // and from a perturbed start Newton converges on the same root within its tolerance
    const other = solveGasPath(
      e,
      c,
      n1,
      n2,
      wf,
      at.out.x.map((v) => v * (1 + 1e-3)),
    );
    expect(other.maxResidual).toBeLessThan(ACCEPTED_RESIDUAL);
    other.x.forEach((v, i) => {
      expect(v).toBeCloseTo(at.out.x[i] ?? NaN, 6);
    });
  });
});

describe('D4-84: the matched path is unchanged', { timeout: TIMEOUT_MS }, () => {
  /** A scenario on the reference engine at dt 0.05 s: every state, and the lost count at its end. */
  function scenario(opts: CycleModelOptions, kind: 'slam' | 'relight' | 'start'): CycleState[] {
    const m = createCycleModel(opts);
    const out: CycleState[] = [];
    const go = (seconds: number, f: () => CycleInputs) => {
      for (let i = 0; i < Math.round(seconds / 0.05); i++) out.push(m.step(0.05, f()));
    };
    if (kind === 'start') {
      m.reset('shutdown', ISA_SLS);
      let fuel = false;
      go(60, () => {
        if (m.state().n2Percent >= 25) fuel = true;
        return inputs({ starter: true, fuelLever: fuel ? 'run' : 'cutoff' });
      });
    } else if (kind === 'relight') {
      m.reset('groundIdle', ISA_SLS);
      m.injectFault('flameout');
      go(12, () => inputs());
    } else {
      m.reset('groundIdle', ISA_SLS);
      go(8, () => inputs({ throttleLever: Math.min(1, m.state().timeS) }));
      go(6, () => inputs({ throttleLever: 0 }));
    }
    return out;
  }

  it.each(['slam', 'relight', 'start'] as const)(
    '%s: with no lost solve the budgeted model is the D4-13 model, bit for bit',
    (kind) => {
      const budgeted = scenario({}, kind);
      const unbounded = scenario({ heldRetry: UNBOUNDED_RETRY }, kind);
      expect(budgeted[budgeted.length - 1]?.gasPathSolve).toEqual({
        status: 'matched',
        lostSolves: 0,
      });
      expect(budgeted).toEqual(unbounded);
    },
  );
});

describe('D4-84: the retry options', () => {
  it('rejects a budget that is not positive and a walk interval that is negative', () => {
    expect(() => createCycleModel({ heldRetry: { budget: 0 } })).toThrow(/budget/);
    expect(() => createCycleModel({ heldRetry: { budget: Number.NaN } })).toThrow(/budget/);
    expect(() => createCycleModel({ heldRetry: { walkIntervalS: -1 } })).toThrow(/walkIntervalS/);
    expect(() => createCycleModel({ heldRetry: UNBOUNDED_RETRY })).not.toThrow();
  });
});
