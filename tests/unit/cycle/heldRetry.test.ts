// D4-84: the held gas path's retry is bounded per step, so a held frame stays inside the 16.7 ms
// frame budget (W2F-N5: on the part-power fit's 1 s lever ramp a held step cost 411-602 ms in the
// worker against 1.7-3.6 ms matched). (a) The direct solve is tried each step and the continuation
// walk sets out at most once per WALK_INTERVAL_S of sim time; (b) the retry spends a per-step work
// budget and what is left of the walk resumes on the next step. Deterministic: the budget's meter is
// a work count (gas-path evaluations by default, a test double's own count here), never a clock.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { at } from '../../../src/cycle/at';
import {
  MAX_NEWTON_ITERATIONS,
  evaluateGasPath,
  gasPathEvaluations,
  groundIdle,
  solveGasPath,
  type GasPathSolution,
  type OperatingConditions,
} from '../../../src/cycle/engine';
import {
  DIRECT_SHARE,
  HELD_RETRY_BUDGET,
  NO_RETRY,
  RETRY_OVERSHOOT,
  WALK_INTERVAL_S,
  retryMatched,
  type RetryPolicy,
  type RetryState,
} from '../../../src/cycle/heldRetry';
import {
  MIN_CONTINUATION_STEP,
  advanceWalk,
  solveMatched,
  startWalk,
  type GasPathAnchor,
  type GasPathSolver,
  type GasPathTarget,
} from '../../../src/cycle/matchedSolve';
import { newton } from '../../../src/cycle/newton';
import { factValue } from '../../../src/engine/facts';
import { REF, lazy } from './fixtures';

const C: OperatingConditions = { ambient: ISA_SLS, customerBleedFraction: 0, powerExtractionW: 0 };
const idle = lazy(() => groundIdle(REF, C));
const idleAnchor = (): GasPathAnchor => ({
  n1Rpm: idle().point.n1Rpm,
  n2Rpm: idle().point.n2Rpm,
  wfKgPerS: idle().point.fuelFlowKgPerS,
  x: idle().unknowns.slice(0, 6),
});
/** A start at the sub-idle switch (matchedSolve.test.ts): the direct solve fails, the walk converges. */
const START: GasPathTarget = {
  n1Rpm: 0.1854 * factValue('n1ReferenceRpm'),
  n2Rpm: 0.5702 * factValue('n2ReferenceRpm'),
  wfKgPerS: 0.0783,
};

describe('D4-84: Newton stops between iterations and resumes on the same iterates', () => {
  // a 2-D system Newton needs several iterations for (a stiff, coupled root at (2, 0))
  const f = (x: number[]) => [Math.atan(at(x, 0) - 2) + 0.1 * at(x, 1), at(x, 1) ** 3 + at(x, 1)];
  const opts = { tolerance: 1e-12, maxIterations: 20, maxStep: [10, 10] };

  it('a stop that never fires changes nothing', () => {
    const plain = newton(f, [5, 1], opts);
    const watched = newton(f, [5, 1], { ...opts, stop: () => false });
    expect(watched.x).toEqual(plain.x);
    expect(watched.iterations).toBe(plain.iterations);
    expect(plain.stopped).toBe(false);
    expect(watched.stopped).toBe(false);
  });

  it('stops before an iteration, unconverged, and the resumed solve ends on the same x', () => {
    const plain = newton(f, [5, 1], opts);
    expect(plain.converged).toBe(true);
    expect(plain.iterations).toBeGreaterThan(3);
    for (let k = 1; k < plain.iterations; k++) {
      let n = 0;
      const cut = newton(f, [5, 1], { ...opts, stop: () => ++n > k });
      expect(cut.stopped).toBe(true);
      expect(cut.converged).toBe(false);
      expect(cut.iterations).toBe(k);
      const rest = newton(f, cut.x, { ...opts, maxIterations: opts.maxIterations - k });
      expect(rest.x).toEqual(plain.x);
      expect(k + rest.iterations).toBe(plain.iterations);
    }
  });

  it('a converged or exhausted solve never asks the stop', () => {
    let asked = 0;
    const r = newton((x) => [at(x, 0) - 1], [1], { ...opts, stop: () => (asked++, true) });
    expect(r.converged).toBe(true);
    expect(r.stopped).toBe(false);
    expect(asked).toBe(0);
  });
});

