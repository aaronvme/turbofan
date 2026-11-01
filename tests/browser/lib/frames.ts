// Frame read-back helpers for the browser image tests (culling, fan blur): render a frame
// and copy the canvas in the same task, before it is presented, then compare luminance.

import type { EngineView } from '../../../src/render/engineView';

export const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/** Renders `frames` frames at dt 0 (the spools and transitions hold still, only jitter moves). */
export async function settle(view: EngineView, frames: number): Promise<void> {
  for (let i = 0; i < frames; i++) {
    view.frame(0);
    await nextFrame();
  }
  await view.device.device.queue.onSubmittedWorkDone();
}

export interface Grab {
  readonly w: number;
  readonly h: number;
  /** Rec. 709 luminance of the displayed (tone-mapped, sRGB) pixels, 0..1. */
  readonly lum: Float32Array;
  readonly rgba: Uint8ClampedArray;
}

/** Renders one frame and reads the canvas back before it is presented. */
export function grab(view: EngineView, c: HTMLCanvasElement): Grab {
  view.frame(0);
  const w = c.width;
  const h = c.height;
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.drawImage(c, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    lum[i] =
      (0.2126 * (px[4 * i] ?? 0) + 0.7152 * (px[4 * i + 1] ?? 0) + 0.0722 * (px[4 * i + 2] ?? 0)) /
      255;
  return { w, h, lum, rgba: px };
}

export const TILE = 16;

export interface Diff {
  /** Fraction of pixels whose luminance differs by more than the threshold. */
  readonly changed: number;
  /** Largest fraction of changed pixels in one TILE x TILE tile. */
  readonly worstTile: number;
  /** Tiles with more than 25 % of their pixels changed. */
  readonly tilesOver25: number;
}

/**
 * Tile-wise difference. `masked` (one byte per pixel, 1 = masked) marks pixels that never count
 * as changed, while a tile's 25 % rule stays of the whole tile (the rotor test's band at the cut
 * faces: D4-96's cap pixels, which replaced D4-93's tiles with a ring).
 */
export function diff(a: Grab, b: Grab, threshold: number, masked?: Uint8Array): Diff {
  const { w, h } = a;
  let changed = 0;
  let worst = 0;
  let over = 0;
  for (let ty = 0; ty < h; ty += TILE)
    for (let tx = 0; tx < w; tx += TILE) {
      let n = 0;
      let m = 0;
      for (let y = ty; y < Math.min(h, ty + TILE); y++)
        for (let x = tx; x < Math.min(w, tx + TILE); x++) {
          m++;
          if (masked?.[y * w + x] === 1) continue;
          if (Math.abs((a.lum[y * w + x] ?? 0) - (b.lum[y * w + x] ?? 0)) > threshold) n++;
        }
      changed += n;
      worst = Math.max(worst, n / m);
      if (n / m > 0.25) over++;
    }
  return { changed: changed / (w * h), worstTile: worst, tilesOver25: over };
}

/** Frame b, dimmed, with every pixel that differs from a in red: base64 PNG. */
export function diffImage(a: Grab, b: Grab, threshold: number): string {
  const { w, h } = a;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const hit = Math.abs((a.lum[i] ?? 0) - (b.lum[i] ?? 0)) > threshold;
    img.data[4 * i] = hit ? 255 : (b.rgba[4 * i] ?? 0) * 0.6;
    img.data[4 * i + 1] = hit ? 0 : (b.rgba[4 * i + 1] ?? 0) * 0.6;
    img.data[4 * i + 2] = hit ? 0 : (b.rgba[4 * i + 2] ?? 0) * 0.6;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out.toDataURL('image/png').split(',')[1] ?? '';
}
