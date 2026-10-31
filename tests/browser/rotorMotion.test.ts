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
//
// D4-74 (W2L-I8): MARGIN is not widened; the measurement is made robust instead, stated here
// before it was measured. A count from one frame is one draw of a distribution: TRAA's jitter
// phase moves the floor's edge pixels from frame to frame, and the fan's per-frame turn (about 7.x
// pitches) puts the blades at another phase against the cut faces in every frame, which moves the
// moving count. The cutaway close-up sat at its bound with one draw (8 tiles against 2 + 6, 9 once),
// so the verdict depended on the draw. Both counts are now the MEAN over SAMPLES frames, each
// taken as the single count was (a TRAA frame and the TRAA-off still at its phase), with BETWEEN
// frames of the same kind (dt 0 at rest, dt 1/60 moving) between two samples so each is a
// converged TRAA again. The bound compares like with like (mean moving <= mean floor + MARGIN),
// so it judges the expected excess, which is what MARGIN was stated for; the standard error of a
// mean of 8 is a third of one frame's spread. The per-frame counts are printed, so the
// distribution is on record. The control uses the same means.

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
/** D4-74: frames per mean, and the frames of the same kind between two samples. */
const SAMPLES = 8;
const BETWEEN = 16;

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

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('W1V-I1 (b): TRAA reprojects the turning rotors', () => {
  let view: EngineView | null = null;
  afterAll(async () => {
    if (view !== null) await view.dispose();
  });

  it('in motion, every shutter-0 pose stays within MARGIN tiles of the held-still floor (means of 8 frames)', async () => {
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
    const run = async (frames: number, dt: number) => {
      for (let i = 0; i < frames; i++) {
        v.frame(dt);
        await nextFrame();
      }
    };
    const measure = async (name: string, pose: Pose, flags: DebugFlags) => {
      const place = () => {
        v.setPreset(pose.preset);
        if (pose.camera && pose.target) v.setCameraPose(pose.camera, pose.target);
      };
      /** One sample: a TRAA frame and the TRAA-off still at its phase (both at dt 0). */
      const sample = () => {
        const traa = grab(v, c);
        v.setDebugFlags({ ...flags, noTraa: true });
        const still = grab(v, c);
        v.setDebugFlags(flags);
        return { traa, still, tiles: diff(traa, still, THRESHOLD).tilesOver25 };
      };
      v.setDebugFlags(flags);
      place();
      await settle(v, 48);
      const floor: number[] = [];
      for (let k = 0; k < SAMPLES; k++) {
        if (k > 0) await settle(v, BETWEEN);
        floor.push(sample().tiles);
      }
      place();
      await run(48, 1 / 60);
      // each grab renders one more frame at dt 0: the spools hold still for it, so zero rotor
      // motion is right there, and the history it reprojects is the moving one
      const moving: number[] = [];
      for (let k = 0; k < SAMPLES; k++) {
        if (k > 0) await run(BETWEEN, 1 / 60);
        const s = sample();
        moving.push(s.tiles);
        if (k === 0)
          await commands.writeFile(
            `test-results/rotorMotion/${name}-moving.png`,
            diffImage(s.still, s.traa, THRESHOLD),
            'base64',
          );
      }
      return { floor: mean(floor), moving: mean(moving), floors: floor, movings: moving };
    };
    const line = (r: { floor: number; moving: number; floors: number[]; movings: number[] }) =>
      `at rest ${r.floor.toFixed(2)} tiles [${r.floors.join(' ')}] | moving ${r.moving.toFixed(2)} tiles [${r.movings.join(' ')}]`;
    const rows: string[] = [];
    const failures: string[] = [];
    for (const [name, pose] of Object.entries(POSES)) {
      const r = await measure(name, pose, {});
      rows.push(`${name}: ${line(r)}`);
      if (r.moving > r.floor + MARGIN) failures.push(name);
    }
    expect(v.stats().errors).toEqual([]);
    await v.dispose();
    view = await open(true);
    v = view;
    const control = await measure('control-cutawayFanClose', CUTAWAY_FAN_CLOSE, {});
    rows.push(
      `control (legacyTraa: three's resolve, zero rotor velocity) cutawayFanClose: ${line(control)}`,
    );
    await commands.writeFile('test-results/rotorMotion.txt', `${rows.join('\n')}\n`);
    console.warn(`W1V-I1 rotor motion (means of ${String(SAMPLES)} frames)\n${rows.join('\n')}`);
    expect(v.stats().errors).toEqual([]);
    expect(failures, rows.join('\n')).toEqual([]);
    expect(control.moving, rows.join('\n')).toBeGreaterThan(control.floor + MARGIN);
  });
});

