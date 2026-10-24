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
    drive(rec, 0, 10, 2, 1000); // warm-up at 100 fps, discarded
    drive(rec, 1000 + 1e-9, 20, 3, 8000); // 50 fps, 3 it/frame from the start of run 1
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
  });
});

describe('solverBudgetItPerSec', () => {
  it('is the iterations per second that fit 7 ms of solver GPU per 60 Hz frame', () => {
    expect(solverBudgetItPerSec(1.4)).toBeCloseTo(300, 9); // the plan's ~300 it/s
    expect(solverBudgetItPerSec(2.8)).toBeCloseTo(150, 9); // the P1 kill line
  });
});
