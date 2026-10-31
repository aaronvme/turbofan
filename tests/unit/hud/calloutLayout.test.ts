// W2 app-ui round 4, D4-92 (zz): the callouts label their parts.
// - W2A-N13: the layout search places as many labels as a brute force over the same places.
// - The closed views' Fan callout points at the fan face, seen through the intake (else at the
//   intake lip), not at the nacelle skin.
// - The cut views' anchors sit on the visible cut face (the bypass duct's in the duct), and their
//   labels go outward, above and below the engine, in the parts' axial order, with no leader
//   crossing another.
// - Schlieren's framing: the content box fitted into the free area between the panels.
import { describe, expect, it } from 'vitest';
import { radiusAt } from '../../../src/contracts/engine';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import {
  calloutGeometry,
  calloutPoint,
  componentAnchors,
  engineRings,
  screenBox,
  seenThroughIntake,
  type CalloutView,
} from '../../../src/hud/anchors';
import {
  fitViewOffset,
  layoutAxial,
  layoutCallouts,
  leaderCrossings,
  overlaps,
  type Rect,
} from '../../../src/hud/callouts';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { UI_LEVELS } from '../../../src/hud/uiLevels';
import { LOOK_PRESETS } from '../../../src/render/presets';
import {
  cutViewOrbit,
  framedOrbit,
  orbitFromPose,
  orbitPose,
  rowsInset,
  type OrbitState,
} from '../../../src/shell/orbit';

const OFFSETS = [
  [18, -34],
  [18, 14],
  [-18, -34],
  [-18, 14],
  [40, -62],
  [-40, -62],
  [40, 42],
  [-40, 42],
  [70, -10],
  [-70, -10],
  [60, -96],
  [-60, -96],
  [60, 76],
  [-60, 76],
  [110, -40],
  [-110, -40],
  [110, 20],
  [-110, 20],
] as const;

describe('W2A-N13: the search places the most labels', () => {
  it('never shows fewer labels than a brute force over the same places (critic 15 probe, 400 seeded cases)', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const size = { w: 140, h: 36 };
    const vp = { w: 420, h: 300 };
    let worse = 0;
    for (let c = 0; c < 400; c++) {
      const n = 3 + Math.floor(rnd() * 2);
      const anchors = Array.from({ length: n }, (_, i) => ({
        id: `a${String(i)}`,
        x: 60 + rnd() * 300,
        y: 40 + rnd() * 220,
        visible: true,
        priority: n - i,
      }));
      const got = layoutCallouts(anchors, () => size, vp);
      const cand = anchors.map((a) =>
        OFFSETS.map(([dx, dy]) => ({
          x: dx >= 0 ? a.x + dx : a.x + dx - size.w,
          y: a.y + dy,
          ...size,
        })).filter(
          (b) =>
            b.x >= 0 &&
            b.y >= 0 &&
            b.x + size.w <= vp.w &&
            b.y + size.h <= vp.h &&
            !anchors.some((o) => o !== a && overlaps(b, { x: o.x - 3, y: o.y - 3, w: 6, h: 6 })),
        ),
      );
      let most = 0;
      const placed: Rect[] = [];
      const dfs = (i: number, shown: number) => {
        if (i === n) {
          most = Math.max(most, shown);
          return;
        }
        for (const b of cand[i] ?? [])
          if (!placed.some((p) => overlaps(p, b, 4))) {
            placed.push(b);
            dfs(i + 1, shown + 1);
            placed.pop();
          }
        dfs(i + 1, shown);
      };
      dfs(0, 0);
      if (got.length < most) worse++;
    }
    expect(worse).toBe(0);
  });
});

const def = ENGINE_DEFINITION;
const geo = calloutGeometry(def);
const anchors = componentAnchors(def);
const fan = anchors.find((a) => a.id === 'fan');
const duct = anchors.find((a) => a.id === 'bypassDuct');
const threeQuarter: CalloutView = { eye: [-3.7, 0.75, 3.35], cutCenter: 0, cutHalf: 0 };

