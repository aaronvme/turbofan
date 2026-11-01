// W2 app-ui round 4, D4-92 (zz): the callouts label their parts.
// - W2A-N13: the layout search places as many labels as a brute force over the same places.
// - The closed views' Fan callout points at the fan face, seen through the intake (else at the
//   intake lip), not at the nacelle skin.
// - The cut views' anchors sit on the visible cut face (the bypass duct's in the duct), and their
//   labels go outward, above and below the engine, in the parts' axial order, with no leader
//   crossing another.
// - Schlieren's framing: the content box fitted into the free area between the panels.
// - Round 7 (critic 17's visual notes): Schlieren and Exploded framed with a margin inside the
//   free area above the dock (Schlieren touched the left column at 1920; Exploded, unframed, ran
//   under the right column).
import { describe, expect, it } from 'vitest';
import { radiusAt } from '../../../src/contracts/engine';
import { FIELD_EXTENTS } from '../../../src/contracts/flow';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import {
  calloutGeometry,
  calloutPoint,
  componentAnchors,
  engineRings,
  explodedRings,
  jetRings,
  projectPoint,
  screenBox,
  seenThroughIntake,
  type CalloutView,
} from '../../../src/hud/anchors';
import {
  layoutAxial,
  layoutCallouts,
  leaderCrossings,
  leaderEnd,
  overlaps,
  type Rect,
} from '../../../src/hud/callouts';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { UI_LEVELS } from '../../../src/hud/uiLevels';
import { LOOK_PRESETS } from '../../../src/render/presets';
import { EXPLODE_GAP, explodeOffsets } from '../../../src/geometry/explode';
import { engineParts } from '../../../src/geometry/parts';
import { engineWalls } from '../../../src/geometry/walls';
import {
  FRAME_MARGIN_PX,
  FRAMED_MIN_SCALE,
  cutViewOrbit,
  fitOrbit,
  framedOrbit,
  inset,
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
  it('W2A-N21: a label with no crossing-free place may take any crossing place, not only the first (critic 17 probe, a dense case)', () => {
    // 5 anchors in 360 x 280, 140 x 36 labels: all five fit, but only with a label at a crossing
    // place other than its first (the first blocks a later label)
    const pts = [
      [244, 143],
      [133, 153],
      [247, 80],
      [66, 87],
      [181, 93],
    ] as const;
    const anchors = pts.map(([x, y], i) => ({
      id: `a${String(i)}`,
      x,
      y,
      visible: true,
      priority: pts.length - i,
    }));
    const got = layoutCallouts(anchors, () => ({ w: 140, h: 36 }), { w: 360, h: 280 });
    expect(got.map((p) => p.id).sort()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    for (const p of got)
      for (const q of got) if (p !== q) expect(overlaps(p.box, q.box, 4)).toBe(false);
  });

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
/**
 * W2A-I11: what the exploded view draws (engineView.ts hides the skins and the stand from explode
 * 0.02): every part that is not a skin and every blade row's edges, slid by its module's offset at
 * full explode, revolved (rings of 16).
 */
const EXPLODED_DRAWN: [number, number, number][] = (() => {
  const off = explodeOffsets(def, 1, EXPLODE_GAP);
  const out: [number, number, number][] = [];
  const ring = (x: number, r: number) => {
    for (let j = 0; j < 16; j++) {
      const t = (2 * Math.PI * j) / 16;
      out.push([x, r * Math.cos(t), r * Math.sin(t)]);
    }
  };
  for (const p of engineParts(def, engineWalls(def, 3))) {
    if (p.skin) continue;
    const dx = p.module === null ? 0 : off[p.module];
    for (const q of p.loop) ring(q.x + dx, Math.abs(q.r));
  }
  for (const row of def.bladeRows)
    for (const e of [row.leadingEdge, row.trailingEdge])
      for (const q of [e.hub, e.tip]) ring(q.x + off[row.component], q.r);
  return out;
})();

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

describe('round 7: the cut views at 1366, the drawer open or not (critic 17: the long leader)', () => {
  // the app's own layout inputs, measured in Chrome (Data at 1366 x 768, round 7's diagnostic):
  // the engine box at the minimum scale, the eight anchors, the labels as drawn, the panels
  const vp = { w: 1366, h: 768 };
  const band = { x: 440.1, y: 100.9, w: 461.8, h: 352.2 };
  const at: [string, number, number, number, number][] = [
    ['fan', 676, 205, 9, 0.13],
    ['bypassDuct', 756, 190, 2, 0.9],
    ['booster', 696, 225, 3, 0.45],
    ['hpc', 753, 235, 4, 1.16],
    ['combustor', 792, 229, 8, 1.6],
    ['hpt', 809, 226, 7, 1.81],
    ['lpt', 840, 218, 6, 2.17],
    ['exhaust', 867, 217, 5, 2.56],
  ];
  const anchors = at.map(([id, x, y, priority, axial]) => ({
    id,
    x,
    y,
    priority,
    axial,
    visible: true,
  }));
  const widths: Record<string, number> = {
    fan: 71,
    bypassDuct: 93,
    booster: 91,
    hpc: 139,
    combustor: 67,
    hpt: 119,
    lpt: 115,
    exhaust: 76,
  };
  const size = (id: string) => ({ w: widths[id] ?? 128, h: 37 });
  const topbar = { x: 8, y: 8, w: 1350, h: 44 };
  const dock = { x: 411, y: 517, w: 520, h: 133 };
  const reserved: Rect[] = [
    topbar,
    { x: 8, y: 60, w: 272, h: 229 },
    { x: 8, y: 297, w: 272, h: 276 },
    // the annunciators with none lit: an empty box
    { x: 671, y: 60, w: 0, h: 0 },
    dock,
    { x: 1062, y: 60, w: 296, h: 31 },
    { x: 1062, y: 99, w: 296, h: 391 },
    { x: 1062, y: 498, w: 296, h: 194 },
    { x: 8, y: 658, w: 1046, h: 102 },
  ];
  const drawer: Rect[] = [
    { x: 694, y: 68, w: 350, h: 665 },
    { x: 694, y: 741, w: 350, h: 584 },
  ];
  const leader = (p: { anchor: { x: number; y: number }; box: Rect }) => {
    const e = leaderEnd(p.anchor, p.box);
    return Math.hypot(e.x - p.anchor.x, e.y - p.anchor.y);
  };
  const inRow = (b: Rect) => b.y + b.h <= band.y || b.y >= band.y + band.h;

  it('closed: all eight labelled in their rows, under the top bar (inset 8 px from the edge) and over the dock', () => {
    const placed = layoutAxial(anchors, size, vp, reserved, band);
    expect(placed.map((p) => p.id).sort()).toEqual(at.map((a) => a[0]).sort());
    for (const p of placed) {
      expect(inRow(p.box), p.id).toBe(true);
      for (const r of reserved.filter((q) => q.w > 0 && q.h > 0))
        expect(overlaps(p.box, r), `${p.id} on ${JSON.stringify(r)}`).toBe(false);
    }
    expect(leaderCrossings(placed)).toBe(0);
  });

  it('the drawer open: the fan, the one part left of it, labelled in the row above with a short leader', () => {
    const placed = layoutAxial(anchors, size, vp, [...reserved, ...drawer], band);
    expect(placed.map((p) => p.id)).toEqual(['fan']);
    const fan = placed[0];
    if (fan === undefined) throw new Error('no fan');
    expect(fan.box.y + fan.box.h).toBeLessThanOrEqual(band.y);
    for (const r of [...reserved, ...drawer].filter((q) => q.w > 0 && q.h > 0))
      expect(overlaps(fan.box, r), JSON.stringify(r)).toBe(false);
    // round 6's shot: in the row below, a 265 px leader across the section
    expect(leader(fan)).toBeLessThan(130);
  });

  it('an empty reserved box (an annunciator strip with nothing lit) constrains nothing', () => {
    const without = reserved.filter((r) => r.w > 0 && r.h > 0);
    expect(layoutAxial(anchors, size, vp, reserved, band)).toEqual(
      layoutAxial(anchors, size, vp, without, band),
    );
    // the fan's label over its anchor, not pushed right of the empty box at x = 671
    const fan = layoutAxial(anchors, size, vp, reserved, band).find((p) => p.id === 'fan');
    expect(fan?.box.x ?? Infinity).toBeLessThan(671 - 10);
  });

  it('two equal layouts: the one with the shorter leaders wins (the nearer row)', () => {
    const one = [{ id: 'fan', x: 600, y: 470, priority: 9, axial: 0.1, visible: true }];
    const b = { x: 400, y: 200, w: 400, h: 300 };
    const placed = layoutAxial(one, size, vp, [], b);
    expect(placed).toHaveLength(1);
    // the anchor is near the box's bottom: the row below
    expect(placed[0]?.box.y).toBeGreaterThanOrEqual(b.y + b.h);
  });
});

describe('D4-97 item 2 (W2A-I8) and W2A-N25: the framings, checked by projecting the engine after the orbit', () => {
  // the app's default view (the ¾ front preset), its camera as the worker poses it
  const preset = LOOK_PRESETS.threeQuarterFront;
  const ringsBoxAt = (
    o: OrbitState,
    canvas: { w: number; h: number },
    rings: readonly (readonly [number, number, number])[],
  ) => {
    const cam = new PerspectiveCamera(preset.fovDeg, canvas.w / canvas.h, 0.05, 200);
    const pose = orbitPose(o);
    cam.position.set(...pose.position);
    cam.lookAt(new Vector3(...pose.target));
    cam.updateMatrixWorld();
    const m = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    return screenBox(m.elements, rings, canvas.w, canvas.h);
  };
  const boxAt = (o: OrbitState, canvas: { w: number; h: number }, xEnd: number) =>
    ringsBoxAt(o, canvas, engineRings(def, xEnd));
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

  // round 7: Schlieren (the engine and its near-field jet) and Exploded (the modules slid apart)
  // inside the free area above the dock less FRAME_MARGIN_PX on every side, at both sizes
  for (const [name, rings] of [
    ['Schlieren', engineRings(def, FIELD_EXTENTS.near.xMax)],
    ['Exploded', explodedRings(def, EXPLODE_GAP)],
  ] as const)
    for (const { canvas, rows } of sizes)
      it(`${name} at ${String(canvas.w)} x ${String(canvas.h)}: framed inside the area above the dock with a ${String(FRAME_MARGIN_PX)} px margin`, () => {
        const area = inset(rows, FRAME_MARGIN_PX);
        const project = (q: OrbitState) => ringsBoxAt(q, canvas, rings);
        const o = fitOrbit(start, project, canvas, area, preset.fovDeg, FRAMED_MIN_SCALE);
        const box = project(o);
        if (box === null) throw new Error('off screen');
        const scale = start.distance / o.distance;
        expect(scale).toBeLessThanOrEqual(1);
        expect(scale).toBeGreaterThanOrEqual(FRAMED_MIN_SCALE - 1e-9);
        // inside the area (2 px for the re-projection's residual): the margin to every panel
        const r = { box, area, scale };
        expect(box.x, JSON.stringify(r)).toBeGreaterThanOrEqual(area.x - 2);
        expect(box.x + box.w, JSON.stringify(r)).toBeLessThanOrEqual(area.x + area.w + 2);
        expect(box.y, JSON.stringify(r)).toBeGreaterThanOrEqual(area.y - 2);
        expect(box.y + box.h, JSON.stringify(r)).toBeLessThanOrEqual(area.y + area.h + 2);
        // and fills it one way (framed, not shrunk past it): at least 0.9 of it across or down (each
        // pass's dolly estimate overshoots a little, and the fit never zooms back in)
        expect(box.w >= 0.9 * area.w || box.h >= 0.9 * area.h, JSON.stringify(r)).toBe(true);
      });

  // W2A-I11 (critic pass 18): Exploded's content is what the exploded view draws (every part that
  // is not a skin, every blade row, each slid by its module's offset). Framed on it, the drawn
  // parts' box is centred in the area: within 8 px each way at both sizes (the 3 re-projected
  // passes leave a few px; round 7's rings, the hidden inlet lip and bypass duct among them, left
  // 111 px on the left and 13 px on the right at 1366). Not only inside it: filling it one way.
  for (const { canvas, rows } of sizes)
    it(`W2A-I11: Exploded at ${String(canvas.w)} x ${String(canvas.h)}: the drawn parts' box is centred in the area and fills it one way`, () => {
      const area = inset(rows, FRAME_MARGIN_PX);
      const rings = explodedRings(def, EXPLODE_GAP);
      const o = fitOrbit(
        start,
        (q) => ringsBoxAt(q, canvas, rings),
        canvas,
        area,
        preset.fovDeg,
        FRAMED_MIN_SCALE,
      );
      const box = ringsBoxAt(o, canvas, EXPLODED_DRAWN);
      if (box === null) throw new Error('off screen');
      const gaps = {
        left: box.x - area.x,
        right: area.x + area.w - (box.x + box.w),
        top: box.y - area.y,
        bottom: area.y + area.h - (box.y + box.h),
        scale: start.distance / o.distance,
      };
      const r = JSON.stringify(gaps);
      expect(Math.abs(gaps.left - gaps.right), r).toBeLessThanOrEqual(8);
      expect(Math.abs(gaps.top - gaps.bottom), r).toBeLessThanOrEqual(8);
      expect(Math.min(gaps.left, gaps.right, gaps.top, gaps.bottom), r).toBeGreaterThanOrEqual(-2);
      expect(box.w >= 0.9 * area.w || box.h >= 0.9 * area.h, r).toBe(true);
    });

  // Critic pass 18's visual note 2: in Schlieren the Core exhaust label sat on the jet. The jet
  // (jetRings: the core jet's tube from the nozzle to the near field's end) is a box the labels
  // keep clear of; its anchor stays callable. At both sizes, framed as the worker frames Schlieren
  for (const { canvas, rows } of sizes)
    it(`Schlieren at ${String(canvas.w)} x ${String(canvas.h)}: the Core exhaust label is placed off the jet`, () => {
      const area = inset(rows, FRAME_MARGIN_PX);
      const content = engineRings(def, FIELD_EXTENTS.near.xMax);
      const o = fitOrbit(
        start,
        (q) => ringsBoxAt(q, canvas, content),
        canvas,
        area,
        preset.fovDeg,
        FRAMED_MIN_SCALE,
      );
      const cam = new PerspectiveCamera(preset.fovDeg, canvas.w / canvas.h, 0.05, 200);
      const pose = orbitPose(o);
      cam.position.set(...pose.position);
      cam.lookAt(new Vector3(...pose.target));
      cam.updateMatrixWorld();
      const m = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const jet = screenBox(m.elements, jetRings(def, FIELD_EXTENTS.near.xMax), canvas.w, canvas.h);
      if (jet === null) throw new Error('the jet is off screen');
      const view: CalloutView = { eye: pose.position, cutCenter: 0, cutHalf: 0 };
      const anchors = componentAnchors(def)
        .filter((a) => a.id === 'fan' || a.id === 'exhaust')
        .map((a) => {
          const p = projectPoint(
            m.elements,
            calloutPoint(a, 'schlieren', view, geo),
            canvas.w,
            canvas.h,
          );
          return { id: a.id, x: p.x, y: p.y, visible: p.visible, priority: a.priority };
        });
      // the panels round the area (the top bar, the columns and the dock) are reserved
      const panels: Rect[] = [
        { x: 0, y: 0, w: canvas.w, h: rows.y - 8 },
        { x: 0, y: rows.y, w: rows.x - 8, h: canvas.h - rows.y },
        {
          x: rows.x + rows.w + 8,
          y: rows.y,
          w: canvas.w - rows.x - rows.w - 8,
          h: canvas.h - rows.y,
        },
        { x: rows.x, y: rows.y + rows.h + 8, w: rows.w, h: canvas.h - rows.y - rows.h - 8 },
      ];
      const placed = layoutCallouts(
        anchors,
        () => ({ w: 132, h: 34 }),
        { w: canvas.w, h: canvas.h },
        panels,
        () => [],
        false,
        [jet],
      );
      const exhaust = placed.find((p) => p.id === 'exhaust');
      const r = JSON.stringify({ jet, placed });
      expect(exhaust, r).toBeDefined();
      expect(overlaps(exhaust?.box ?? jet, jet), r).toBe(false);
      expect(
        placed.find((p) => p.id === 'fan'),
        r,
      ).toBeDefined();
    });

  it('inset takes a margin off every side', () => {
    expect(inset({ x: 100, y: 50, w: 400, h: 300 }, 24)).toEqual({ x: 124, y: 74, w: 352, h: 252 });
    expect(inset({ x: 0, y: 0, w: 30, h: 30 }, 24)).toEqual({ x: 24, y: 24, w: 1, h: 1 });
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

describe('W2A-I11: the exploded engine on screen is what the view draws (Exploded framing)', () => {
  it('explodedRings are the drawn parts slid apart: the fan case at the front, no skin', () => {
    const off = explodeOffsets(def, 1, EXPLODE_GAP);
    const rings = explodedRings(def, EXPLODE_GAP);
    const xs = rings.map((p) => p[0]);
    const drawnXs = EXPLODED_DRAWN.map((p) => p[0]);
    const radius = (pts: readonly (readonly [number, number, number])[]) =>
      Math.max(...pts.map((p) => Math.hypot(p[1], p[2])));
    expect(Math.min(...xs)).toBeCloseTo(Math.min(...drawnXs), 9);
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...drawnXs), 9);
    expect(radius(rings)).toBeCloseTo(radius(EXPLODED_DRAWN), 9);
    // the intake's only drawn part is the fan case: its front, slid forward, is the engine's
    // front, not the inlet lip's (a skin, hidden), 0.72 m ahead of it
    const parts = engineParts(def, engineWalls(def, 3));
    const fanCase = parts.find((p) => p.id === 'fan-case');
    const lip = parts.find((p) => p.id === 'inlet-lip');
    if (fanCase === undefined || lip === undefined) throw new Error('no fan case or inlet lip');
    expect(fanCase.skin).toBe(false);
    expect(lip.skin).toBe(true);
    expect(Math.min(...xs)).toBeCloseTo(Math.min(...fanCase.loop.map((q) => q.x)) + off.inlet, 9);
    expect(Math.min(...xs)).toBeGreaterThan(
      Math.min(...lip.loop.map((q) => q.x)) + off.inlet + 0.5,
    );
    // no skin's radius: the nacelle skin (1.06 m) is hidden, the fan case (0.83 m) is the widest
    const skin = parts.find((p) => p.id === 'nacelle-skin');
    if (skin === undefined) throw new Error('no nacelle skin');
    expect(radius(rings)).toBeLessThan(Math.max(...skin.loop.map((q) => q.r)) - 0.1);
    // the gap is geometry/explode's, the one the view uses
    expect(EXPLODE_GAP).toBe(0.22);
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
