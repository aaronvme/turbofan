import { describe, expect, it } from 'vitest';
import {
  isFlowPass,
  median,
  PASS_GROUPS,
  passGroupOf,
  RollingPassStats,
  sumByGroup,
  sumFlowMs,
} from '../../../src/gpu/passTimings';

describe('passGroupOf (three render-context names -> render passes, W1G-I2)', () => {
  it.each([
    ['Shadow Map [ key ]', 'shadow'],
    ['VSMVertical', 'shadow'],
    ['Opaque', 'opaque'],
    ['Rotors', 'rotors'],
    ['AO', 'gtao'],
    ['Composite [ RTT ]', 'composite'],
    ['TRAA', 'traa'],
    ['DoF [ CoC ]', 'dof'],
    ['DoF [ Blur64 Near ]', 'dof'],
    // the depth of field's circle-of-confusion blur and its input copy
    ['Gaussian Blur [ Horizontal Pass ]', 'dof'],
    ['Gaussian Blur [ Vertical Pass ]', 'dof'],
    ['Bloom [ High Pass ]', 'bloom'],
    ['Bloom [ Blur Vertical - 3 ]', 'bloom'],
    ['Bloom [ Composite ]', 'bloom'],
    ['Render Pipeline', 'output'],
    ['', 'other'],
    ['PMREM', 'other'],
  ] as const)('%s -> %s', (label, group) => {
    expect(passGroupOf(label)).toBe(group);
  });
});

describe('sumByGroup', () => {
  it('adds every pass of one frame into its group and fills the rest with 0', () => {
    const s = sumByGroup([
      { label: 'Opaque', ms: 2 },
      { label: 'Bloom [ High Pass ]', ms: 0.25 },
      { label: 'Bloom [ Composite ]', ms: 0.5 },
      { label: 'AO', ms: 1 },
    ]);
    expect(s.opaque).toBe(2);
    expect(s.bloom).toBe(0.75);
    expect(s.gtao).toBe(1);
    expect(s.traa).toBe(0);
    expect(Object.keys(s).sort()).toEqual([...PASS_GROUPS].sort());
  });

  it('drops invalid durations (NaN, negative, longer than the 2 s TDR limit)', () => {
    const s = sumByGroup([
      { label: 'Opaque', ms: Number.NaN },
      { label: 'Opaque', ms: -1 },
      { label: 'Opaque', ms: 5000 },
      { label: 'Opaque', ms: 1.5 },
    ]);
    expect(s.opaque).toBe(1.5);
  });
});

describe('median', () => {
  it('is the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

describe('RollingPassStats', () => {
  it('reports per-pass medians, their total and the CPU time over the last N frames', () => {
    const r = new RollingPassStats(3);
    const frame = (opaque: number, cpu: number) => {
      r.push(sumByGroup([{ label: 'Opaque', ms: opaque }]), cpu);
    };
    frame(10, 9);
    frame(1, 1);
    frame(2, 2);
    frame(3, 3);
    const m = r.medians();
    expect(m.frames).toBe(3);
    expect(m.gpu.opaque).toBe(2); // the first frame fell out of the window
    expect(m.gpuTotal).toBe(2);
    expect(m.cpu).toBe(2);
  });

  it('the total is the median of per-frame totals, not the sum of medians', () => {
    const r = new RollingPassStats(3);
    r.push(
      sumByGroup([
        { label: 'Opaque', ms: 1 },
        { label: 'AO', ms: 5 },
      ]),
      0,
    );
    r.push(
      sumByGroup([
        { label: 'Opaque', ms: 5 },
        { label: 'AO', ms: 1 },
      ]),
      0,
    );
    r.push(
      sumByGroup([
        { label: 'Opaque', ms: 3 },
        { label: 'AO', ms: 3 },
      ]),
      0,
    );
    const m = r.medians();
    expect(m.gpu.opaque).toBe(3);
    expect(m.gpu.gtao).toBe(3);
    expect(m.gpuTotal).toBe(6);
  });

  it('is empty before any frame', () => {
    const m = new RollingPassStats(4).medians();
    expect(m.frames).toBe(0);
    expect(m.gpuTotal).toBeNaN();
  });

  it('needs a positive window', () => {
    expect(() => new RollingPassStats(0)).toThrow();
  });
});

// w2/flowviz: the flow visuals' passes ("Flow ...") are timed apart from the render, because
// P4 is the render GPU time excluding the solver and the flow visuals (D4-2, PHYSICS.md 3.4)
describe('flow-visual passes (D4-2: outside P4, inside the flow-visuals budget)', () => {
  it('are recognised by name and left out of every render group', () => {
    expect(isFlowPass('Flow Overlay')).toBe(true);
    expect(isFlowPass('Flow Particles [ RTT ]')).toBe(true);
    expect(isFlowPass('Opaque')).toBe(false);
    expect(isFlowPass('Flowing')).toBe(false);
    const s = sumByGroup([
      { label: 'Opaque', ms: 2 },
      { label: 'Flow Overlay', ms: 0.5 },
    ]);
    expect(s.opaque).toBe(2);
    expect(s.other).toBe(0);
    expect(PASS_GROUPS.reduce((t, g) => t + s[g], 0)).toBe(2);
  });

  it('sum into one flow total (valid durations only)', () => {
    expect(
      sumFlowMs([
        { label: 'Opaque', ms: 2 },
        { label: 'Flow Overlay', ms: 0.5 },
        { label: 'Flow Haze [ RTT ]', ms: 0.25 },
        { label: 'Flow Overlay', ms: Number.NaN },
      ]),
    ).toBe(0.75);
  });

  it('get their own rolling median, which the render total does not include', () => {
    const r = new RollingPassStats(3);
    r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1, 1);
    r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1, 3);
    r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1, 2);
    const m = r.medians();
    expect(m.flow).toBe(2);
    expect(m.gpuTotal).toBe(4);
    r.beginRun();
    r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1, 0.5);
    expect(r.endRun()).toEqual([
      { gpu: sumByGroup([{ label: 'Opaque', ms: 4 }]), cpu: 1, flow: 0.5 },
    ]);
  });

  it('count 0 when no frame in the window drew any', () => {
    const r = new RollingPassStats(2);
    r.push(sumByGroup([{ label: 'Opaque', ms: 1 }]), 1);
    expect(r.medians().flow).toBe(0);
  });

  // W2V-N13: a frame from before the flow was switched on, or one whose flow queries were all
  // dropped, has no flow time: counting it as 0 showed D4-2's scheduler the visuals low
  it('skip the frames without a flow time instead of counting them as 0', () => {
    const r = new RollingPassStats(6);
    for (let k = 0; k < 3; k++) r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1);
    r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1, 1.2);
    r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1, Number.NaN);
    r.push(sumByGroup([{ label: 'Opaque', ms: 4 }]), 1, 1.4);
    expect(r.medians().flow).toBeCloseTo(1.3, 12);
    expect(r.medians().gpuTotal).toBe(4);
  });

  it('a frame whose flow durations are all invalid has no flow time (NaN), not 0', () => {
    expect(sumFlowMs([{ label: 'Flow Overlay', ms: Number.NaN }])).toBeNaN();
    expect(sumFlowMs([{ label: 'Opaque', ms: 1 }])).toBeNaN();
  });
});