describe('D4-84: the gas-path solve takes a stop and an iteration limit, and counts its work', () => {
  it('gasPathEvaluations counts every evaluation of the gas path', () => {
    const p = idle().point;
    const x = idle().unknowns.slice(0, 6);
    const e0 = gasPathEvaluations();
    evaluateGasPath(REF, C, p.n1Rpm, p.n2Rpm, p.fuelFlowKgPerS, x);
    evaluateGasPath(REF, C, p.n1Rpm, p.n2Rpm, p.fuelFlowKgPerS, x);
    expect(gasPathEvaluations() - e0).toBe(2);
  });

  it('a stopped solve says so and resumes to the same root as one never stopped', () => {
    const a = idleAnchor();
    const n2 = 1.05 * a.n2Rpm;
    const plain = solveGasPath(REF, C, a.n1Rpm, n2, 1.1 * a.wfKgPerS, a.x);
    expect(plain.stopped).toBe(false);
    expect(plain.iterations).toBeGreaterThan(1);
    let n = 0;
    const cut = solveGasPath(REF, C, a.n1Rpm, n2, 1.1 * a.wfKgPerS, a.x, true, {
      stop: () => ++n > 1,
    });
    expect(cut.stopped).toBe(true);
    expect(cut.iterations).toBe(1);
    const rest = solveGasPath(REF, C, a.n1Rpm, n2, 1.1 * a.wfKgPerS, cut.x, true, {
      maxIterations: MAX_NEWTON_ITERATIONS - 1,
    });
    expect(rest.x).toEqual(plain.x);
    expect(rest.point.netThrustN).toBe(plain.point.netThrustN);
  });
});

/** Repeats advanceWalk on one walk, each call stopped after `slice` evaluations, until it ends. */
function sliced(solve: GasPathSolver, anchor: GasPathAnchor, target: GasPathTarget, slice: number) {
  let walk = startWalk(anchor, target);
  for (let calls = 1; calls < 10_000; calls++) {
    const e0 = gasPathEvaluations();
    const r = advanceWalk(
      solve,
      REF,
      C,
      walk,
      { cause: null },
      () => gasPathEvaluations() - e0 >= slice,
    );
    if (r.kind !== 'paused') return { r, calls };
    walk = r.walk;
  }
  throw new Error('the walk never ended');
}

describe('D4-84: a continuation walk spread over several steps makes the same solves', () => {
  it("the start's walk, sliced at 5, 23 and 60 evaluations, ends on the unsliced root bit for bit", () => {
    const whole = solveMatched(
      solveGasPath,
      REF,
      C,
      idleAnchor(),
      START.n1Rpm,
      START.n2Rpm,
      START.wfKgPerS,
    );
    expect(whole).not.toBeNull();
    for (const slice of [5, 23, 60]) {
      const { r, calls } = sliced(solveGasPath, idleAnchor(), START, slice);
      expect(r.kind).toBe('solved');
      expect(calls).toBeGreaterThan(1);
      if (r.kind !== 'solved') continue;
      expect(r.solution.x).toEqual(whole?.x);
      expect(r.solution.point.stations).toEqual(whole?.point.stations);
    }
  });

  it('the sliced walk tries the same points in the same order (a resumed solve repeats its point)', () => {
    const record = () => {
      const pts: number[] = [];
      const solve: GasPathSolver = (...args) => {
        const n2 = args[3];
        if (pts[pts.length - 1] !== n2) pts.push(n2);
        return solveGasPath(...args);
      };
      return { pts, solve };
    };
    const a = record();
    const whole = advanceWalk(a.solve, REF, C, startWalk(idleAnchor(), START), { cause: null });
    expect(whole.kind).toBe('solved');
    const b = record();
    sliced(b.solve, idleAnchor(), START, 17);
    expect(b.pts).toEqual(a.pts);
  });

  it('a walk that fails everywhere is lost at MIN_CONTINUATION_STEP, however it is sliced', () => {
    const failing: GasPathSolver = (...args) => ({ ...solveGasPath(...args), maxResidual: 1 });
    const { r } = sliced(failing, idleAnchor(), START, 40);
    expect(r.kind).toBe('lost');
    expect(MIN_CONTINUATION_STEP).toBe(1 / 256);
  });
});

// ---------------------------------------------------------------------------------------------
// The retry policy, on a Newton double that honours the stop and the iteration limit as
// solveGasPath does: one meter unit for its starting residual, PER_ITERATION per iteration, one for
// its point. need(n2, from) is the iterations it takes to converge at n2 from a guess converged at
// `from` (Infinity: never, like the fit's held state, which runs to C7's 25); giveUpAfter models a
// solve that fails at once (a singular Jacobian). The double keeps where a guess converged in
// unknown 0 and its progress on a paused problem in a seventh unknown.

