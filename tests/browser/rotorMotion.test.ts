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
// depth and zero rotor velocity) must exceed the bound in every banded pose (D4-96; before, the
// cutaway close-up only), so the test can see the ghosting it guards against. (First written as `noRotorMotion` alone; with our
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
// taken as the single count was (a TRAA frame and the TRAA-off still at its phase), with frames
// of the same kind before each later sample so each is a converged TRAA again: REST_BETWEEN at
// dt 0, and at dt 1/60 the single count's own 48 (MOVING_BETWEEN), so every moving sample repeats
// the single count's protocol. The bound compares like with like (mean moving <= mean floor +
// MARGIN), so it judges the expected excess, which is what MARGIN was stated for; the standard
// error of a mean of 8 is a third of one frame's spread. The per-frame counts are printed, so the
// distribution is on record. The control uses the same means. D4-93: measured that way, the
// cutaway preset's mean excess sat at MARGIN itself (6.38 tiles with 16 moving frames between
// samples, 5.75 with 48; single frames 31-45 against a floor of 26-33), a coin flip at any N. Its
// source is the cut faces (the critic's pass 8): where the cut hides the next blade, the half-pitch
// wrap's history lands on a cap or across the cut, so the excess there belongs to the cut geometry,
// not to the rotor vectors (W2L-I1's warp test below checks those). So in the cutaway preset the
// tiles at the cut faces left both counts, stated before the run: a tile with a cap pixel (the
// TRAA-off still with the caps against one without, at the pose) and one tile around it.
// MARGIN is unchanged (D4-74).
// D4-96 (W2L-I9, critic pass 16): in the default cutaway pose that band held every tile that tells
// the legacy pipeline from the shipped one (the control: 0.00 at rest, 0.63 moving, against a
// bound of 6), so the pose's row could not fail, a widening in effect. Stated before the run: the
// band is the cap pixels only (no tile, no ring around them); a band pixel never counts as
// changed, and a tile's 25 % rule stays of the whole tile. The control runs in every banded pose
// and must fail in each. If no band lets the default pose's control fail while the shipped
// pipeline passes there, that pose leaves the moving bound, with the reason stated here and in
// LOOKDEV.md. Each banded row also reports its counts without the band. MARGIN is unchanged.

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
/** D4-74: frames per mean, and the frames of the same kind before each later sample. */
const SAMPLES = 8;
const REST_BETWEEN = 16;
const MOVING_BETWEEN = 48;

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
        return {
          traa,
          still,
          tiles: diff(traa, still, THRESHOLD, band).tilesOver25,
          // reported beside it in a banded pose: the same frames without the band
          unbanded: diff(traa, still, THRESHOLD).tilesOver25,
        };
      };
      v.setDebugFlags(flags);
      place();
      await settle(v, 48);
      // D4-96 (W2L-I9): in the cutaway preset the cap pixels are left out of both counts: the
      // pixels where the TRAA-off still with the caps differs from one without (the caps, their
      // hatch and what they cover), and nothing around them. A band pixel never counts as
      // changed; a tile's 25 % rule stays of the whole tile (D4-93's band was every tile with a
      // cap pixel plus one tile around it)
      let band: Uint8Array | undefined;
      let bandPx = 0;
      if (pose.preset === 'cutaway') {
        v.setDebugFlags({ ...flags, noTraa: true });
        const withCaps = grab(v, c);
        v.setDebugFlags({ ...flags, noTraa: true, noCaps: true });
        const withoutCaps = grab(v, c);
        v.setDebugFlags(flags);
        band = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++)
          if (Math.abs((withCaps.lum[i] ?? 0) - (withoutCaps.lum[i] ?? 0)) > THRESHOLD) {
            band[i] = 1;
            bandPx++;
          }
        await settle(v, REST_BETWEEN);
      }
      const floor: number[] = [];
      const floorUnbanded: number[] = [];
      for (let k = 0; k < SAMPLES; k++) {
        if (k > 0) await settle(v, REST_BETWEEN);
        const s = sample();
        floor.push(s.tiles);
        floorUnbanded.push(s.unbanded);
      }
      place();
      await run(48, 1 / 60);
      // each grab renders one more frame at dt 0: the spools hold still for it, so zero rotor
      // motion is right there, and the history it reprojects is the moving one
      const moving: number[] = [];
      const movingUnbanded: number[] = [];
      for (let k = 0; k < SAMPLES; k++) {
        if (k > 0) await run(MOVING_BETWEEN, 1 / 60);
        const s = sample();
        moving.push(s.tiles);
        movingUnbanded.push(s.unbanded);
        if (k === 0)
          await commands.writeFile(
            `test-results/rotorMotion/${name}-moving.png`,
            diffImage(s.still, s.traa, THRESHOLD),
            'base64',
          );
      }
      return {
        floor: mean(floor),
        moving: mean(moving),
        floors: floor,
        movings: moving,
        bandPx,
        unbanded: band === undefined ? null : [mean(floorUnbanded), mean(movingUnbanded)],
      };
    };
    const line = (r: {
      floor: number;
      moving: number;
      floors: number[];
      movings: number[];
      bandPx: number;
      unbanded: number[] | null;
    }) =>
      `at rest ${r.floor.toFixed(2)} tiles [${r.floors.join(' ')}] | moving ${r.moving.toFixed(2)} tiles [${r.movings.join(' ')}]${r.unbanded === null ? '' : ` (${String(r.bandPx)} cap pixels, ${((100 * r.bandPx) / (W * H)).toFixed(1)} % of the frame, left out; without the band ${(r.unbanded[0] ?? NaN).toFixed(2)} / ${(r.unbanded[1] ?? NaN).toFixed(2)})`}`;
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
    // D4-96 (W2L-I9): every banded pose gets its own control, which must fail there, so a band
    // that held every tile telling the two pipelines apart (the default cutaway pose under D4-93's
    // band: legacyTraa 0.63 tiles against 6, critic pass 16) cannot pass unseen
    const controlPasses: string[] = [];
    for (const [name, pose] of Object.entries(POSES)) {
      if (pose.preset !== 'cutaway') continue;
      const control = await measure(`control-${name}`, pose, {});
      rows.push(
        `control (legacyTraa: three's resolve, zero rotor velocity) ${name}: ${line(control)}`,
      );
      if (!(control.moving > control.floor + MARGIN)) controlPasses.push(name);
    }
    await commands.writeFile('test-results/rotorMotion.txt', `${rows.join('\n')}\n`);
    console.warn(`W1V-I1 rotor motion (means of ${String(SAMPLES)} frames)\n${rows.join('\n')}`);
    expect(v.stats().errors).toEqual([]);
    expect(failures, rows.join('\n')).toEqual([]);
    expect(controlPasses, `the control must fail in every banded pose\n${rows.join('\n')}`).toEqual(
      [],
    );
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
// view's own N1 and the fan's blade count; within half a pitch, so the wrap leaves it whole), so
// that the moved pixels move several pixels; the earlier still is sampled bilinearly (no
// Math.round); and the half and 1.5x vectors are baselines that must lose too: shipped <=
// WARP_RATIO x min(zero, flipped, half, 1.5x). The view encodes |v| up to 32 px (8 bits of v/64 +
// 0.5): a pixel whose vector is clipped there is left out and counted. Controls that must fail the
// same bound: noRotorMotion, rotorMotionScale -1, 0.5 (the half-length mutant) and 1.5.
// The bound is judged on the moved pixels that move at least MIN_MOVE_PX (the critic's "the moved
// pixels move >= 4 px"): a step of 0.3 pitch moves the blade pixels 7.5 px at the median, but the
// slow ones near the hub and the HP rows move 1-2 px (p10 1.5 px, the first run), where half a
// vector is within a pixel of the whole one and says nothing about its length. Every moved pixel
// is reported beside it.
// D4-93: the first runs missed 0.6 against the half baseline by 0.001 (shipped 15.44, half 25.69 on
// the pixels that move >= 4 px) with the vectors right (the error least at 1x). What compressed
// the ratio is the warp's own floor: a disoccluded pixel shows a surface the earlier frame hid,
// so no vector can predict it, and it adds the same error to every baseline. Such pixels leave
// the bound, stated before the run: a forward-backward check, the earlier frame's backward field
// at the warped source (a rotor pixel whose vector maps it back within CONSISTENT_PX), with the
// 0.6 ratio kept against zero, flipped, half and 1.5x.
const WARP_RATIO = 0.6;
const MOVED = 16;
/** The moving frame's turn of the fan, in fan pitches (W2L-I6: about 0.3, within the wrap). */
const STEP_PITCH = 0.3;
/** W2L-I6: the pixels the bound is judged on move at least this far, px. */
const MIN_MOVE_PX = 4;
/** D4-93: the forward-backward check, px (the vectors are 0.25 px steps, read at the nearest pixel). */
const CONSISTENT_PX = 1;