// W2L-I1 (critic pass 8): the test above cannot see the motion vectors (with them dropped our
// resolve throws the rotor history away, and its output is close to the TRAA-off still the
// bound compares against). This one checks the vectors themselves, against the images: the
// velocity debug view (linear, signed, src/render/post.ts) after one moving frame, and two
// TRAA-off stills before and after it, the spools at shutter 0 so the stills are noise-free.
// Where the velocity is right, the earlier still at u - v(u) shows what the later still shows
// at u (the rotor turned rigidly; the half-pitch wrap lands on the next blade along, the same
// shape). Bound, stated before measuring: over the visible rotor pixels, the warp error with
// the shipped vectors at most WARP_RATIO of both the zero and the flipped vector's error (so
// `noRotorMotion` and a sign error each fail it; both controls are run and must fail).
// Only the rotor pixels whose image moved count (MOVED: a displayed change of 16/255 at zero
// vector): a drum or a disk face turns into itself and says nothing about the vector. (The
// first measurement over every rotor pixel: shipped 7.1, zero 8.1, flipped 12.9 /255.)
//
// W2L-I6 (critic pass 10; D4-74): that test passed vectors at half their length (the post.ts
// `back` x 0.5 mutant: 31.14 against 58.46 / 55.33, ratio 0.56), the factor between an NDC and a
// UV delta (`offsetUV = v (0.5, -0.5)`). At dt 1/60 the fan turns about 7 pitches a frame, so what
// is left after the half-pitch wrap depends on the phase and the image moves a pixel or two, where
// half a vector is within rounding of the whole one. The fix, stated before measuring (the
// critic's): the moving frame's dt is set so the fan turns STEP_PITCH of its pitch (from the
// view's own N1 and the fan's blade count; within half a pitch, so the wrap leaves it whole) and
// the moved pixels move several pixels (checked: the 10th percentile of |v| >= MIN_MOVE_PX, and the
// percentiles are printed); the earlier still is sampled bilinearly (no Math.round); and the half
// and 1.5x vectors are baselines that must lose too: shipped <= WARP_RATIO x min(zero, flipped,
// half, 1.5x). The view encodes |v| up to 32 px (8 bits of v/64 + 0.5): a pixel whose vector is
// clipped there is left out and counted. Controls that must fail the same bound: noRotorMotion,
// rotorMotionScale -1, 0.5 (the half-length mutant) and 1.5.
const WARP_RATIO = 0.6;
const MOVED = 16;
/** The moving frame's turn of the fan, in fan pitches (W2L-I6: about 0.3, within the wrap). */
const STEP_PITCH = 0.3;
/** W2L-I6: the moved pixels must move at least this far (10th percentile of |v|). */
const MIN_MOVE_PX = 4;

