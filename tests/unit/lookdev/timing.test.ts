// W1L-I4: the look-dev timing harness to D0-1 / D2-12 / D3-6. The statistics, the seeded
// rotated order, the flags and the validity rule are pure and pinned here; the capture script
// (tools/lookdev/capture.ts) only drives Chrome.

import { describe, expect, it } from 'vitest';
import {
  PASS_GROUPS,
  RollingPassStats,
  summarizeRun,
  type PassMs,
} from '../../../src/gpu/passTimings';
import {
  combineReps,
  OFFICIAL_CONFIGS,
  parseTimingArgs,
  runOrder,
  runValidityOf,
} from '../../../tools/lookdev/timing';

const pass = (opaque: number, rotors = 0): PassMs => {
  const g = Object.fromEntries(PASS_GROUPS.map((k) => [k, 0])) as Record<string, number>;
  g.opaque = opaque;
  g.rotors = rotors;
  return g as PassMs;
};

describe('summarizeRun: every frame of one run (not a rolling window)', () => {
  it('gives p10, median and p90 per pass, of the per-frame totals and of the CPU time', () => {
    // opaque 1..100 ms, rotors 2 ms, CPU = frame index / 10
    const frames = Array.from({ length: 100 }, (_, i) => ({ gpu: pass(i + 1, 2), cpu: i / 10 }));
    const s = summarizeRun(frames);
    expect(s.frames).toBe(100);
    // linear interpolation between order statistics (R type 7)
    expect(s.gpu.opaque.p50).toBeCloseTo(50.5, 9);
    expect(s.gpu.opaque.p10).toBeCloseTo(10.9, 9);
    expect(s.gpu.opaque.p90).toBeCloseTo(90.1, 9);
    expect(s.gpu.rotors.p50).toBe(2);
    expect(s.gpuTotal.p50).toBeCloseTo(52.5, 9);
    expect(s.cpu.p50).toBeCloseTo(4.95, 9);
  });

  it('an empty run is NaN, never 0', () => {
    const s = summarizeRun([]);
    expect(s.frames).toBe(0);
    expect(Number.isNaN(s.gpuTotal.p50)).toBe(true);
  });

  it('RollingPassStats records every frame of a run, beyond its rolling window', () => {
    const st = new RollingPassStats(4);
    st.push(pass(99), 1); // before the run: not part of it
    st.beginRun();
    for (let i = 0; i < 10; i++) st.push(pass(i), 0.5);
    const run = st.endRun();
    expect(run.length).toBe(10);
    expect(run[0]?.gpu.opaque).toBe(0);
    expect(st.medians().frames).toBe(4); // the overlay's window is unchanged
    st.push(pass(1), 1);
    expect(st.endRun()).toEqual([]); // nothing recorded outside a run
  });
});

describe('combineReps: the median of the runs (D0-1)', () => {
  it('takes, per pass, the median over runs of each run p50, p10 and p90', () => {
    const run = (k: number) => summarizeRun([{ gpu: pass(k, 1), cpu: k }]);
    const c = combineReps([run(3), run(1), run(10)]);
    expect(c.runs).toBe(3);
    expect(c.gpu.opaque.p50).toBe(3);
    expect(c.gpuTotal.p50).toBe(4);
    expect(c.cpu.p50).toBe(3);
    // the spread between runs is kept for the record
    expect(c.gpuTotalPerRun).toEqual([4, 2, 11]);
  });
});

describe('parseTimingArgs', () => {
  it('reads the D0-1 flags of the quiet re-measure command', () => {
    const a = parseTimingArgs([
      '--only',
      'none',
      '--warmup-s',
      '10',
      '--run-s',
      '60',
      '--reps',
      '3',
      '--seed',
      '1',
    ]);
    expect(a).toMatchObject({ warmupS: 10, runS: 60, reps: 3, seed: 1, diagnostics: false });
  });

  it('defaults to the official protocol and rejects nonsense', () => {
    expect(parseTimingArgs([])).toMatchObject({ warmupS: 10, runS: 60, reps: 3, seed: 1 });
    expect(() => parseTimingArgs(['--reps', '0'])).toThrow(/reps/);
    expect(() => parseTimingArgs(['--run-s', 'x'])).toThrow(/run-s/);
    expect(() => parseTimingArgs(['--warmup-s', '-1'])).toThrow(/warmup-s/);
    expect(parseTimingArgs(['--diagnostics']).diagnostics).toBe(true);
  });
});

describe('runOrder: seeded and rotated per repetition (D2-12)', () => {
  it('runs every config once per repetition, in a different position each time, reproducibly', () => {
    const ids = OFFICIAL_CONFIGS.map((c) => c.id);
    const o = runOrder(OFFICIAL_CONFIGS, 3, 1);
    expect(o).toEqual(runOrder(OFFICIAL_CONFIGS, 3, 1));
    expect(o.length).toBe(3);
    for (const rep of o) expect([...rep].sort()).toEqual([...ids].sort());
    // each config takes each position once over the three repetitions
    for (const id of ids) expect(new Set(o.map((rep) => rep.indexOf(id))).size).toBe(3);
  });

  it('the official set is small: the default, the cutaway and the hero', () => {
    expect(OFFICIAL_CONFIGS.map((c) => c.preset).sort()).toEqual(
      ['cutaway', 'hero', 'threeQuarterFront'].sort(),
    );
  });
});

describe('runValidityOf: D2-11 as amended by D3-6', () => {
  const steady = Array.from({ length: 600 }, () => 16.7);

  it('a steady run is valid', () => {
    expect(runValidityOf(steady, 16.7, 0).valid).toBe(true);
  });

  it('the occlusion signature (sustained >= 2.5 display intervals for > 500 ms) is INVALID', () => {
    const occluded = [...steady, ...Array.from({ length: 6 }, () => 1000)];
    const v = runValidityOf(occluded, 16.7, 0);
    expect(v.valid).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/occluded/);
  });

  it('a page hidden during the run is INVALID; a slow load is only a warning', () => {
    expect(runValidityOf(steady, 16.7, 120).valid).toBe(false);
    const slow = runValidityOf(
      Array.from({ length: 300 }, () => 33.4),
      16.7,
      0,
    );
    expect(slow.valid).toBe(true);
    expect(slow.warnings.length).toBeGreaterThan(0);
  });
});
