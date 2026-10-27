import { describe, expect, it } from 'vitest';
import { RunRecorder, aggregateRuns, solverBudgetItPerSec } from '../../../spikes/lib/benchRun';

const P = { warmupMs: 1000, runMs: 2000, runs: 3 };

/** Drives the recorder with frames every `dt` ms from t0, `k` iterations each. */
function drive(rec: RunRecorder, t0: number, dt: number, k: number, until: number) {
  let t = t0;
  while (t <= until && rec.phase !== 'done') {
    rec.frame(t, k);
    t += dt;
  }
  return t;
}

describe('RunRecorder (D0-1 phases)', () => {
  it('goes warm-up -> run 1..3 -> done on the frame clock', () => {
    const rec = new RunRecorder(P, 0);
    expect(rec.phase).toBe('warmup');
    rec.frame(999, 1);
    expect(rec.phase).toBe('warmup');
    rec.frame(1000, 1);
    expect([rec.phase, rec.runIndex]).toEqual(['run', 0]);
    rec.frame(3000, 1);
    expect([rec.phase, rec.runIndex]).toEqual(['run', 1]);
    rec.frame(7000, 1);
    expect(rec.phase).toBe('done');
  });

  it('measures frame times, fps and iterations per second per run, ignoring warm-up', () => {
    const rec = new RunRecorder(P, 0);
    drive(rec, 0, 10, 2, 990); // warm-up at 100 fps, discarded
    drive(rec, 1000, 20, 3, 8000); // 50 fps, 3 it/frame from the start of run 1
    const runs = rec.results();
    expect(runs).toHaveLength(3);
    for (const r of runs) {
      expect(r.frameTime.p50).toBeCloseTo(20, 6);
      expect(r.fps).toBeCloseTo(50, 0);
      expect(r.itPerSec).toBeCloseTo(150, 0);
    }
  });

  it('attributes late GPU samples to the run their frame was in', () => {
    const rec = new RunRecorder(P, 0);
    drive(rec, 0, 10, 4, 7000);
    // Timestamp results arrive a few frames later, even after the protocol is done.
    rec.gpu({ frameT: 500, solverMs: 99, iterations: 4 }); // warm-up: ignored
    rec.gpu({ frameT: 1500, solverMs: 4, iterations: 4 }); // run 1: 1 ms/it
    rec.gpu({ frameT: 1600, solverMs: 8, iterations: 4 }); // run 1: 2 ms/it
    rec.gpu({ frameT: 3500, solverMs: 6, iterations: 4 }); // run 2
    const [r1, r2, r3] = rec.results();
    expect(r1?.solverMsPerIt).toBeCloseTo(12 / 8, 12); // total time / total iterations
    expect(r1?.solverMsPerFrame?.p50).toBe(6);
    expect(r2?.solverMsPerIt).toBeCloseTo(1.5, 12);
    expect(r3?.solverMsPerIt).toBeNull();
    expect(r3?.gpuSamples).toBe(0);
  });

  it('counts long frames against the display interval: deltas over 1.5 intervals', () => {
    const rec = new RunRecorder(P, 0, 20);
    drive(rec, 0, 20, 1, 990);
    // Run 1 (1000..3000): 20 ms frames, one 29 ms frame (below 30: not long), two 40 ms gaps.
    const times = [1000];
    for (const dt of [20, 20, 29, 20, 40, 20, 40, 20]) times.push((times.at(-1) ?? 0) + dt);
    for (const t of times) rec.frame(t, 1);
    drive(rec, 1229, 20, 1, 8000); // the rest of run 1, runs 2 and 3: steady
    const [r1, r2] = rec.results();
    expect(r1?.longFrames).toBe(2);
    expect(r2?.longFrames).toBe(0);
    expect(r1?.displayIntervalMs).toBe(20);
  });

  it('W0G-I1: a run entirely at 1 Hz has every frame long (the run-median rule saw none)', () => {
    const p = { warmupMs: 1000, runMs: 10_000, runs: 3 };
    const rec = new RunRecorder(p, 0, 1000 / 60);
    drive(rec, 0, 1000 / 60, 1, 990); // last warm-up frame at 59/60 s
    drive(rec, (59 * 1000) / 60 + 1000, 1000, 1, 40_000); // occluded: rAF at 1 Hz
    for (const r of rec.results()) {
      expect(r.longFrames).toBe(r.frameTime.n);
      expect(r.longestThrottledMs).toBeCloseTo(10_000, 6);
      expect(r.throttledMs).toBeCloseTo(10_000, 6);
    }
  });

  it("without a given display interval, takes the warm-up's median frame time", () => {
    const rec = new RunRecorder(P, 0);
    drive(rec, 0, 20, 1, 990); // warm-up at 50 Hz
    const times = [1000];
    for (const dt of [20, 40, 20, 20]) times.push((times.at(-1) ?? 0) + dt);
    for (const t of times) rec.frame(t, 1);
    drive(rec, 1120, 20, 1, 8000);
    const [r1] = rec.results();
    expect(r1?.displayIntervalMs).toBe(20);
    expect(r1?.longFrames).toBe(1);
  });

  it('W0G-N6: the warm-up fallback passes the probe check: a warm-up throttled from the start throws', () => {
    // a 1 Hz warm-up would otherwise make a 1 Hz run look healthy (its median is the interval)
    const rec = new RunRecorder({ warmupMs: 20_000, runMs: 2000, runs: 1 }, 0);
    drive(rec, 0, 1016, 1, 40_000);
    expect(() => rec.results()).toThrow(/display interval.*Hz/);
  });

  it('refuses to guess a display interval with neither a given one nor warm-up frames', () => {
    const rec = new RunRecorder(P, 1000);
    drive(rec, 1000, 1000, 1, 2000); // one warm-up frame, so no warm-up frame time
    drive(rec, 3000, 20, 1, 9000);
    expect(() => rec.results()).toThrow(/display interval/);
  });

  it('summarises how late each rAF callback started after its frame time (main-thread contention)', () => {
    // rAF timestamps are vsync-aligned frame times: a callback delayed by a busy thread can
    // still carry a regular timestamp, so frame deltas alone under-count late frames.
    const rec = new RunRecorder(P, 0);
    drive(rec, 0, 10, 1, 990);
    const delays = [1, 1, 1, 12, 1];
    delays.forEach((d, i) => rec.frame(1000 + 20 * i, 1, 1000 + 20 * i + d));
    drive(rec, 1100, 20, 1, 8000); // no callback times: no delay statistics
    const [r1, r2] = rec.results();
    expect(r1?.callbackDelay?.max).toBe(12);
    expect(r1?.callbackDelay?.p50).toBe(1);
    expect(r2?.callbackDelay).toBeNull();
    const agg = aggregateRuns(rec.results());
    expect(agg.callbackDelayP99).toBeCloseTo(r1?.callbackDelay?.p99 ?? Number.NaN, 12);
  });

  it('reports the measured window on the frame clock (for matching long tasks to runs)', () => {
    expect(new RunRecorder(P, 500).window).toEqual({ from: 1500, to: 7500 });
  });

  it('reports the 10th percentile of per-frame ms/it: the cost when nothing else had the GPU', () => {
    // On a shared integrated GPU another process's work lands inside our timestamp pair and
    // inflates some frames; the low percentile stays near the uncontended cost.
    const rec = new RunRecorder(P, 0);
    drive(rec, 0, 10, 4, 7000);
    const perIt = [1, 1, 1, 1, 1, 1, 1, 1, 5, 9]; // 10 frames in run 1, two contended
    perIt.forEach((ms, i) => {
      rec.gpu({ frameT: 1000 + 10 * i, solverMs: 4 * ms, iterations: 4 });
    });
    const [r1, r2] = rec.results();
    expect(r1?.solverMsPerItP10).toBeCloseTo(1, 12);
    expect(r1?.solverMsPerIt).toBeCloseTo(2.2, 12); // total / iterations, inflated
    expect(r2?.solverMsPerItP10).toBeNull();
  });

  it('refuses results before the protocol is done', () => {
    const rec = new RunRecorder(P, 0);
    rec.frame(10, 1);
    expect(() => rec.results()).toThrow(/not done/);
  });
});

