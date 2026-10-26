import { describe, expect, it } from 'vitest';
import { IterationScheduler } from '../../../spikes/lib/scheduler';

describe('IterationScheduler (iterations per frame from timestamp queries)', () => {
  it('starts at the initial guess before any measurement', () => {
    const s = new IterationScheduler({ budgetMs: 7, min: 1, max: 16, initial: 2 });
    expect(s.iterations).toBe(2);
  });

  it('fits as many iterations as the measured cost allows inside the budget', () => {
    const s = new IterationScheduler({ budgetMs: 7, min: 1, max: 16, initial: 2 });
    s.observe(2, 3.0); // 1.5 ms per iteration
    expect(s.iterations).toBe(4); // floor(7 / 1.5)
  });

  it('smooths the per-iteration cost so one slow frame does not halve the next', () => {
    const s = new IterationScheduler({ budgetMs: 7, min: 1, max: 16, initial: 4, smoothing: 0.25 });
    s.observe(4, 4.0); // 1.0 ms/it -> first sample seeds the average
    s.observe(4, 12.0); // 3.0 ms/it -> 0.75 * 1.0 + 0.25 * 3.0 = 1.5 ms/it
    expect(s.msPerIteration).toBeCloseTo(1.5, 12);
    expect(s.iterations).toBe(4);
  });

  it('clamps to [min, max]', () => {
    const fast = new IterationScheduler({ budgetMs: 7, min: 1, max: 6, initial: 1 });
    fast.observe(1, 0.1);
    expect(fast.iterations).toBe(6);
    const slow = new IterationScheduler({ budgetMs: 7, min: 1, max: 6, initial: 1 });
    slow.observe(1, 20);
    expect(slow.iterations).toBe(1);
  });

  it('ignores samples it cannot use (no iterations, or non-positive/non-finite time)', () => {
    const s = new IterationScheduler({ budgetMs: 7, min: 1, max: 16, initial: 3 });
    s.observe(0, 5);
    s.observe(3, 0);
    s.observe(3, Number.NaN);
    expect(s.msPerIteration).toBeNull();
    expect(s.iterations).toBe(3);
  });
});
