import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../../src/contracts/thresholds';
import {
  IterationScheduler,
  SOLVER_BUDGET,
  solverBudgetMs,
} from '../../../../src/flow/gpu/scheduler';

// D4-2 (b): the solver gets min(5 ms, 15 ms - measured render - measured flow visuals) of GPU per
// frame, with a floor of 2 iterations per frame; L13's 7 ms stays the hard ceiling.
describe('solverBudgetMs (D4-2)', () => {
  it('uses the D4-2 numbers and L13 ceiling', () => {
    expect(SOLVER_BUDGET.capMs).toBe(5);
    expect(SOLVER_BUDGET.frameMs).toBe(15);
    expect(SOLVER_BUDGET.floorIterations).toBe(2);
    expect(SOLVER_BUDGET.hardCeilingMs).toBe(THRESHOLDS.L13.values.maxSolverFrameMs.value);
  });

  it('is the 5 ms cap while the render is cheap or not yet measured', () => {
    expect(solverBudgetMs({ renderMs: null, flowVisualsMs: null })).toBe(5);
    expect(solverBudgetMs({ renderMs: 8, flowVisualsMs: 2 })).toBe(5);
    expect(solverBudgetMs({ renderMs: 4, flowVisualsMs: null })).toBe(5);
  });

  it('gives the solver what the frame has left after render and flow visuals', () => {
    expect(solverBudgetMs({ renderMs: 10, flowVisualsMs: 2 })).toBeCloseTo(3, 12);
    expect(solverBudgetMs({ renderMs: 11.5, flowVisualsMs: null })).toBeCloseTo(3.5, 12);
    expect(solverBudgetMs({ renderMs: 14, flowVisualsMs: 2 })).toBe(0);
  });

  it('treats a non-finite or negative measurement as not measured', () => {
    expect(solverBudgetMs({ renderMs: Number.NaN, flowVisualsMs: 2 })).toBe(5);
    expect(solverBudgetMs({ renderMs: 12, flowVisualsMs: Number.POSITIVE_INFINITY })).toBe(3);
    expect(solverBudgetMs({ renderMs: -3, flowVisualsMs: null })).toBe(5);
  });
});

describe('IterationScheduler', () => {
  const budget = (gpuTimeBudgetMs: number, maxIterations = 1000) => ({
    gpuTimeBudgetMs,
    maxIterations,
  });

  it('runs the floor of 2 iterations until a GPU time is measured', () => {
    const s = new IterationScheduler();
    expect(s.msPerIteration).toBeNull();
    expect(s.iterationsFor(budget(5))).toBe(2);
  });

  it('fits the budget from the measured cost per iteration (D4-2: 1.28 ms -> 3 per frame)', () => {
    const s = new IterationScheduler();
    s.observe(2, 2.56);
    expect(s.msPerIteration).toBeCloseTo(1.28, 12);
    expect(s.iterationsFor(budget(5))).toBe(3);
    expect(s.iterationsFor(budget(7))).toBe(5);
  });

  it('keeps the 2-iteration floor when the budget is smaller', () => {
    const s = new IterationScheduler();
    s.observe(3, 3.84);
    expect(s.iterationsFor(budget(0))).toBe(2);
    expect(s.iterationsFor(budget(1))).toBe(2);
  });

  it('never plans more than the 7 ms hard ceiling, even against the floor (but at least 1)', () => {
    const s = new IterationScheduler();
    s.observe(2, 8); // 4 ms per iteration: two would take 8 ms
    expect(s.iterationsFor(budget(5))).toBe(1);
    expect(s.iterationsFor(budget(50))).toBe(1);
    const slow = new IterationScheduler();
    slow.observe(1, 9); // one iteration alone is over the ceiling: still 1, the solver must run
    expect(slow.iterationsFor(budget(5))).toBe(1);
    const fast = new IterationScheduler();
    fast.observe(10, 5); // 0.5 ms: a 20 ms budget is held to 7 ms = 14 iterations
    expect(fast.iterationsFor(budget(20))).toBe(14);
  });

  it('honours the caller maxIterations, including 0 (paused)', () => {
    const s = new IterationScheduler();
    s.observe(10, 5);
    expect(s.iterationsFor(budget(5, 4))).toBe(4);
    expect(s.iterationsFor(budget(5, 1))).toBe(1);
    expect(s.iterationsFor(budget(5, 0))).toBe(0);
  });

  it('averages the cost (EMA) and ignores samples that are not a measurement', () => {
    const s = new IterationScheduler({ smoothing: 0.5 });
    s.observe(2, 2);
    s.observe(2, 4);
    expect(s.msPerIteration).toBeCloseTo(1.5, 12);
    for (const bad of [Number.NaN, Infinity, 0, -1]) s.observe(2, bad);
    s.observe(0, 3);
    expect(s.msPerIteration).toBeCloseTo(1.5, 12);
    expect(() => new IterationScheduler({ smoothing: 0 })).toThrow(/smoothing/);
    expect(() => new IterationScheduler({ smoothing: 1.5 })).toThrow(/smoothing/);
  });

  it('treats a non-finite budget as the cap', () => {
    const s = new IterationScheduler();
    s.observe(2, 2);
    expect(s.iterationsFor(budget(Number.NaN))).toBe(5);
  });
});
