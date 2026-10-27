import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICIAL, QUICK } from '../../../spikes/lib/protocol';
import {
  STALL_GRACE_MS,
  runTimeoutMs,
  stalledValidity,
  withTimeout,
} from '../../../spikes/lib/timeout';

// W0G-N6: a run whose rAF stops entirely must not hang the harness in page.evaluate.

describe('runTimeoutMs: warm-up + runs + 30 s', () => {
  it('one official run gets 100 s, one quick run 33 s', () => {
    expect(STALL_GRACE_MS).toBe(30_000);
    expect(runTimeoutMs({ ...OFFICIAL, runs: 1 })).toBe(100_000);
    expect(runTimeoutMs({ ...QUICK, runs: 1 })).toBe(33_000);
    expect(runTimeoutMs(OFFICIAL)).toBe(10_000 + 3 * 60_000 + 30_000);
  });
});

describe('withTimeout (fake timers: deterministic)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the value through when the work settles in time, and clears its timer', async () => {
    const work = new Promise<number>((resolve) => {
      setTimeout(() => {
        resolve(7);
      }, 1000);
    });
    const timed = withTimeout(work, 5000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(timed).resolves.toEqual({ ok: true, value: 7 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a stall when the timer fires first; the late rejection is swallowed', async () => {
    let reject: (e: Error) => void = () => {
      // replaced by the promise's reject below
    };
    const work = new Promise<number>((_, r) => {
      reject = r;
    });
    const timed = withTimeout(work, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(timed).resolves.toEqual({ ok: false, afterMs: 5000 });
    // e.g. the page navigates away and Playwright rejects the pending evaluate
    reject(new Error('Execution context was destroyed'));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('propagates an error the work throws before the timeout', async () => {
    const timed = withTimeout(Promise.reject(new Error('boom')), 5000);
    await expect(timed).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('stalledValidity', () => {
  it('is INVALID with the stall named, never a number', () => {
    const v = stalledValidity(100_000);
    expect(v.valid).toBe(false);
    expect(v.reasons.join()).toMatch(/stalled: no result within 100 s/);
    expect(v.warnings).toEqual([]);
  });
});
