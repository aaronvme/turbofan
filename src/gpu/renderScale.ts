// Render profiles and the dynamic render scale (D3-7). `quality` draws every pass at full
// resolution. `performance` draws the 3D passes, the composite and TRAA at a render scale in
// [0.75, 0.85] and upsamples TRAA's output in the output pass (src/render/post.ts); the scale
// follows the measured GPU time against the 8 ms render budget. Pure, so it is unit-tested
// (tests/unit/gpu/renderScale.test.ts).

export interface RenderProfile {
  readonly minScale: number;
  readonly maxScale: number;
  readonly step: number;
  /** GPU render budget per frame, ms (the rest of the 16.7 ms frame is the solver's, D3-7). */
  readonly budgetMs: number;
  /** Step up only when the bigger scale is predicted under budgetMs x headroom. */
  readonly headroom: number;
  /**
   * Frames between changes: the timer's rolling window (120 frames, src/render/passTimer.ts)
   * must hold frames at the new scale before the next decision, and TRAA restarts its
   * history on every resize.
   */
  readonly holdFrames: number;
}

export const RENDER_PROFILES = {
  quality: { minScale: 1, maxScale: 1, step: 0.05, budgetMs: 8, headroom: 0.9, holdFrames: 120 },
  performance: {
    minScale: 0.75,
    maxScale: 0.85,
    step: 0.05,
    budgetMs: 8,
    headroom: 0.9,
    holdFrames: 120,
  },
} as const satisfies Readonly<Record<string, RenderProfile>>;

export type RenderProfileId = keyof typeof RENDER_PROFILES;
export const RENDER_PROFILE_IDS = Object.keys(RENDER_PROFILES) as RenderProfileId[];

export interface RenderScaleState {
  readonly scale: number;
  readonly framesSinceChange: number;
}

const snap = (s: number): number => Math.round(s * 1000) / 1000;

/** The profile's starting point: its largest scale (the first decision comes after the hold). */
export function initialRenderScale(p: RenderProfile): RenderScaleState {
  return { scale: p.maxScale, framesSinceChange: 0 };
}

/**
 * One frame of the controller. `gpuMs` is the recent median GPU time per frame at the current
 * scale (NaN or <= 0 when there is no measurement: the scale holds). The scaled passes cost
 * about the pixel count, so the time at scale s' is predicted as gpuMs (s'/s)^2; the fixed
 * costs (the full-resolution output pass) make that a slight overestimate going up.
 */
export function nextRenderScale(
  s: RenderScaleState,
  gpuMs: number,
  p: RenderProfile,
): RenderScaleState {
  const held = { scale: s.scale, framesSinceChange: s.framesSinceChange + 1 };
  if (held.framesSinceChange < p.holdFrames || !(gpuMs > 0)) return held;
  if (gpuMs > p.budgetMs && s.scale > p.minScale)
    return { scale: snap(Math.max(p.minScale, s.scale - p.step)), framesSinceChange: 0 };
  const up = Math.min(p.maxScale, s.scale + p.step);
  if (up > s.scale && gpuMs * (up / s.scale) ** 2 < p.budgetMs * p.headroom)
    return { scale: snap(up), framesSinceChange: 0 };
  return held;
}
