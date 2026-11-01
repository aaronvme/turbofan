// W1L-I3 (critic pass 4): the fan's rotational blur against a ground truth. A film camera
// with an open shutter records the time average of the rotor image over the angle the fan
// turns, so the reference is the mean of 64 still renders (shutter 0) with the fan turned to
// angles spread evenly over the exposure: an exact box shutter, to 1/64 of the exposure.
//
// Metric (stated): linear light. The view writes half the linear radiance with no tone map
// (the `linear` debug flag), read back as Rec. 709 luminance in 0..1, over the pixels the
// fan's motion changes (their range across the 64 stills exceeds 0.01). Averaging linear
// light is what film integrates (a mean of tone-mapped frames would not be).
// - The estimator (TRAA off, so nothing but the blur is compared): the mean of 64 frames at
//   the preset's shutter against the reference. Mean absolute error <= LIMITS.raw.mae and
//   worst 16 x 16 tile (mean over its moving pixels, tiles with >= 32 of them) <=
//   LIMITS.raw.tile.
// - What ships (TRAA on, one frame after 48 frames of accumulation, no depth of field):
//   LIMITS.traa. TRAA clamps its history to the current neighbourhood and anti-aliases the
//   static edges the reference leaves aliased, so this bound is looser.
// - What ships in motion (W1V-I1, pass 6: the app never holds the fan still): 48 frames at
//   dt 1/60 with the spools turning (TRAA reprojects the fan with its rotor motion vectors),
//   then the frame against a new reference at the fan's final phase: the same LIMITS.traa.
// The pass-4 march (one rasterised rotor image, reprojected) fails both: its shredded far
// side, hub comb and dark crescents are tiles far off the reference.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import { LOOK_PRESETS, type LookPresetId } from '../../src/render/presets';
import { grab, nextFrame, settle, TILE, type Grab } from './lib/frames';

const W = 960;
const H = 540;
const N_REF = 64;
const MOVING = 0.01;
// Measured (Arc 140T, 2026-10-26, half-linear units): estimator MAE 0.0024-0.0033, worst tile
// 0.072-0.083; shipped MAE 0.0055-0.0067, worst tile 0.081-0.092. The worst tiles sit on
// occluding edges (the fan tip against the case, the blade roots against the hub), where the
// composite's 3 x 3 average of the neighbours' instants bleeds one pixel; before that filter
// the estimator's worst tile was 0.025, but one frame was binary noise. The pass-4 march
// measured MAE 0.07-0.12 and worst tile 0.40-0.50 (display units).
const LIMITS = { raw: { mae: 0.005, tile: 0.11 }, traa: { mae: 0.012, tile: 0.13 } } as const;

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

// D4-100 (the merge gate on 469164a): the one test of three shots took 25.9 s alone and 26.6 s in
// the full suite on AC (2026-11-01, reports/scratch/polish), and timed out at 120 s in the
// official window's full suite with every assertion passing (a slowdown of at least 4.6x, cause
// unknown; the critic's battery run was 2.3-2.7x slower overall). Test plumbing, not a bar (D4-95's
// precedent): one test per shot, in the same order on the same view (the same frames), each with
// SHOT_TIMEOUT_MS, over 13x a shot's measured 9 s.
const SHOT_TIMEOUT_MS = 120_000;
/** The view's creation (its boot compile, about 1 s here), with the same margin. */
const SETUP_TIMEOUT_MS = 60_000;

describe('W1L-I3: the fan blur matches a 64-still box-shutter reference', () => {
  let view: EngineView | null = null;
  const c = document.createElement('canvas');
  const rows: string[] = [];
  beforeAll(async () => {
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
  }, SETUP_TIMEOUT_MS);
  afterAll(async () => {
    if (rows.length > 0) {
      console.warn(`W1L-I3 fan blur\n${rows.join('\n')}`);
      // the measured numbers, for the handoff (the browser console does not reach the log)
      await commands.writeFile('test-results/fanBlur.txt', `${rows.join('\n')}\n`);
    }
    if (view !== null) await view.dispose();
  });

  for (const shot of ['fanIdle', 'hero', 'fanTakeoff'] as LookPresetId[])
    it(
      `${shot}: estimator and shipped frame (still and in motion) within the stated bounds`,
      async () => {
        if (view === null) throw new Error('no view');
        const v = view;
        const failures: string[] = [];
        const preset = LOOK_PRESETS[shot];
        v.setDebugFlags({ noTraa: true, linear: true });
        v.setPreset(shot);
        await settle(v, 8);
        const blur = (v.stats().lpBlurDeg * Math.PI) / 180;
        // the reference: 64 stills, shutter 0, the fan turned across the exposure
        v.setShutter(0);
        const ref = await meanOf(v, c, N_REF, (i) => {
          v.setDebugFlags({
            noTraa: true,
            linear: true,
            lpPhase: ((i + 0.5) / N_REF - 0.5) * blur,
          });
        });
        const mask = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++)
          mask[p] = (ref.hi[p] ?? 0) - (ref.lo[p] ?? 0) > MOVING ? 1 : 0;
        // the estimator: 64 frames at the preset's shutter, TRAA off
        v.setShutter(preset.shutterDeg);
        v.setDebugFlags({ noTraa: true, linear: true });
        await settle(v, 2);
        const est = await meanOf(v, c, N_REF, () => undefined);
        // what ships: TRAA on, one frame
        v.setDebugFlags({ linear: true });
        await settle(v, 48);
        const shipped = grab(v, c);
        const raw = error(est.mean, ref.mean, mask);
        const traa = error(shipped.lum, ref.mean, mask);
        // what ships in motion: the spools turn for 48 frames, then the reference at the new phase
        v.setDebugFlags({ linear: true });
        for (let i = 0; i < 48; i++) {
          v.frame(1 / 60);
          await nextFrame();
        }
        const shippedMoving = grab(v, c);
        v.setShutter(0);
        const refMoving = await meanOf(v, c, N_REF, (i) => {
          v.setDebugFlags({
            noTraa: true,
            linear: true,
            lpPhase: ((i + 0.5) / N_REF - 0.5) * blur,
          });
        });
        v.setShutter(preset.shutterDeg);
        const maskMoving = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++)
          maskMoving[p] = (refMoving.hi[p] ?? 0) - (refMoving.lo[p] ?? 0) > MOVING ? 1 : 0;
        const moving = error(shippedMoving.lum, refMoving.mean, maskMoving);
        const row = `${shot} (blur ${((blur * 180) / Math.PI).toFixed(1)} deg, moving ${(100 * raw.moving).toFixed(1)} % of the frame): estimator MAE ${raw.mae.toFixed(4)} worst tile ${raw.tile.toFixed(4)} | shipped MAE ${traa.mae.toFixed(4)} worst tile ${traa.tile.toFixed(4)} | shipped in motion MAE ${moving.mae.toFixed(4)} worst tile ${moving.tile.toFixed(4)}`;
        rows.push(row);
        if (moving.mae > LIMITS.traa.mae || moving.tile > LIMITS.traa.tile)
          failures.push(`${shot} shipped in motion`);
        if (raw.moving < 0.01) failures.push(`${shot}: the fan barely moves (${raw.moving})`);
        if (raw.mae > LIMITS.raw.mae || raw.tile > LIMITS.raw.tile)
          failures.push(`${shot} estimator`);
        if (traa.mae > LIMITS.traa.mae || traa.tile > LIMITS.traa.tile)
          failures.push(`${shot} shipped`);
        expect(v.stats().errors).toEqual([]);
        expect(failures, row).toEqual([]);
      },
      SHOT_TIMEOUT_MS,
    );
});