describe('the callouts point at their parts (D4-92 zz)', () => {
  it('the closed views anchor the Fan at the fan face, seen through the intake from the front', () => {
    if (fan === undefined) throw new Error('no fan anchor');
    const p = calloutPoint(fan, 'realistic', threeQuarter, geo);
    expect(p[0]).toBeCloseTo(geo.fanFaceX, 9);
    expect(seenThroughIntake(threeQuarter.eye, p, geo)).toBe(true);
    // round 3's point (the fan's mid-length on the camera's side) is not seen: it is behind the
    // nacelle skin
    const theta = Math.atan2(threeQuarter.eye[2], threeQuarter.eye[1]);
    const old: [number, number, number] = [fan.x, fan.r * Math.cos(theta), fan.r * Math.sin(theta)];
    expect(seenThroughIntake(threeQuarter.eye, old, geo)).toBe(false);
    expect(calloutPoint(fan, 'schlieren', threeQuarter, geo)).toEqual(p);
  });

  it('falls back to the intake lip when the fan face is not seen (a side or rear view)', () => {
    if (fan === undefined) throw new Error('no fan anchor');
    const side: CalloutView = { eye: [1.3, 0.2, 7.2], cutCenter: 0, cutHalf: 0 };
    const p = calloutPoint(fan, 'realistic', side, geo);
    expect(p[0]).toBeCloseTo(geo.lipX, 9);
    expect(Math.hypot(p[1], p[2])).toBeCloseTo(geo.lipR, 9);
    // on the camera's side of the axis
    expect(p[1] * side.eye[1] + p[2] * side.eye[2]).toBeGreaterThan(0);
  });

  it('the cut views anchor on the upper cut face, the bypass duct in the duct', () => {
    if (duct === undefined) throw new Error('no bypass duct anchor');
    const v: CalloutView = { eye: threeQuarter.eye, cutCenter: 1.35, cutHalf: 0.87 };
    const p = calloutPoint(duct, 'cutaway', v, geo);
    const theta = Math.atan2(p[2], p[1]);
    const faces = [v.cutCenter - v.cutHalf, v.cutCenter + v.cutHalf];
    const upper = faces.reduce((a, b) => (Math.cos(b) > Math.cos(a) ? b : a));
    expect(Math.cos(theta - upper)).toBeCloseTo(1, 9);
    const r = Math.hypot(p[1], p[2]);
    const cowl = radiusAt(def.flowpath.curves.coreCowl, p[0]) ?? NaN;
    const nacelle = radiusAt(def.flowpath.curves.nacelleInner, p[0]) ?? NaN;
    expect(r).toBeGreaterThan(cowl);
    expect(r).toBeLessThan(nacelle);
    expect(calloutPoint(duct, 'data', v, geo)).toEqual(p);
  });
});

describe('the cut views: labels outward in axial order (D4-92 zz)', () => {
  // eight anchors along a slanted core band, as the ¾ front cut view projects them
  const line = ['fan', 'booster', 'hpc', 'combustor', 'hpt', 'lpt', 'bypassDuct', 'exhaust'];
  const axial = [0.13, 0.45, 1.16, 1.6, 1.81, 2.17, 0.9, 2.56];
  const vp = { w: 1366, h: 768 };
  const band = { x: 380, y: 170, w: 640, h: 420 };
  const cut = line.map((id, i) => ({
    id,
    axial: axial[i] ?? 0,
    x: 420 + 220 * (axial[i] ?? 0),
    y: 470 - 50 * (axial[i] ?? 0),
    visible: true,
    priority: 10 - i,
  }));
  const size = () => ({ w: 128, h: 34 });
  const reserved: Rect[] = [
    { x: 0, y: 0, w: 1366, h: 46 },
    { x: 0, y: 46, w: 290, h: 600 },
    { x: 1066, y: 46, w: 300, h: 640 },
    { x: 0, y: 690, w: 1366, h: 78 },
  ];

  it('places every label above or below the engine, clear of the panels and of each other', () => {
    const placed = layoutAxial(cut, size, vp, reserved, band);
    expect(placed.map((p) => p.id).sort()).toEqual([...line].sort());
    for (const p of placed) {
      expect(p.box.y + p.box.h <= band.y || p.box.y >= band.y + band.h, p.id).toBe(true);
      for (const r of reserved) expect(overlaps(p.box, r), `${p.id} on a panel`).toBe(false);
      for (const q of placed) if (q !== p) expect(overlaps(p.box, q.box, 4)).toBe(false);
    }
    expect(leaderCrossings(placed)).toBe(0);
  });

  it('keeps the parts’ axial order left to right in each row', () => {
    const placed = layoutAxial(cut, size, vp, reserved, band);
    for (const above of [true, false]) {
      const row = placed
        .filter((p) => p.box.y < band.y === above)
        .map((p) => ({ x: p.box.x, axial: cut.find((c) => c.id === p.id)?.axial ?? 0 }));
      const byX = [...row].sort((a, b) => a.x - b.x).map((r) => r.axial);
      expect(byX).toEqual([...byX].sort((a, b) => a - b));
    }
  });

  it('D4-97 item 2: a label with no room in its row is hidden, by priority (fan, combustor, HPT, LPT, exhaust first), never placed off its row', () => {
    // the top row's room taken by a panel: only the bottom row is left
    const tight: Rect[] = [...reserved, { x: 290, y: 46, w: 776, h: 120 }];
    const prio = componentAnchors(def);
    const ranked = cut.map((c) => ({
      ...c,
      priority: prio.find((a) => a.id === c.id)?.priority ?? 0,
    }));
    const placed = layoutAxial(ranked, size, vp, tight, band);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(cut.length);
    for (const p of placed) {
      for (const r of tight) expect(overlaps(p.box, r)).toBe(false);
      // in a row: clear of the engine's box, above or below it
      expect(p.box.y + p.box.h <= band.y || p.box.y >= band.y + band.h, p.id).toBe(true);
    }
    for (const p of placed)
      for (const q of placed) if (q !== p) expect(overlaps(p.box, q.box, 4)).toBe(false);
  });

  it('D4-97 item 2: the stated priority is fan, combustor, HPT, LPT, exhaust, then HPC, booster, bypass duct', () => {
    const byPriority = [...componentAnchors(def)]
      .sort((a, b) => b.priority - a.priority)
      .map((a) => a.id);
    expect(byPriority).toEqual([
      'fan',
      'combustor',
      'hpt',
      'lpt',
      'exhaust',
      'hpc',
      'booster',
      'bypassDuct',
    ]);
  });

  it('round 5: a part under a panel (the open drawer) is not called out, in either layout', () => {
    // the drawer over the view's right: the exhaust's and the LPT's anchors are under it
    const drawer: Rect = { x: 870, y: 46, w: 196, h: 600 };
    const covered = cut.filter((a) => a.x >= drawer.x).map((a) => a.id);
    expect(covered.sort()).toEqual(['exhaust', 'lpt']);
    const withDrawer = [...reserved, drawer];
    for (const placed of [
      layoutAxial(cut, size, vp, withDrawer, band),
      layoutCallouts(cut, size, vp, withDrawer),
    ]) {
      const ids = placed.map((p) => p.id);
      for (const id of covered) expect(ids, id).not.toContain(id);
      expect(ids.length).toBeGreaterThan(0);
    }
  });
});