const PER_ITERATION = 7;

function fakeNewton(need: (n2Rpm: number, from: number) => number, giveUpAfter = Infinity) {
  const fake = { meter: 0, calls: [] as { n2Rpm: number; resumed: boolean }[] };
  const solve: GasPathSolver = (_e, _c, _n1, n2, _wf, guess, _lit, control) => {
    const from = guess[0] ?? NaN;
    const done0 = guess[6] ?? 0;
    fake.calls.push({ n2Rpm: n2, resumed: done0 > 0 });
    const max = Math.min(control?.maxIterations ?? MAX_NEWTON_ITERATIONS, giveUpAfter);
    const needed = need(n2, from) - done0;
    let it = 0;
    let stopped = false;
    fake.meter += 1;
    while (it < needed && it < max) {
      if (control?.stop?.() === true) {
        stopped = true;
        break;
      }
      it++;
      fake.meter += PER_ITERATION;
    }
    fake.meter += 1;
    const converged = !stopped && it >= needed;
    return {
      point: idle().point,
      x: converged ? [n2, 6, 0.5, 0.5, 0.5, 0.5] : [from, 6, 0.5, 0.5, 0.5, 0.5, done0 + it],
      iterations: it,
      converged,
      maxResidual: converged ? 0 : 1e-3,
      stopped,
    } satisfies GasPathSolution;
  };
  return { fake, solve };
}

const anchorAt = (n2Rpm: number): GasPathAnchor => ({
  n1Rpm: 1000,
  n2Rpm,
  wfKgPerS: 0.1,
  x: [n2Rpm, 6, 0.5, 0.5, 0.5, 0.5],
});
const targetAt = (n2Rpm: number): GasPathTarget => ({ n1Rpm: 1000, n2Rpm, wfKgPerS: 0.1 });

function policy(fake: { meter: number }, over: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    budget: HELD_RETRY_BUDGET,
    walkIntervalS: WALK_INTERVAL_S,
    meter: () => fake.meter,
    ...over,
  };
}

interface Retry {
  readonly state?: RetryState;
  readonly tS?: number;
  readonly target: GasPathTarget;
  readonly anchor?: GasPathAnchor;
  readonly holding?: boolean;
}

function retry(solve: GasPathSolver, p: RetryPolicy, o: Retry) {
  const spend = { spent: 0 };
  const why = { cause: null as string | null };
  const state = o.state ?? NO_RETRY;
  const r = retryMatched({
    solve,
    e: REF,
    c: C,
    anchor: o.anchor ?? anchorAt(1000),
    target: o.target,
    tS: o.tS ?? 0,
    holding: o.holding ?? state !== NO_RETRY,
    policy: p,
    spend,
    state,
    why,
  });
  return { r, spend, why };
}