describe('aggregateRuns', () => {
  it('reports the median over runs of each metric', () => {
    const rec = new RunRecorder(P, 0);
    drive(rec, 0, 10, 4, 7000);
    for (const [t, ms] of [
      [1500, 6],
      [3500, 4],
      [5500, 5],
    ] as const) {
      rec.gpu({ frameT: t, solverMs: ms, iterations: 4 });
    }
    const agg = aggregateRuns(rec.results());
    expect(agg.solverMsPerIt).toBeCloseTo(1.25, 12); // per run 1.5, 1.0, 1.25
    expect(agg.itPerSec).toBeCloseTo(400, 0);
    expect(agg.frameTimeP50).toBeCloseTo(10, 6);
    expect(agg.runs).toBe(3);
    expect(agg.longFrames).toBe(0);
    expect(agg.solverMsPerItP10).toBeCloseTo(1.25, 12); // one sample per run: 1.5, 1.0, 1.25
  });
});

describe('solverBudgetItPerSec', () => {
  it('is the iterations per second that fit 7 ms of solver GPU per 60 Hz frame', () => {
    expect(solverBudgetItPerSec(1.4)).toBeCloseTo(300, 9); // the plan's ~300 it/s
    expect(solverBudgetItPerSec(2.8)).toBeCloseTo(150, 9); // the P1 kill line
  });
});
