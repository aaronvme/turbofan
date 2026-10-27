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
  abOrder,
  abSummary,
  BACK_TO_BACK_MIN_BUSY,
  backToBackLoad,
  combineReps,
  OFFICIAL_CONFIGS,
  p4Verdict,
  pacedValidity,
  parseTimingArgs,
  runOrder,
  runValidityOf,
  withPacings,
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

  it('the official set is small: the default, the cutaway, the hero, and the default in the performance profile (D3-7)', () => {
    expect(OFFICIAL_CONFIGS.map((c) => `${c.preset}:${c.profile ?? 'quality'}`).sort()).toEqual(
      [
        'cutaway:quality',
        'hero:quality',
        'threeQuarterFront:quality',
        'threeQuarterFront:performance',
      ].sort(),
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

// D4-24 (w2/lookdev-4): P4's measure of record becomes back to back (frames rendered
// continuously, the GPU at its loaded clock) once the critic confirms the DVFS evidence;
// until then it is reported both ways and must pass both. The pure parts of that mode and of
// the A/B of two commits are pinned here (the drivers: tools/lookdev/capture.ts and ab.ts).
describe('pacing: vsync and back to back (D4-24)', () => {
  it('--pacing takes vsync, back-to-back or both; the default is both (P4 must pass both ways)', () => {
    expect(parseTimingArgs([]).pacings).toEqual(['vsync', 'backToBack']);
    expect(parseTimingArgs(['--pacing', 'both']).pacings).toEqual(['vsync', 'backToBack']);
    expect(parseTimingArgs(['--pacing', 'vsync']).pacings).toEqual(['vsync']);
    expect(parseTimingArgs(['--pacing', 'back-to-back']).pacings).toEqual(['backToBack']);
    expect(() => parseTimingArgs(['--pacing', 'saturated'])).toThrow(/pacing/);
  });

  it('expands each config once per pacing; the vsync ids stay as recorded before', () => {
    const x = withPacings(OFFICIAL_CONFIGS, ['vsync', 'backToBack']);
    expect(x.length).toBe(2 * OFFICIAL_CONFIGS.length);
    expect(x.filter((c) => c.pacing === 'vsync').map((c) => c.id)).toEqual(
      OFFICIAL_CONFIGS.map((c) => c.id),
    );
    expect(x.filter((c) => c.pacing === 'backToBack').map((c) => c.id)).toEqual(
      OFFICIAL_CONFIGS.map((c) => `${c.id} [back to back]`),
    );
    expect(new Set(x.map((c) => c.id)).size).toBe(x.length);
  });

  it('backToBackLoad: frames per second and the GPU busy fraction, robust to dropped samples', () => {
    // 100 intervals of 10 ms (1 s); the GPU ran 8 ms a frame, but only 50 frames' queries came back
    const frames = Array.from({ length: 50 }, () => ({ gpu: pass(6, 2), cpu: 1 }));
    const load = backToBackLoad(
      frames,
      Array.from({ length: 100 }, () => 10),
    );
    expect(load.framesPerS).toBeCloseTo(100, 9);
    expect(load.gpuBusy).toBeCloseTo(0.8, 9);
    expect(Number.isNaN(backToBackLoad([], []).gpuBusy)).toBe(true);
  });

  it('a back-to-back run: INVALID when hidden or stalled; a GPU that idled is a warning', () => {
    const busy = Array.from({ length: 600 }, () => ({ gpu: pass(8), cpu: 1 }));
    const steady = Array.from({ length: 600 }, () => 9);
    const ok = pacedValidity('backToBack', steady, 16.7, 0, busy);
    expect(ok.valid).toBe(true);
    // no "below display rate" or other warning: back to back outruns the display by design
    expect(ok.warnings).toEqual([]);
    expect(pacedValidity('backToBack', steady, 16.7, 50, busy).valid).toBe(false);
    const stalled = [...steady, ...Array.from({ length: 6 }, () => 1000)];
    expect(pacedValidity('backToBack', stalled, 16.7, 0, busy).valid).toBe(false);
    // the GPU busy under BACK_TO_BACK_MIN_BUSY of the wall time: its clock could still fall
    const idle = Array.from({ length: 600 }, () => ({ gpu: pass(4), cpu: 1 }));
    const w = pacedValidity('backToBack', steady, 16.7, 0, idle);
    expect(w.valid).toBe(true);
    expect(w.warnings.join(' ')).toMatch(/busy/);
    expect(BACK_TO_BACK_MIN_BUSY).toBeGreaterThan(0.5);
    expect(BACK_TO_BACK_MIN_BUSY).toBeLessThan(1);
  });

  it('a vsync run is judged as before (D2-11 / D3-6)', () => {
    const steady = Array.from({ length: 600 }, () => 16.7);
    const frames = Array.from({ length: 600 }, () => ({ gpu: pass(8), cpu: 1 }));
    expect(pacedValidity('vsync', steady, 16.7, 0, frames)).toEqual(
      runValidityOf(steady, 16.7, 0),
    );
  });

  it('p4Verdict: PASS only if every measured pacing passes; official only under D0-1', () => {
    const p = p4Verdict({ vsync: 9.1, backToBack: 7.5 }, 8, true);
    expect(p.perPacing).toEqual({ vsync: 'FAIL', backToBack: 'PASS' });
    expect(p.verdict).toBe('FAIL');
    expect(p4Verdict({ vsync: 7.9, backToBack: 8 }, 8, true).verdict).toBe('PASS');
    expect(p4Verdict({ backToBack: 7 }, 8, true).verdict).toBe('PASS');
    expect(p4Verdict({ vsync: 7.9, backToBack: 7 }, 8, false).verdict).toBe(
      'PASS (indicative: not the D0-1 protocol)',
    );
    expect(p4Verdict({}, 8, true).verdict).toBe('NONE');
  });
});

describe('the A/B of two commits (D4-24 result: bad7ad0 against 23239a1)', () => {
  it('abOrder: adjacent pairs, each side first equally often, every pacing every repetition', () => {
    const o = abOrder(['bad7ad0', '23239a1'], ['vsync', 'backToBack'], 4);
    expect(o.length).toBe(16);
    for (let k = 0; k < o.length; k += 2) {
      const a = o[k];
      const b = o[k + 1];
      expect(a?.rep).toBe(b?.rep);
      expect(a?.pacing).toBe(b?.pacing);
      expect(new Set([a?.ref, b?.ref])).toEqual(new Set(['bad7ad0', '23239a1']));
    }
    for (const pacing of ['vsync', 'backToBack'] as const) {
      const firsts = o.filter((r, k) => k % 2 === 0 && r.pacing === pacing).map((r) => r.ref);
      expect(firsts.filter((r) => r === 'bad7ad0').length).toBe(2);
    }
    // the pacing that leads alternates too
    expect(o[0]?.pacing).not.toBe(o[4]?.pacing);
  });

  it('abSummary: the median of each side and the median of the paired differences a - b per pass', () => {
    const run = (opaque: number, rotors: number) =>
      summarizeRun([{ gpu: pass(opaque, rotors), cpu: 1 }]);
    const s = abSummary(
      ['a', 'b'],
      [
        { ref: 'a', pacing: 'vsync', rep: 0, summary: run(6.3, 1.9) },
        { ref: 'b', pacing: 'vsync', rep: 0, summary: run(5.6, 1.4) },
        { ref: 'b', pacing: 'vsync', rep: 1, summary: run(8.0, 1.0) },
        { ref: 'a', pacing: 'vsync', rep: 1, summary: run(8.2, 1.2) },
        { ref: 'a', pacing: 'vsync', rep: 2, summary: run(7.0, 1.5) },
        { ref: 'b', pacing: 'vsync', rep: 2, summary: run(7.1, 1.5) },
      ],
    );
    const v = s.vsync;
    expect(v?.pairs).toBe(3);
    expect(v?.side.a?.gpu.opaque.p50).toBeCloseTo(7.0, 9);
    expect(v?.side.b?.gpu.opaque.p50).toBeCloseTo(7.1, 9);
    // per pair: +0.7, +0.2, -0.1 -> median +0.2
    expect(v?.diff.opaque.median).toBeCloseTo(0.2, 9);
    expect(v?.diff.opaque.values.map((x) => Number(x.toFixed(9)))).toEqual([0.7, 0.2, -0.1]);
    expect(v?.diff.rotors.median).toBeCloseTo(0.2, 9);
    expect(v?.diff.gpuTotal.median).toBeCloseTo(0.4, 9);
    expect(s.backToBack).toBeUndefined();
  });

  it('abSummary refuses an unpaired run', () => {
    const r = summarizeRun([{ gpu: pass(1), cpu: 1 }]);
    expect(() =>
      abSummary(['a', 'b'], [{ ref: 'a', pacing: 'vsync', rep: 0, summary: r }]),
    ).toThrow(/pair/);
  });
});