describe('D4-97 item 2 (W2A-I8) and W2A-N25: the framings, checked by projecting the engine after the orbit', () => {
  // the app's default view (the ¾ front preset), its camera as the worker poses it
  const preset = LOOK_PRESETS.threeQuarterFront;
  const boxAt = (o: OrbitState, canvas: { w: number; h: number }, xEnd: number) => {
    const cam = new PerspectiveCamera(preset.fovDeg, canvas.w / canvas.h, 0.05, 200);
    const pose = orbitPose(o);
    cam.position.set(...pose.position);
    cam.lookAt(new Vector3(...pose.target));
    cam.updateMatrixWorld();
    const m = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    return screenBox(m.elements, engineRings(def, xEnd), canvas.w, canvas.h);
  };
  // the free area above the dock, as the app's overlay posts it (its centre column at both sizes)
  const sizes = [
    { canvas: { w: 1366, h: 768 }, rows: { x: 288, y: 60, w: 766, h: 470 } },
    { canvas: { w: 1920, h: 1001 }, rows: { x: 333, y: 60, w: 1234, h: 690 } },
  ];
  const start = orbitFromPose(preset.camera, preset.target);

  for (const { canvas, rows } of sizes)
    it(`at ${String(canvas.w)} x ${String(canvas.h)} the cut views leave a label row above and below the engine (or stop at the minimum scale)`, () => {
      const o = cutViewOrbit(start, (q) => boxAt(q, canvas, 2.75), canvas, rows, preset.fovDeg);
      const box = boxAt(o, canvas, 2.75);
      if (box === null) throw new Error('the engine is off screen');
      const scale = start.distance / o.distance;
      expect(scale).toBeLessThanOrEqual(1);
      expect(scale).toBeGreaterThanOrEqual(UI_LEVELS.cutViewMinScale - 1e-9);
      const inset = rowsInset(rows, UI_LEVELS.calloutRowPx);
      // inside the area less a row above and below (2 px for the re-projection's residual)
      const fits =
        box.y >= inset.y - 2 &&
        box.y + box.h <= inset.y + inset.h + 2 &&
        box.x >= inset.x - 2 &&
        box.x + box.w <= inset.x + inset.w + 2;
      expect(
        fits || scale <= UI_LEVELS.cutViewMinScale + 1e-9,
        JSON.stringify({ box, inset, scale }),
      ).toBe(true);
    });

  it('Schlieren: framedOrbit brings the engine and its jet into the free area (W2A-N25)', () => {
    const canvas = { w: 1366, h: 768 };
    const free = { x: 288, y: 60, w: 766, h: 590 };
    const box0 = boxAt(start, canvas, 6);
    if (box0 === null) throw new Error('the engine is off screen');
    const o = framedOrbit(start, box0, canvas, free, preset.fovDeg, 0.6);
    const box = boxAt(o, canvas, 6);
    if (box === null) throw new Error('the engine is off screen');
    // centred in the free area to within a tenth of its size (one pass, perspective's residual)
    expect(Math.abs(box.x + box.w / 2 - (free.x + free.w / 2))).toBeLessThan(0.1 * free.w);
    expect(Math.abs(box.y + box.h / 2 - (free.y + free.h / 2))).toBeLessThan(0.1 * free.h);
    expect(box.w).toBeLessThan(box0.w);
  });
});