interface Warp {
  /** Rotor pixels counted (moved, vector not clipped), and the clipped ones left out. */
  readonly n: number;
  readonly clipped: number;
  /** Mean warp error /255 with the encoded vector times 1, 0, -1, 0.5 and 1.5. */
  readonly shipped: number;
  readonly zero: number;
  readonly flipped: number;
  readonly half: number;
  readonly oneAndHalf: number;
  /** |v| percentiles of the counted pixels, px. */
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

describe('W2L-I1: the rotor motion vectors are the rotors image motion', () => {
  let view: EngineView | null = null;
  afterAll(async () => {
    if (view !== null) await view.dispose();
  });

  it('the shipped vectors warp the previous still onto the current one; zero, flipped, half and 1.5x do not', async () => {
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
      debug: 'velocity',
    });
    const v = view;
    const fan = ENGINE_DEFINITION.bladeRows.find((r) => r.id === 'fan');
    if (fan === undefined) throw new Error('no fan row');
    const fanPitch = (2 * Math.PI) / fan.count;
    // renders one frame of dt and reads the canvas back before it is presented
    const read = (dt: number): Uint8ClampedArray => {
      v.frame(dt);
      const copy = document.createElement('canvas');
      copy.width = W;
      copy.height = H;
      const ctx = copy.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(c, 0, 0);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const lum = (px: Uint8ClampedArray, x: number, y: number): number => {
      const i = 4 * (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x)));
      return 0.2126 * (px[i] ?? 0) + 0.7152 * (px[i + 1] ?? 0) + 0.0722 * (px[i + 2] ?? 0);
    };
    /** Bilinear luminance at a sub-pixel position (pixel centres at integers). */
    const lumAt = (px: Uint8ClampedArray, x: number, y: number): number => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const top = (1 - fx) * lum(px, x0, y0) + fx * lum(px, x0 + 1, y0);
      const bottom = (1 - fx) * lum(px, x0, y0 + 1) + fx * lum(px, x0 + 1, y0 + 1);
      return (1 - fy) * top + fy * bottom;
    };
    const quantile = (xs: number[], q: number): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Number.NaN;
    };
    const measure = async (flags: DebugFlags): Promise<Warp> => {
      const still = { ...flags, noTraa: true, linear: true };
      v.setDebugFlags(still);
      v.setPreset(CUTAWAY_FAN_CLOSE.preset);
      v.setShutter(0);
      if (CUTAWAY_FAN_CLOSE.camera && CUTAWAY_FAN_CLOSE.target)
        v.setCameraPose(CUTAWAY_FAN_CLOSE.camera, CUTAWAY_FAN_CLOSE.target);
      await settle(v, 8);
      const before = read(0);
      // the fan turns STEP_PITCH of a pitch in this frame (N1 in rpm; the view's spool factor is
      // 1 outside the exploded mode)
      const omega = (v.stats().n1Rpm * 2 * Math.PI) / 60;
      const dt = (STEP_PITCH * fanPitch) / omega;
      v.setDebugFlags(flags);
      const vel = read(dt);
      v.setDebugFlags(still);
      const after = read(0);
      await nextFrame();
      let n = 0;
      let clipped = 0;
      const speeds: number[] = [];
      const err = { shipped: 0, zero: 0, flipped: 0, half: 0, oneAndHalf: 0 };
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = 4 * (y * W + x);
          if ((vel[i + 2] ?? 0) < 128) continue;
          const now = lum(after, x, y);
          const still0 = Math.abs(now - lum(before, x, y));
          // only where the rotor's image moved (a blade edge, not a drum or a disk face,
          // which turn into themselves)
          if (still0 < MOVED) continue;
          const r8 = vel[i] ?? 0;
          const g8 = vel[i + 1] ?? 0;
          if (r8 === 0 || r8 === 255 || g8 === 0 || g8 === 255) {
            clipped++;
            continue;
          }
          // pixels, screen x right and y down (the view encodes NDC y up)
          const vx = ((r8 - 127.5) / 255) * 64;
          const vy = -((g8 - 127.5) / 255) * 64;
          const warp = (k: number) => Math.abs(now - lumAt(before, x - k * vx, y - k * vy));
          err.shipped += warp(1);
          err.zero += still0;
          err.flipped += warp(-1);
          err.half += warp(0.5);
          err.oneAndHalf += warp(1.5);
          speeds.push(Math.hypot(vx, vy));
          n++;
        }
      return {
        n,
        clipped,
        shipped: err.shipped / n,
        zero: err.zero / n,
        flipped: err.flipped / n,
        half: err.half / n,
        oneAndHalf: err.oneAndHalf / n,
        p10: quantile(speeds, 0.1),
        p50: quantile(speeds, 0.5),
        p90: quantile(speeds, 0.9),
      };
    };
    const ok = (r: Warp) =>
      r.shipped <= WARP_RATIO * Math.min(r.zero, r.flipped, r.half, r.oneAndHalf);
    const shipped = await measure({});
    const controls = {
      noRotorMotion: await measure({ noRotorMotion: true }),
      'rotorMotionScale -1': await measure({ rotorMotionScale: -1 }),
      'rotorMotionScale 0.5 (half length)': await measure({ rotorMotionScale: 0.5 }),
      'rotorMotionScale 1.5': await measure({ rotorMotionScale: 1.5 }),
    };
    const f = (r: Warp) =>
      `${String(r.n)} rotor px (${String(r.clipped)} clipped left out), |v| p10/p50/p90 ${r.p10.toFixed(1)}/${r.p50.toFixed(1)}/${r.p90.toFixed(1)} px, warp error ${r.shipped.toFixed(2)} (zero ${r.zero.toFixed(2)}, flipped ${r.flipped.toFixed(2)}, half ${r.half.toFixed(2)}, 1.5x ${r.oneAndHalf.toFixed(2)}) /255`;
    const rows = [
      `step ${String(STEP_PITCH)} fan pitch per moving frame`,
      `shipped: ${f(shipped)}`,
      ...Object.entries(controls).map(([k, r]) => `control ${k}: ${f(r)}`),
    ];
    await commands.writeFile('test-results/rotorMotionWarp.txt', `${rows.join('\n')}\n`);
    console.warn(`W2L-I1 / W2L-I6 rotor motion warp\n${rows.join('\n')}`);
    expect(v.stats().errors).toEqual([]);
    expect(shipped.n, rows.join('\n')).toBeGreaterThan(5000);
    expect(shipped.p10, rows.join('\n')).toBeGreaterThanOrEqual(MIN_MOVE_PX);
    expect(ok(shipped), rows.join('\n')).toBe(true);
    for (const [k, r] of Object.entries(controls))
      expect(ok(r), `${k}\n${rows.join('\n')}`).toBe(false);
  });
});
