// W1L-I3 (critic pass 4): the fan's rotational blur against a ground truth. A film camera
// with an open shutter records the time average of the rotor image over the angle the fan
// turns, so the reference is the mean of 64 still renders (shutter 0) with the fan turned to
// angles spread evenly over the exposure: an exact box shutter, to 1/64 of the exposure.
//
// Metric (stated): displayed luminance (Rec. 709 of the tone-mapped sRGB pixels), over the
// pixels the fan's motion changes (their range across the 64 stills exceeds 0.02).
// - The estimator (TRAA off, so nothing but the blur is compared): the mean of 64 frames at
//   the preset's shutter against the reference. Both sides are means of 64 tone-mapped
//   frames, so tone mapping cancels. Mean absolute error <= 0.012 and worst 16 x 16 tile
//   (mean over its moving pixels, tiles with >= 32 of them) <= 0.04.
// - What ships (TRAA on, one frame after 48 frames of accumulation): mean absolute error
//   <= 0.03 and worst tile <= 0.08. TRAA averages in linear light before the tone map and
//   clamps its history, so this bound is looser.
// The pass-4 march (one rasterised rotor image, reprojected) fails both: its shredded far
// side, hub comb and dark crescents are tiles far off the reference.

import { afterAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import { LOOK_PRESETS, type LookPresetId } from '../../src/render/presets';
import { grab, nextFrame, settle, TILE, type Grab } from './lib/frames';

const W = 960;
const H = 540;
const N_REF = 64;
const MOVING = 0.02;
const LIMITS = { raw: { mae: 0.012, tile: 0.04 }, traa: { mae: 0.03, tile: 0.08 } } as const;

interface Stack {
  readonly mean: Float32Array;
  readonly lo: Float32Array;
  readonly hi: Float32Array;
}

async function meanOf(
  view: EngineView,
  c: HTMLCanvasElement,
  n: number,
  before: (i: number) => void,
): Promise<Stack> {
  const mean = new Float32Array(W * H);
  const lo = new Float32Array(W * H).fill(1);
  const hi = new Float32Array(W * H);
  for (let i = 0; i < n; i++) {
    before(i);
    const g: Grab = grab(view, c);
    for (let p = 0; p < W * H; p++) {
      const v = g.lum[p] ?? 0;
      mean[p] = (mean[p] ?? 0) + v / n;
      lo[p] = Math.min(lo[p] ?? 1, v);
      hi[p] = Math.max(hi[p] ?? 0, v);
    }
    await nextFrame();
  }
  return { mean, lo, hi };
}

interface Err {
  readonly mae: number;
  readonly tile: number;
  readonly moving: number;
}

function error(est: Float32Array, ref: Float32Array, mask: Uint8Array): Err {
  let sum = 0;
  let n = 0;
  let worst = 0;
  for (let ty = 0; ty < H; ty += TILE)
    for (let tx = 0; tx < W; tx += TILE) {
      let ts = 0;
      let tn = 0;
      for (let y = ty; y < Math.min(H, ty + TILE); y++)
        for (let x = tx; x < Math.min(W, tx + TILE); x++) {
          const p = y * W + x;
          if (mask[p] !== 1) continue;
          ts += Math.abs((est[p] ?? 0) - (ref[p] ?? 0));
          tn++;
        }
      sum += ts;
      n += tn;
      if (tn >= 32) worst = Math.max(worst, ts / tn);
    }
  return { mae: n > 0 ? sum / n : 0, tile: worst, moving: n / (W * H) };
}

describe('W1L-I3: the fan blur matches a 64-still box-shutter reference', () => {
  let view: EngineView | null = null;
  afterAll(async () => {
    if (view !== null) await view.dispose();
  });

  it('fanIdle, hero and fanTakeoff: estimator and shipped frame within the stated bounds', async () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    document.body.appendChild(c);
    view = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
      quality: 'high',
    });
    const v = view;
    const rows: string[] = [];
    const failures: string[] = [];
    for (const shot of ['fanIdle', 'hero', 'fanTakeoff'] as LookPresetId[]) {
      const preset = LOOK_PRESETS[shot];
      v.setDebugFlags({ noTraa: true });
      v.setPreset(shot);
      await settle(v, 8);
      const blur = (v.stats().lpBlurDeg * Math.PI) / 180;
      // the reference: 64 stills, shutter 0, the fan turned across the exposure
      v.setShutter(0);
      const ref = await meanOf(v, c, N_REF, (i) => {
        v.setDebugFlags({ noTraa: true, lpPhase: ((i + 0.5) / N_REF - 0.5) * blur });
      });
      const mask = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++)
        mask[p] = (ref.hi[p] ?? 0) - (ref.lo[p] ?? 0) > MOVING ? 1 : 0;
      // the estimator: 64 frames at the preset's shutter, TRAA off
      v.setShutter(preset.shutterDeg);
      v.setDebugFlags({ noTraa: true });
      await settle(v, 2);
      const est = await meanOf(v, c, N_REF, () => undefined);
      // what ships: TRAA on, one frame
      v.setDebugFlags({});
      await settle(v, 48);
      const shipped = grab(v, c);
      const raw = error(est.mean, ref.mean, mask);
      const traa = error(shipped.lum, ref.mean, mask);
      rows.push(
        `${shot} (blur ${((blur * 180) / Math.PI).toFixed(1)} deg, moving ${(100 * raw.moving).toFixed(1)} % of the frame): estimator MAE ${raw.mae.toFixed(4)} worst tile ${raw.tile.toFixed(4)} | shipped MAE ${traa.mae.toFixed(4)} worst tile ${traa.tile.toFixed(4)}`,
      );
      if (raw.moving < 0.01) failures.push(`${shot}: the fan barely moves (${raw.moving})`);
      if (raw.mae > LIMITS.raw.mae || raw.tile > LIMITS.raw.tile)
        failures.push(`${shot} estimator`);
      if (traa.mae > LIMITS.traa.mae || traa.tile > LIMITS.traa.tile)
        failures.push(`${shot} shipped`);
    }
    console.log(`W1L-I3 fan blur\n${rows.join('\n')}`);
    expect(v.stats().errors).toEqual([]);
    expect(failures, rows.join('\n')).toEqual([]);
  });
});
