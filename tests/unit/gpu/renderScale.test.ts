// D3-7: the performance profile's dynamic resolution (src/gpu/renderScale.ts). The 3D passes
// and TRAA run at a render scale in [0.75, 0.85] that follows the measured GPU time: down a
// step when a frame is over the budget, up a step only when the bigger scale is predicted to
// fit (the cost of the scaled passes goes with the pixel count, scale^2), and never twice
// within the hold (the timer's rolling window must refill at the new scale first).

import { describe, expect, it } from 'vitest';
import {
  initialRenderScale,
  nextRenderScale,
  RENDER_PROFILES,
  type RenderProfile,
  type RenderScaleState,
} from '../../../src/gpu/renderScale';

const perf = RENDER_PROFILES.performance;

const run = (
  s: RenderScaleState,
  gpuMs: number,
  frames: number,
  profile: RenderProfile = perf,
): RenderScaleState => {
  let t = s;
  for (let i = 0; i < frames; i++) t = nextRenderScale(t, gpuMs, profile);
  return t;
};

describe('render profiles', () => {
  it('quality draws at full resolution, performance between 0.75 and 0.85 (D3-7)', () => {
    expect(RENDER_PROFILES.quality.minScale).toBe(1);
    expect(RENDER_PROFILES.quality.maxScale).toBe(1);
    expect(perf.minScale).toBe(0.75);
    expect(perf.maxScale).toBe(0.85);
    expect(perf.budgetMs).toBe(8);
  });

  it('starts at the top of the range', () => {
    expect(initialRenderScale(perf).scale).toBe(0.85);
    expect(initialRenderScale(RENDER_PROFILES.quality).scale).toBe(1);
  });
});

describe('nextRenderScale', () => {
  it('steps down when over the budget, after the hold, and stops at the minimum', () => {
    const s0 = initialRenderScale(perf);
    // within the hold nothing changes, however slow
    expect(run(s0, 20, perf.holdFrames - 1).scale).toBe(0.85);
    const s1 = run(s0, 20, perf.holdFrames);
    expect(s1.scale).toBeCloseTo(0.8, 12);
    const s2 = run(s1, 20, perf.holdFrames);
    expect(s2.scale).toBeCloseTo(0.75, 12);
    expect(run(s2, 20, 10 * perf.holdFrames).scale).toBeCloseTo(0.75, 12);
  });

  it('steps up only when the bigger scale is predicted to fit under the headroom', () => {
    const low: RenderScaleState = { scale: 0.75, framesSinceChange: perf.holdFrames };
    // 7.5 ms at 0.75 predicts 7.5 (0.8/0.75)^2 = 8.53 ms at 0.8: over, so it stays
    expect(nextRenderScale(low, 7.5, perf).scale).toBe(0.75);
    // 6 ms predicts 6.83 ms, under 8 x 0.9: up
    expect(nextRenderScale(low, 6, perf).scale).toBeCloseTo(0.8, 12);
    // and never past the maximum
    const top: RenderScaleState = { scale: 0.85, framesSinceChange: perf.holdFrames };
    expect(nextRenderScale(top, 1, perf).scale).toBe(0.85);
  });

  it('holds between the two thresholds (no oscillation)', () => {
    const mid: RenderScaleState = { scale: 0.8, framesSinceChange: perf.holdFrames };
    // 7.6 ms: under the budget, but 0.85 would be 8.58 ms
    const t = run(mid, 7.6, 20 * perf.holdFrames);
    expect(t.scale).toBeCloseTo(0.8, 12);
  });

  it('ignores a missing measurement and never leaves a fixed range', () => {
    const s = initialRenderScale(perf);
    expect(run(s, Number.NaN, 5 * perf.holdFrames).scale).toBe(0.85);
    expect(run(s, 0, 5 * perf.holdFrames).scale).toBe(0.85);
    const q = initialRenderScale(RENDER_PROFILES.quality);
    expect(run(q, 30, 5 * perf.holdFrames, RENDER_PROFILES.quality).scale).toBe(1);
  });

  it('counts frames since the last change', () => {
    const s = nextRenderScale({ scale: 0.8, framesSinceChange: 3 }, 7.6, perf);
    expect(s.framesSinceChange).toBe(4);
    const d = nextRenderScale({ scale: 0.8, framesSinceChange: perf.holdFrames }, 20, perf);
    expect(d.framesSinceChange).toBe(0);
  });
});