describe('Schlieren framing: the content fitted into the free area (D4-92 zz)', () => {
  const canvas = { w: 1920, h: 1001 };
  const free: Rect = { x: 330, y: 60, w: 1240, h: 820 };
  const map = (o: ReturnType<typeof fitViewOffset>, u: number, v: number): [number, number] => [
    ((u - o.x) * canvas.w) / o.w,
    ((v - o.y) * canvas.h) / o.h,
  ];

  it('moves and, if it must, zooms out the view so the box (the engine and its plume) is inside the free area', () => {
    const box: Rect = { x: 370, y: 110, w: 1400, h: 760 };
    const o = fitViewOffset(box, canvas, free, 0.6);
    expect(o.fullW).toBe(canvas.w);
    expect(o.fullH).toBe(canvas.h);
    const [x0, y0] = map(o, box.x, box.y);
    const [x1, y1] = map(o, box.x + box.w, box.y + box.h);
    expect(x0).toBeGreaterThanOrEqual(free.x - 1e-9);
    expect(x1).toBeLessThanOrEqual(free.x + free.w + 1e-9);
    expect(y0).toBeGreaterThanOrEqual(free.y - 1e-9);
    expect(y1).toBeLessThanOrEqual(free.y + free.h + 1e-9);
    // centred in the free area
    expect((x0 + x1) / 2).toBeCloseTo(free.x + free.w / 2, 6);
  });

  it('does not zoom in a box that fits, and stops zooming out at the limit', () => {
    const small: Rect = { x: 600, y: 300, w: 400, h: 200 };
    const o = fitViewOffset(small, canvas, free, 0.6);
    expect(o.w).toBeCloseTo(canvas.w, 9);
    const huge: Rect = { x: -2000, y: -1000, w: 6000, h: 3000 };
    expect(fitViewOffset(huge, canvas, free, 0.6).w).toBeCloseTo(canvas.w / 0.6, 9);
  });
});

describe('the engine on screen, and the Schlieren orbit (D4-92 zz)', () => {
  it('engineRings span the intake to the given end, and screenBox bounds what is in view', () => {
    const rings = engineRings(def, 5);
    const xs = rings.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(geo.lipX, 9);
    expect(Math.max(...xs)).toBeCloseTo(5, 9);
    // an identity view-projection: the world's [-1, 1] square is the screen
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const b = screenBox(
      m,
      [
        [-0.5, 0.5, 0],
        [0.5, -0.5, 0],
        [9, 9, 0],
      ],
      200,
      100,
    );
    expect(b).toEqual({ x: 50, y: 25, w: 100, h: 50 });
    expect(screenBox(m, [[9, 9, 0]], 200, 100)).toBeNull();
  });

  it('framedOrbit dollies out to fit and pans the box toward the free area, and leaves a fitting, centred box alone', () => {
    const o = { target: [1, 0, 0] as const, azimuth: -0.8, elevation: 0.2, distance: 5 };
    const canvas = { w: 1920, h: 1000 };
    const free: Rect = { x: 360, y: 100, w: 1200, h: 800 };
    const centred: Rect = { x: 760, y: 300, w: 400, h: 400 };
    expect(framedOrbit(o, centred, canvas, free, 30, 0.6)).toEqual(o);
    const wide: Rect = { x: 400, y: 200, w: 1600, h: 600 };
    const f = framedOrbit(o, wide, canvas, free, 30, 0.6);
    expect(f.distance).toBeCloseTo(5 / (1200 / 1600), 9);
    expect(f.azimuth).toBe(o.azimuth);
    expect(f.target).not.toEqual(o.target);
  });
});