/** Mean warp errors /255 with the encoded vector times 1, 0, -1, 0.5 and 1.5, over n pixels. */
interface WarpErrors {
  readonly n: number;
  readonly shipped: number;
  readonly zero: number;
  readonly flipped: number;
  readonly half: number;
  readonly oneAndHalf: number;
}

interface Warp {
  /** Every moved rotor pixel whose vector is not clipped, and those that move >= MIN_MOVE_PX. */
  readonly all: WarpErrors;
  readonly fast: WarpErrors;
  readonly clipped: number;
  /** Moved pixels that fail the forward-backward check (disoccluded), left out of `fast`. */
  readonly occluded: number;
  /** |v| percentiles of every counted moved pixel, px. */
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
      // D4-93: the backward field at the earlier geometry, for the forward-backward check. The LP
      // spool's display is turned back two steps (lpPhase: a jump, not motion) while it turns one
      // step on, and its vectors are flipped, so this frame shows the earlier LP geometry with the
      // vectors that map it onto the later frame. (The HP rows are not turned back, so their
      // pixels fail the check and drop out: the close-up is the fan's.)
      const turn = ENGINE_DEFINITION.rotation.lp * STEP_PITCH * fanPitch;
      v.setDebugFlags({
        ...flags,
        lpPhase: -2 * turn,
        rotorMotionScale: -(flags.rotorMotionScale ?? 1),
      });
      const velBack = read(dt);
      v.setDebugFlags(still);
      await nextFrame();
      let clipped = 0;
      let occluded = 0;
      const speeds: number[] = [];
      const zeros = () => ({ n: 0, shipped: 0, zero: 0, flipped: 0, half: 0, oneAndHalf: 0 });
      const all = zeros();
      const fast = zeros();
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
          // D4-93: a disoccluded pixel (what it shows was hidden in the earlier frame) cannot be
          // predicted by any vector: the earlier frame at the source must be a rotor pixel whose
          // backward vector maps it back here, within CONSISTENT_PX
          const sx = Math.round(x - vx);
          const sy = Math.round(y - vy);
          const j = 4 * (Math.min(H - 1, Math.max(0, sy)) * W + Math.min(W - 1, Math.max(0, sx)));
          const br = velBack[j] ?? 0;
          const bg = velBack[j + 1] ?? 0;
          const consistent =
            sx >= 0 &&
            sx < W &&
            sy >= 0 &&
            sy < H &&
            (velBack[j + 2] ?? 0) >= 128 &&
            br !== 0 &&
            br !== 255 &&
            bg !== 0 &&
            bg !== 255 &&
            Math.hypot(vx + ((br - 127.5) / 255) * 64, vy - ((bg - 127.5) / 255) * 64) <=
              CONSISTENT_PX;
          if (!consistent) occluded++;
          const warp = (k: number) => Math.abs(now - lumAt(before, x - k * vx, y - k * vy));
          const speed = Math.hypot(vx, vy);
          speeds.push(speed);
          for (const e of speed >= MIN_MOVE_PX && consistent ? [all, fast] : [all]) {
            e.n++;
            e.shipped += warp(1);
            e.zero += still0;
            e.flipped += warp(-1);
            e.half += warp(0.5);
            e.oneAndHalf += warp(1.5);
          }
        }
      const mean = (e: ReturnType<typeof zeros>): WarpErrors => ({
        n: e.n,
        shipped: e.shipped / e.n,
        zero: e.zero / e.n,
        flipped: e.flipped / e.n,
        half: e.half / e.n,
        oneAndHalf: e.oneAndHalf / e.n,
      });
      return {
        all: mean(all),
        fast: mean(fast),
        clipped,
        occluded,
        p10: quantile(speeds, 0.1),
        p50: quantile(speeds, 0.5),
        p90: quantile(speeds, 0.9),
      };
    };
    // an empty set (the zero vector moves no pixel MIN_MOVE_PX) cannot pass
    const ok = (r: Warp) =>
      r.fast.n > 0 &&
      r.fast.shipped <=
        WARP_RATIO * Math.min(r.fast.zero, r.fast.flipped, r.fast.half, r.fast.oneAndHalf);
    const shipped = await measure({});
    const controls = {
      noRotorMotion: await measure({ noRotorMotion: true }),
      'rotorMotionScale -1': await measure({ rotorMotionScale: -1 }),
      'rotorMotionScale 0.5 (half length)': await measure({ rotorMotionScale: 0.5 }),
      'rotorMotionScale 1.5': await measure({ rotorMotionScale: 1.5 }),
    };
    const e = (w: WarpErrors) =>
      `${String(w.n)} px: ${w.shipped.toFixed(2)} (zero ${w.zero.toFixed(2)}, flipped ${w.flipped.toFixed(2)}, half ${w.half.toFixed(2)}, 1.5x ${w.oneAndHalf.toFixed(2)})`;
    const f = (r: Warp) =>
      `|v| >= ${String(MIN_MOVE_PX)} px ${e(r.fast)}; every moved px ${e(r.all)} /255; |v| p10/p50/p90 ${r.p10.toFixed(1)}/${r.p50.toFixed(1)}/${r.p90.toFixed(1)} px, ${String(r.clipped)} clipped left out, ${String(r.occluded)} disoccluded (the forward-backward check) left out of the bound`;
    const rows = [
      `step ${String(STEP_PITCH)} fan pitch per moving frame; warp error with the encoded vector (baselines)`,
      `shipped: ${f(shipped)}`,
      ...Object.entries(controls).map(([k, r]) => `control ${k}: ${f(r)}`),
    ];
    await commands.writeFile('test-results/rotorMotionWarp.txt', `${rows.join('\n')}\n`);
    console.warn(`W2L-I1 / W2L-I6 rotor motion warp\n${rows.join('\n')}`);
    expect(v.stats().errors).toEqual([]);
    expect(shipped.all.n, rows.join('\n')).toBeGreaterThan(5000);
    expect(shipped.fast.n, rows.join('\n')).toBeGreaterThan(1000);
    // W2L-I1's bound (zero, flipped), then W2L-I6's baselines (half, 1.5x), apart so a failure
    // names the one it misses; together they are ok()
    const ratio = (a: number, b: number) => shipped.fast.shipped / (WARP_RATIO * Math.min(a, b));
    expect(ratio(shipped.fast.zero, shipped.fast.flipped), rows.join('\n')).toBeLessThanOrEqual(1);
    expect(ratio(shipped.fast.half, shipped.fast.oneAndHalf), rows.join('\n')).toBeLessThanOrEqual(
      1,
    );
    expect(ok(shipped), rows.join('\n')).toBe(true);
    for (const [k, r] of Object.entries(controls))
      expect(ok(r), `${k}\n${rows.join('\n')}`).toBe(false);
  });
});