describe('D4-84: the held retry policy (retryMatched)', () => {
  it('the defaults: a budget well inside a frame, a walk at most every 0.5 s', () => {
    expect(HELD_RETRY_BUDGET).toBe(120);
    expect(WALK_INTERVAL_S).toBe(0.5);
    expect(DIRECT_SHARE).toBe(0.5);
    // one Newton iteration in flight (6 finite differences, 10 line-search evaluations) and the point
    expect(RETRY_OVERSHOOT).toBe(17);
  });

  it('a direct solve that converges is the matched path: used as it is, not charged', () => {
    const { fake, solve } = fakeNewton(() => 3);
    const { r, spend } = retry(solve, policy(fake), { target: targetAt(1001) });
    expect(r.kind).toBe('matched');
    expect(spend.spent).toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  it('while held, a direct solve that converges is charged (the held step stays in its budget)', () => {
    const { fake, solve } = fakeNewton(() => 3);
    const { r, spend } = retry(solve, policy(fake), { target: targetAt(1001), holding: true });
    expect(r.kind).toBe('matched');
    expect(spend.spent).toBe(fake.meter);
    expect(spend.spent).toBe(2 + 3 * PER_ITERATION);
  });

  it('a converging direct solve that needs up to the whole budget is never cut', () => {
    const fits = Math.floor((HELD_RETRY_BUDGET - 1) / PER_ITERATION);
    const { fake, solve } = fakeNewton(() => fits);
    expect(retry(solve, policy(fake), { target: targetAt(1001) }).r.kind).toBe('matched');
  });

  it('a failing direct solve is charged and cut at the budget; the walk sets out but waits', () => {
    const { fake, solve } = fakeNewton(() => Infinity);
    const { r, spend, why } = retry(solve, policy(fake), { tS: 2, target: targetAt(1100) });
    expect(r.kind).toBe('held');
    expect(spend.spent).toBe(fake.meter);
    expect(spend.spent).toBeGreaterThanOrEqual(HELD_RETRY_BUDGET);
    expect(spend.spent).toBeLessThanOrEqual(HELD_RETRY_BUDGET + RETRY_OVERSHOOT);
    expect(r.state.walkStartedS).toBe(2);
    expect(r.state.walk?.solves).toBe(0);
    expect(r.state.walk?.target).toEqual(targetAt(1100));
    expect(why.cause).toMatch(/held-retry budget/);
  });

  it('the next step: the direct gets DIRECT_SHARE of the budget, the walk resumes with the rest', () => {
    const { fake, solve } = fakeNewton(() => Infinity);
    const p = policy(fake);
    const first = retry(solve, p, { tS: 2, target: targetAt(1100) }).r;
    fake.calls.length = 0;
    const m0 = fake.meter;
    const second = retry(solve, p, { state: first.state, tS: 2.02, target: targetAt(1101) });
    expect(second.r.kind).toBe('held');
    // the direct at the new state, then the walk's first solve, half way to its own target
    expect(fake.calls.map((k) => k.n2Rpm)).toEqual([1101, 1050]);
    const directCost =
      2 + PER_ITERATION * Math.ceil((DIRECT_SHARE * HELD_RETRY_BUDGET - 1) / PER_ITERATION);
    expect(fake.meter - m0).toBe(second.spend.spent);
    expect(second.spend.spent).toBeGreaterThan(directCost);
    expect(second.spend.spent).toBeLessThanOrEqual(HELD_RETRY_BUDGET + RETRY_OVERSHOOT);
    // the walk's solve was stopped part way: kept to resume, not counted as failed
    expect(second.r.state.walk?.solves).toBe(0);
    expect(second.r.state.walk?.paused?.iterations).toBeGreaterThan(0);
  });

  it('a paused solve resumes where it stopped: the walk converges on its fixed target over steps', () => {
    // the half-way point needs 12 iterations (more than a step's budget), then the target 3
    const { fake, solve } = fakeNewton((n2, from) =>
      n2 === 1050 && from === 1000 ? 12 : n2 === 1100 && from === 1050 ? 3 : Infinity,
    );
    const p = policy(fake);
    let state = retry(solve, p, { tS: 2, target: targetAt(1100) }).r.state;
    let reached = null;
    for (let k = 1; k < 20 && reached === null; k++) {
      const { r, spend } = retry(solve, p, { state, tS: 2 + 0.02 * k, target: targetAt(1100 + k) });
      expect(spend.spent).toBeLessThanOrEqual(HELD_RETRY_BUDGET + RETRY_OVERSHOOT);
      expect(r.kind).toBe('held');
      if (r.kind === 'held') reached = r.reached;
      state = r.state;
    }
    expect(fake.calls.some((k) => k.resumed)).toBe(true);
    // the walk reached the state it set out for, not the moving one: the model moves its anchor there
    expect(reached?.anchor).toEqual({ ...targetAt(1100), x: [1100, 6, 0.5, 0.5, 0.5, 0.5] });
    expect(reached?.solution.x).toEqual(reached?.anchor.x);
    expect(state.walk).toBeNull();
  });

  it('a walk that reaches the current state is the matched solve', () => {
    const { fake, solve } = fakeNewton((n2, from) =>
      n2 === 1050 && from === 1000 ? 2 : n2 === 1100 && from === 1050 ? 2 : Infinity,
    );
    const r = retry(solve, policy(fake, { budget: 10_000 }), { target: targetAt(1100) }).r;
    expect(r.kind).toBe('matched');
    expect(r.state.walk).toBeNull();
  });

  it('a walk that is lost leaves no walk in flight', () => {
    const { fake, solve } = fakeNewton(() => Infinity, 1);
    const r = retry(solve, policy(fake), { target: targetAt(1100) }).r;
    expect(r.kind).toBe('held');
    expect(r.state.walk).toBeNull();
    expect(r.state.walkStartedS).toBe(0);
    // the direct, then the walk's steps from 1/2 down to 1/256
    expect(fake.calls).toHaveLength(9);
  });

  it('(a) the next walk waits WALK_INTERVAL_S after the last one set out; the direct is tried every step', () => {
    // every solve gives up at once, so each walk is lost inside its step
    const { fake, solve } = fakeNewton(() => Infinity, 1);
    const starts: number[] = [];
    let state = NO_RETRY;
    for (let k = 0; k <= 60; k++) {
      const tS = 0.02 * k;
      fake.calls.length = 0;
      const { r } = retry(solve, policy(fake), {
        state,
        tS,
        target: targetAt(1100 + k),
        holding: k > 0,
      });
      expect(r.kind).toBe('held');
      expect(fake.calls[0]?.n2Rpm).toBe(1100 + k);
      expect(fake.calls).toHaveLength(r.state.walkStartedS === tS ? 9 : 1);
      if (r.state.walkStartedS === tS) starts.push(tS);
      state = r.state;
    }
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) {
      const gap = (starts[i] ?? 0) - (starts[i - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(WALK_INTERVAL_S);
      expect(gap).toBeLessThan(WALK_INTERVAL_S + 0.02 + 1e-9);
    }
  });

  it('an unbounded policy is the D4-13 retry: the same solves and root as solveMatched', () => {
    const calls =
      (into: number[]): GasPathSolver =>
      (...args) => {
        into.push(args[3]);
        return solveGasPath(...args);
      };
    const a: number[] = [];
    const whole = solveMatched(
      calls(a),
      REF,
      C,
      idleAnchor(),
      START.n1Rpm,
      START.n2Rpm,
      START.wfKgPerS,
    );
    const b: number[] = [];
    const p: RetryPolicy = { budget: Infinity, walkIntervalS: 0, meter: gasPathEvaluations };
    const { r } = retry(calls(b), p, { target: START, anchor: idleAnchor() });
    expect(r.kind).toBe('matched');
    expect(b).toEqual(a);
    if (r.kind === 'matched') expect(r.solution.x).toEqual(whole?.x);
  });

  it("budgeted, the start's walk on a fixed state converges over steps on the unbudgeted root", () => {
    const whole = solveMatched(
      solveGasPath,
      REF,
      C,
      idleAnchor(),
      START.n1Rpm,
      START.n2Rpm,
      START.wfKgPerS,
    );
    const budget = 40;
    const p: RetryPolicy = { budget, walkIntervalS: WALK_INTERVAL_S, meter: gasPathEvaluations };
    let state = NO_RETRY;
    let matched: GasPathSolution | null = null;
    let steps = 0;
    for (; steps < 500 && matched === null; steps++) {
      const { r, spend } = retry(solveGasPath, p, {
        state,
        tS: 0.02 * steps,
        target: START,
        anchor: idleAnchor(),
        holding: steps > 0,
      });
      expect(spend.spent).toBeLessThanOrEqual(budget + RETRY_OVERSHOOT);
      if (r.kind === 'matched') matched = r.solution;
      state = r.state;
    }
    expect(steps).toBeGreaterThan(2);
    expect(matched?.x).toEqual(whole?.x);
  });
});

describe('W2H-I2: a resumed solve gets only the iterations it has left', () => {
  it("sliced every 3 iterations, each never-converging solve still ends after C7's 25 in all", () => {
    const { fake, solve } = fakeNewton(() => Infinity);
    const perSolve: number[] = [];
    let used = 0;
    const counting: GasPathSolver = (...a) => {
      const s = solve(...a);
      used += s.iterations;
      if (s.stopped !== true) {
        perSolve.push(used);
        used = 0;
      }
      return s;
    };
    let walk = startWalk(anchorAt(1000), targetAt(1100));
    let end: string | null = null;
    for (let k = 0; k < 500 && end === null; k++) {
      const m0 = fake.meter;
      const stop = () => fake.meter - m0 >= 3 * PER_ITERATION;
      const r = advanceWalk(counting, REF, C, walk, { cause: null }, stop);
      if (r.kind === 'paused') walk = r.walk;
      else end = r.kind;
    }
    // a resumed solve given more than it has left never runs out, so the walk would never end
    expect(end).toBe('lost');
    // the halving from 1/2 to 1/256: 8 solves, each refused after exactly C7's 25 iterations
    expect(perSolve).toEqual(Array<number>(8).fill(MAX_NEWTON_ITERATIONS));
  });
});
