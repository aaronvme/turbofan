// The view's cost and readiness in the shell: D4-85's backing-store cap (the canvas renders at
// most P4's 1080p pixels up to quality high; ultra keeps the full device pixel ratio) and D4-88's
// settled-view signal (the browser suite shoots once the worker says the view has settled, not
// after a fixed wait). Pure.
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../../src/contracts/ui';
import {
  BACKING_STORE_MAX_PX,
  MAX_DPR,
  backingDpr,
  backingSize,
} from '../../../src/shell/pixelCap';
import { SETTLED_FRAMES, createSettleTracker } from '../../../src/shell/settle';

const pixels = (w: number, h: number, dpr: number) => {
  const s = backingSize(w, h, dpr);
  return s.width * s.height;
};

describe('the backing-store cap (D4-85)', () => {
  it('is 1920 x 1080 pixels (P4 measures the render at 1080p)', () => {
    expect(BACKING_STORE_MAX_PX).toBe(1920 * 1080);
  });

  it('caps the canvas at 1080p-equivalent pixels for quality up to high', () => {
    for (const q of ['low', 'medium', 'high'] as const) {
      // the shared machine's case: 1920 x 1001 CSS px at Chrome's 1.5x was 4.33 MP
      const d = backingDpr(1920, 1001, 1.5, q);
      expect(d, q).toBeLessThan(1.5);
      expect(pixels(1920, 1001, d), q).toBeLessThanOrEqual(BACKING_STORE_MAX_PX);
      // the cap, not less: within 0.5 % of it
      expect(pixels(1920, 1001, d), q).toBeGreaterThan(0.995 * BACKING_STORE_MAX_PX);
      // 1366 x 768 at 1.5x (2.36 MP) is capped too; a small window is not
      expect(pixels(1366, 768, backingDpr(1366, 768, 1.5, q)), q).toBeLessThanOrEqual(
        BACKING_STORE_MAX_PX,
      );
      expect(backingDpr(800, 600, 1.5, q), q).toBe(1.5);
    }
    // a window larger than 1080p at 1x renders below 1x and is upscaled
    const d = backingDpr(2560, 1440, 1, 'high');
    expect(d).toBeCloseTo(0.75, 12);
    expect(backingSize(2560, 1440, d)).toEqual({ width: 1920, height: 1080 });
  });

  it('ultra keeps the full device pixel ratio (the explicit opt-in), up to the client cap', () => {
    expect(backingDpr(1920, 1001, 1.5, 'ultra')).toBe(1.5);
    expect(backingSize(1920, 1001, 1.5)).toEqual({ width: 2880, height: 1501 });
    expect(backingDpr(1920, 1001, 3, 'ultra')).toBe(MAX_DPR);
    expect(QUALITY_PRESETS.at(-1)).toBe('ultra');
  });

  it('reads a missing or bad device pixel ratio as 1', () => {
    expect(backingDpr(800, 600, 0, 'high')).toBe(1);
    expect(backingDpr(800, 600, Number.NaN, 'ultra')).toBe(1);
    expect(backingSize(1, 1, 0.1)).toEqual({ width: 1, height: 1 });
  });
});

describe("the settled-view signal (D4-88's shots)", () => {
  it('counts the frames the view has been settled in the asked mode, from 0 on any change', () => {
    const t = createSettleTracker();
    expect(t.frame('realistic', true)).toBe(1);
    expect(t.frame('realistic', true)).toBe(2);
    // a mode switch: the view moves (the wedge opens), so it is not settled
    expect(t.frame('cutaway', false)).toBe(0);
    expect(t.frame('cutaway', false)).toBe(0);
    let n = 0;
    for (let k = 0; k < SETTLED_FRAMES; k++) n = t.frame('cutaway', true);
    expect(n).toBe(SETTLED_FRAMES);
    // a new mode starts again even if its first frame already reads settled
    expect(t.frame('data', true)).toBe(0);
    expect(t.frame('data', true)).toBe(1);
  });

  it('waits for TRAA to converge: half a second of frames at 60 fps', () => {
    expect(SETTLED_FRAMES).toBe(30);
  });
});
