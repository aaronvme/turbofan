import { describe, expect, it } from 'vitest';
import { RunRecorder } from '../../../spikes/lib/benchRun';
import {
  LONG_FRAME_FACTOR,
  MAX_MEDIAN_FACTOR,
  MAX_THROTTLED_STRETCH_MS,
  THROTTLE_FACTOR,
  combineValidity,
  displayIntervalMs,
  frameHealth,
  runValidity,
} from '../../../spikes/lib/validity';

const P60 = 1000 / 60;

/** Frame deltas of `seconds` at a steady interval. */
function steady(intervalMs: number, seconds: number): number[] {
  return Array.from({ length: Math.round((1000 * seconds) / intervalMs) }, () => intervalMs);
}

describe('frameHealth (against the display interval, not the run median)', () => {
  it('a 60 Hz run with isolated missed vsyncs: long frames counted, nothing throttled', () => {
    // The official main-react60 shape: one missed vsync (2 intervals) or a few (3-4) at a time.
    const deltas = [...steady(P60, 10), 2 * P60, P60, 3 * P60, P60, 4 * P60, ...steady(P60, 1)];
    const h = frameHealth(deltas, P60);
    expect(h.longFrames).toBe(3);
    // 3 and 4 intervals exceed 2.5 but are separate stretches, each far below the limit.
    expect(h.throttledMs).toBeCloseTo(7 * P60, 9);
    expect(h.longestThrottledMs).toBeCloseTo(4 * P60, 9);
  });

  it('a run entirely at 1 Hz (occluded window under Playwright): every frame long and throttled', () => {
    // The old median rule saw 0 long frames here: the median of a 1 Hz run is 1016 ms.
    const deltas = steady(1016, 60);
    const h = frameHealth(deltas, P60);
    expect(h.longFrames).toBe(deltas.length);
    expect(h.throttledMs).toBeCloseTo(1016 * deltas.length, 6);
    expect(h.longestThrottledMs).toBeCloseTo(1016 * deltas.length, 6);
  });

  it('the longest stretch is the longest run of consecutive throttled intervals', () => {
    const deltas = [P60, 100, 100, P60, 100, 100, 100, P60];
    const h = frameHealth(deltas, P60);
    expect(h.throttledMs).toBe(500);
    expect(h.longestThrottledMs).toBe(300);
  });

  it('uses 1.5 and 2.5 display intervals, strictly', () => {
    expect([LONG_FRAME_FACTOR, THROTTLE_FACTOR]).toEqual([1.5, 2.5]);
    const h = frameHealth([15, 15.0001, 25, 25.0001], 10);
    expect(h.longFrames).toBe(3);
    expect(h.throttledMs).toBeCloseTo(25.0001, 9);
  });

  it('rejects a non-positive display interval', () => {
    expect(() => frameHealth([16], 0)).toThrow(/display interval/);
  });
});

describe('displayIntervalMs (idle rAF probe before the sweep)', () => {
  it('is the median probe delta', () => {
    expect(displayIntervalMs([16.6, 16.7, 16.8, 33.3, 16.7, 16.6, 16.7, 16.8, 16.7, 16.7])).toBe(
      16.7,
    );
  });

  it('refuses a probe that ran throttled (the window is not in the foreground)', () => {
    expect(() => displayIntervalMs(steady(1016, 12))).toThrow(/foreground/);
  });

  it('refuses a probe with too few frames to trust', () => {
    expect(() => displayIntervalMs([16.7, 16.7])).toThrow(/frames/);
  });
});

describe('runValidity (D0-1 gate, W0G-I1)', () => {
  const ok = {
    frameTime: { p50: 16.7 },
    longestThrottledMs: 0,
    displayIntervalMs: P60,
  };

  it('a normal 60 Hz run is valid', () => {
    expect(runValidity(ok, 0)).toEqual({ valid: true, reasons: [] });
  });

  it('a run with a throttled stretch longer than the limit is invalid', () => {
    expect(MAX_THROTTLED_STRETCH_MS).toBe(500);
    const v = runValidity({ ...ok, longestThrottledMs: 1016 }, 0);
    expect(v.valid).toBe(false);
    expect(v.reasons.join()).toMatch(/1016 ms in a row/);
    expect(runValidity({ ...ok, longestThrottledMs: 500 }, 0).valid).toBe(true);
  });

  it('a run whose median frame misses vsync (a 30 Hz throttle) is invalid', () => {
    expect(MAX_MEDIAN_FACTOR).toBe(1.5);
    const v = runValidity({ ...ok, frameTime: { p50: 33.3 } }, 0);
    expect(v.valid).toBe(false);
    expect(v.reasons.join()).toMatch(/median frame 33\.3 ms/);
  });

  it('a hidden page is invalid', () => {
    const v = runValidity(ok, 120);
    expect(v.valid).toBe(false);
    expect(v.reasons.join()).toMatch(/hidden 120 ms/);
  });

  it('end to end: the official 80k-16x8 shape (60 Hz, then 1 Hz from ~42 s) is invalid', () => {
    const protocol = { warmupMs: 10_000, runMs: 60_000, runs: 3 };
    const rec = new RunRecorder(protocol, 0, P60);
    let t = 0;
    while (t < 52_000) {
      rec.frame(t, 5);
      t += P60;
    }
    while (rec.frame(t, 5) !== 'done') t += 1016;
    const runs = rec.results();
    const verdicts = runs.map((r) => runValidity(r, 0));
    expect(verdicts.map((v) => v.valid)).toEqual([false, false, false]);
    expect(runs[0]?.frameTime.p50).toBeCloseTo(P60, 6); // run 0 still looks fine by its median
    expect(combineValidity(verdicts).valid).toBe(false);
  });

  it('end to end: the official main-react60 shape (scattered 2-4 interval frames) stays valid', () => {
    const protocol = { warmupMs: 1_000, runMs: 10_000, runs: 3 };
    const rec = new RunRecorder(protocol, 0, P60);
    let t = 0;
    let i = 0;
    for (;;) {
      if (rec.frame(t, 3) === 'done') break;
      // Every 20th frame misses one vsync, every 97th misses three.
      t += i % 97 === 0 ? 4 * P60 : i % 20 === 0 ? 2 * P60 : P60;
      i++;
    }
    const runs = rec.results();
    expect(runs.every((r) => r.longFrames > 0)).toBe(true);
    expect(combineValidity(runs.map((r) => runValidity(r, 0)))).toEqual({
      valid: true,
      reasons: [],
    });
  });
});

describe('combineValidity', () => {
  it('is valid only if every part is, and keeps every reason', () => {
    expect(combineValidity([])).toEqual({ valid: true, reasons: [] });
    expect(
      combineValidity([
        { valid: true, reasons: [] },
        { valid: false, reasons: ['a'] },
        { valid: false, reasons: ['b'] },
      ]),
    ).toEqual({ valid: false, reasons: ['a', 'b'] });
  });
});
