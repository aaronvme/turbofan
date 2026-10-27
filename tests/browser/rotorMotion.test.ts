// W1V-I1 fix (b), D4-4: the cutaway shows a running engine, so TRAA must reproject the turning
// rotors with their own motion (src/render/post.ts) instead of averaging each rotor pixel with
// the rotor at other phases (the ghosted, feathered fan of 03 and 04). From the critic's pass-6
// probe (docs/reviews/probes/w1v-rotor-traa.browser.probe.ts.txt):
// - floor: TRAA converged with the spools held still (48 frames at dt 0) against a TRAA-off
//   still at the same phase: TRAA's own edge anti-aliasing;
// - moving: TRAA after 48 frames at dt 1/60 (the MOCK idle spools: about 7 fan pitches a
//   frame) against a TRAA-off still at the last frame's phase.
// A pixel differs at a displayed-luminance change > 0.04, a 16 px tile when > 25 % of it does
// (the culling test's rule). Bound (stated before the fix was measured): moving tiles at most
// the floor's plus MARGIN in every pose. MARGIN: the probe's unfixed excess was 14-18 tiles in
// the close-ups and the cutaway preset, 5 in the exploded preset and hotSection; 6 tiles is
// below the close-ups' excess and above what TRAA's convergence in motion adds elsewhere.
// Negative control: the pre-fix pipeline (`legacyTraa`: three r186's own resolve on the scene's
// depth and zero rotor velocity) must exceed the bound in the cutaway close-up, so the test
// can see the ghosting it guards against. (First written as `noRotorMotion` alone; with our
// resolve, src/render/traaResolve.ts, its tighter clip no longer ghosts at zero velocity, 8
// tiles: it rejects the history instead of accumulating it, so the control had to be the old
// pipeline. The bound is unchanged.)

import { afterAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createEngineView, type DebugFlags, type EngineView } from '../../src/render/engineView';
import type { LookPresetId } from '../../src/render/presets';
import { diff, diffImage, grab, nextFrame, settle } from './lib/frames';

const W = 960;
const H = 540;
const THRESHOLD = 0.04;
const MARGIN = 6;

interface Pose {
  readonly preset: LookPresetId;
  readonly camera?: [number, number, number];
  readonly target?: [number, number, number];
}
const CUTAWAY_FAN_CLOSE: Pose = {
  preset: 'cutaway',
  camera: [-0.9, 1.0, 2.2],
  target: [0.1, 0.15, 0],
};
const POSES: Readonly<Record<string, Pose>> = {
  cutaway: { preset: 'cutaway' },
  cutawayFanClose: CUTAWAY_FAN_CLOSE,
  exploded: { preset: 'exploded' },
  explodedFanClose: { preset: 'exploded', camera: [-0.6, 1.2, 2.6], target: [0, 0, 0] },
  hotSection: { preset: 'hotSection' },
};

describe('W1V-I1 (b): TRAA reprojects the turning rotors', () => {
  let view: EngineView | null = null;
  afterAll(async () => {
    if (view !== null) await view.dispose();
  });

  it('in motion, every shutter-0 pose stays within MARGIN tiles of the held-still floor', async () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    document.body.appendChild(c);
    const open = (legacyTraa: boolean) =>
      createEngineView({
        gpu: navigator.gpu,
        canvas: c,
        definition: ENGINE_DEFINITION,
        width: W,
        height: H,
        dpr: 1,
        quality: 'high',
        legacyTraa,
      });
    view = await open(false);
    let v = view;
    const measure = async (name: string, pose: Pose, flags: DebugFlags) => {
      const place = () => {
        v.setPreset(pose.preset);
        if (pose.camera && pose.target) v.setCameraPose(pose.camera, pose.target);
      };
      v.setDebugFlags(flags);
      place();
      await settle(v, 48);
      const restTraa = grab(v, c);
      v.setDebugFlags({ ...flags, noTraa: true });
      const restStill = grab(v, c);
      v.setDebugFlags(flags);
      place();
      for (let i = 0; i < 48; i++) {
        v.frame(1 / 60);
        await nextFrame();
      }
      // grab renders one more frame at dt 0: the spools hold still for it, so zero rotor motion
      // is right there, and the history it reprojects is the moving one
      const movingTraa = grab(v, c);
      v.setDebugFlags({ ...flags, noTraa: true });
      const movingStill = grab(v, c);
      const floor = diff(restTraa, restStill, THRESHOLD);
      const moving = diff(movingTraa, movingStill, THRESHOLD);
      await commands.writeFile(
        `test-results/rotorMotion/${name}-moving.png`,
        diffImage(movingStill, movingTraa, THRESHOLD),
        'base64',
      );
      return { floor: floor.tilesOver25, moving: moving.tilesOver25 };
    };
    const rows: string[] = [];
    const failures: string[] = [];
    for (const [name, pose] of Object.entries(POSES)) {
      const r = await measure(name, pose, {});
      rows.push(`${name}: at rest ${String(r.floor)} tiles | moving ${String(r.moving)} tiles`);
      if (r.moving > r.floor + MARGIN) failures.push(name);
    }
    expect(v.stats().errors).toEqual([]);
    await v.dispose();
    view = await open(true);
    v = view;
    const control = await measure('control-cutawayFanClose', CUTAWAY_FAN_CLOSE, {});
    rows.push(
      `control (legacyTraa: three's resolve, zero rotor velocity) cutawayFanClose: at rest ${String(control.floor)} | moving ${String(control.moving)} tiles`,
    );
    await commands.writeFile('test-results/rotorMotion.txt', `${rows.join('\n')}\n`);
    console.warn(`W1V-I1 rotor motion\n${rows.join('\n')}`);
    expect(v.stats().errors).toEqual([]);
    expect(failures, rows.join('\n')).toEqual([]);
    expect(control.moving, rows.join('\n')).toBeGreaterThan(control.floor + MARGIN);
  });
});
