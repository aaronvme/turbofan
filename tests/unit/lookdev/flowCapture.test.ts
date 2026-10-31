// The look-dev capture's flow-on option (the kernel round, item 6): `--flow` captures P4's timing
// with the flow visuals on, on the live solver's field labelled uncoupled (D4-82): Realistic at its
// D4-83 default (the haze, no tracers) at the default view, and Cutaway with its tracers at the
// cutaway view. The D0-1 protocol (warm-up, runs, repetitions, seed, pacings, D3-6) is unchanged;
// the option changes only the configs, the page's query and one more validity check (the field).
// P4's measure of record stays the flow-off capture (D4-42); these rows are reported beside it.
import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_CONFIGS,
  FLOW_CONFIGS,
  OFFICIAL_CONFIGS,
  flowFieldValidity,
  flowRunSummary,
  lookdevQuery,
  parseTimingArgs,
  timingConfigs,
  withPacings,
} from '../../../tools/lookdev/timing';

describe('--flow: P4 timing with the flow visuals on (D4-82, D4-83)', () => {
  it('parses --flow beside the D0-1 flags, which keep their meaning', () => {
    const off = parseTimingArgs([]);
    expect(off.flow).toBe(false);
    const on = parseTimingArgs(['--flow', '--warmup-s', '10', '--run-s', '60', '--reps', '3']);
    expect(on).toMatchObject({ flow: true, warmupS: 10, runS: 60, reps: 3, seed: 1 });
    expect(on.pacings).toEqual(off.pacings);
    expect(parseTimingArgs(['--flow', '--pacing', 'back-to-back']).pacings).toEqual(['backToBack']);
    // the A/B diagnostics are flow-off configs: one or the other
    expect(() => parseTimingArgs(['--flow', '--diagnostics'])).toThrow(/--flow.*--diagnostics/);
  });

  it('picks the flow configs: Realistic at its D4-83 default, Cutaway with tracers', () => {
    expect(timingConfigs(parseTimingArgs([]))).toBe(OFFICIAL_CONFIGS);
    expect(timingConfigs(parseTimingArgs(['--diagnostics']))).toBe(DIAGNOSTIC_CONFIGS);
    const flow = timingConfigs(parseTimingArgs(['--flow']));
    expect(flow).toBe(FLOW_CONFIGS);
    expect(flow.map((c) => [c.preset, c.flow])).toEqual([
      // null: the mode's own default, which for Realistic is no tracers (D4-83)
      ['threeQuarterFront', { mode: 'realistic', tracers: null }],
      ['cutaway', { mode: 'cutaway', tracers: true }],
    ]);
    // every config is distinct from the flow-off ids (P4's lookup of record never matches them)
    for (const c of flow) expect(OFFICIAL_CONFIGS.map((o) => o.id)).not.toContain(c.id);
    // and they pace like any other config
    expect(withPacings(flow, ['vsync', 'backToBack']).map((c) => c.id)).toEqual([
      ...flow.map((c) => c.id),
      ...flow.map((c) => `${c.id} [back to back]`),
    ]);
  });

  it("loads the look-dev page with the solver on the view's device only with --flow", () => {
    expect(lookdevQuery(parseTimingArgs([]))).toBe('clean=1');
    expect(lookdevQuery(parseTimingArgs(['--flow']))).toBe('clean=1&field=solver');
  });

  it('a flow run is INVALID unless the solver field, labelled uncoupled, was drawn throughout', () => {
    const solver = { asked: 'solver', coupling: 'uncoupled', fallback: null } as const;
    expect(flowFieldValidity(solver, solver)).toEqual({ valid: true, reasons: [], warnings: [] });
    const fellBack = {
      asked: 'solver',
      coupling: 'mock',
      fallback: 'solver diverged: residual NaN',
    } as const;
    const v = flowFieldValidity(solver, fellBack);
    expect(v.valid).toBe(false);
    expect(v.reasons.join()).toMatch(/end.*MOCK.*diverged/);
    expect(flowFieldValidity(fellBack, solver).reasons.join()).toMatch(/start/);
    const mock = { asked: 'mock', coupling: 'mock', fallback: null } as const;
    expect(flowFieldValidity(mock, mock).reasons.join()).toMatch(/MOCK/);
    const coupled = { asked: 'solver', coupling: 'coupled', fallback: null } as const;
    expect(flowFieldValidity(coupled, coupled).reasons.join()).toMatch(/uncoupled/);
  });

  it("summarizes a flow run: the flow passes, the solver's GPU ms and iterations per frame", () => {
    const gpu = {
      shadow: 0,
      opaque: 4,
      rotors: 1,
      gtao: 0,
      composite: 0,
      traa: 1,
      dof: 0,
      bloom: 0,
      output: 0,
      other: 0,
    };
    const frames = [
      { gpu, cpu: 1, flow: 0.5 },
      { gpu, cpu: 1, flow: 0.7 },
      { gpu, cpu: 1 },
      { gpu, cpu: 1, flow: 0.6 },
    ];
    const s = flowRunSummary(frames, { gpuMs: [3, 4, 5, Number.NaN], iterations: [2, 2, 3, 3] });
    expect(s.flowRender).toEqual({
      frames: 3,
      p10: expect.closeTo(0.52, 6) as number,
      p50: 0.6,
      p90: expect.closeTo(0.68, 6) as number,
    });
    expect(s.solverGpuMs.p50).toBe(4);
    expect(s.solverGpuMs.frames).toBe(3);
    expect(s.iterationsPerFrame.p50).toBe(2.5);
    // no flow at all: NaN, not 0 (W2V-N13)
    const none = flowRunSummary([{ gpu, cpu: 1 }], { gpuMs: [], iterations: [] });
    expect(none.flowRender.frames).toBe(0);
    expect(Number.isNaN(none.flowRender.p50)).toBe(true);
  });
});
