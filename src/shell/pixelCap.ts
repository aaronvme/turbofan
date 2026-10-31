// D4-85: the canvas renders the pixels P4 measures. P4's budget (the engine render <= 8 ms) is
// pre-registered at 1080p, and at Chrome's 1.5x scaling a 1920 x 1001 window rendered 4.33 MP,
// 2.1 times that (27.9 ms on the shared machine, leaving D4-2's solver at its floor). So for
// quality up to high the backing store holds at most 1920 x 1080 pixels and the browser upscales
// the canvas; ultra, the explicit opt-in, keeps the device pixel ratio up to the client's cap of 2
// (W2A-N18: a 3x display renders at 2). Pure: the worker
// applies it on every resize and quality change.

import type { QualityPreset } from '../contracts/ui';

/** The backing store's pixel cap up to quality high: 1920 x 1080 (2.07 MP). */
export const BACKING_STORE_MAX_PX = 1920 * 1080;
/** The client's device-pixel-ratio cap (every quality). */
export const MAX_DPR = 2;

/** The pixel ratio the canvas renders at, for a CSS size, the device's ratio and the quality. */
export function backingDpr(
  cssWidth: number,
  cssHeight: number,
  deviceDpr: number,
  quality: QualityPreset,
): number {
  const dpr = Math.min(MAX_DPR, deviceDpr > 0 ? deviceDpr : 1);
  if (quality === 'ultra') return dpr;
  const cap = Math.sqrt(BACKING_STORE_MAX_PX / Math.max(1, cssWidth * cssHeight));
  return Math.min(dpr, cap);
}

/** The drawing buffer three sizes at a pixel ratio (setSize(w, h, false): floor(w * dpr)). */
export function backingSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(cssWidth * dpr)),
    height: Math.max(1, Math.floor(cssHeight * dpr)),
  };
}
