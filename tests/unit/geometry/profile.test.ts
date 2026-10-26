import { describe, expect, it } from 'vitest';
import { catmullRom, maxRadialDeviation, WallCurve } from '../../../src/geometry/profile';
import { componentWalls, engineWalls } from '../../../src/geometry/walls';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';
import { radiusAt, type CurveId } from '../../../src/contracts/engine';

describe('catmullRom', () => {
  const pts = [
    { x: 0, r: 0 },
    { x: 1, r: 1 },
    { x: 2, r: 0.5 },
    { x: 3, r: 2 },
  ];

  it('passes exactly through every control point', () => {
    const dense = catmullRom(pts, { samplesPerSegment: 8 });
    expect(dense.length).toBe(3 * 8 + 1);
    pts.forEach((p, i) => {
      expect(dense[i * 8]).toEqual(p);
    });
  });

  it('is C1: the chord direction turns smoothly at interior control points', () => {
    const dense = catmullRom(pts, { samplesPerSegment: 64 });
    const turn = (i: number) => {
      const a = dense[i - 1];
      const b = dense[i];
      const c = dense[i + 1];
      if (a === undefined || b === undefined || c === undefined) throw new Error('range');
      const t1 = Math.atan2(b.r - a.r, b.x - a.x);
      const t2 = Math.atan2(c.r - b.r, c.x - b.x);
      return Math.abs(t2 - t1);
    };
    // a polyline turns by tens of degrees at samples 64 and 128; the spline by about one step
    expect(turn(64)).toBeLessThan(0.05);
    expect(turn(128)).toBeLessThan(0.05);
  });

  it('uses phantom neighbours to set the end tangents', () => {
    const free = catmullRom(pts, { samplesPerSegment: 16 });
    const bent = catmullRom(pts, { samplesPerSegment: 16, before: { x: 1, r: -1 } });
    expect(bent[0]).toEqual(free[0]);
    expect(bent[16]).toEqual(free[16]);
    expect(bent[4]).not.toEqual(free[4]);
    expect(bent.slice(32)).toEqual(free.slice(32)); // only the first segment changes
    const tail = catmullRom(pts, { samplesPerSegment: 16, after: { x: 2, r: 9 } });
    expect(tail.slice(0, 33)).toEqual(free.slice(0, 33));
    expect(tail[44]).not.toEqual(free[44]);
  });

  it('draws a straight segment for two points', () => {
    const d = catmullRom(
      [
        { x: 0, r: 0 },
        { x: 2, r: 2 },
      ],
      { samplesPerSegment: 4 },
    );
    for (const p of d) expect(p.r).toBeCloseTo(p.x, 12);
  });

  it('rejects a curve with fewer than two points or a bad sample count', () => {
    expect(() => catmullRom([{ x: 0, r: 0 }], { samplesPerSegment: 4 })).toThrow();
    expect(() => catmullRom(pts, { samplesPerSegment: 0 })).toThrow();
  });
});

describe('WallCurve', () => {
  const w = new WallCurve([
    { x: 0, r: 1 },
    { x: 1, r: 2 },
    { x: 3, r: 0 },
  ]);
  it('interpolates linearly between its samples and clamps outside them', () => {
    expect(w.radiusAt(0.5)).toBeCloseTo(1.5, 12);
    expect(w.radiusAt(2)).toBeCloseTo(1, 12);
    expect(w.radiusAt(1)).toBe(2);
    expect(w.radiusAt(-1)).toBe(1);
    expect(w.radiusAt(9)).toBe(0);
    expect(w.xMin).toBe(0);
    expect(w.xMax).toBe(3);
  });
  it('rejects samples whose x does not increase strictly, and too few samples', () => {
    expect(
      () =>
        new WallCurve([
          { x: 0, r: 1 },
          { x: 0, r: 2 },
        ]),
    ).toThrow(/increase/);
    expect(() => new WallCurve([{ x: 0, r: 1 }])).toThrow();
  });
  it('measures the largest radial deviation from a reference', () => {
    expect(maxRadialDeviation(w.samples, () => 1)).toBe(1);
    expect(maxRadialDeviation(w.samples, (x) => (x > 2 ? null : 1))).toBe(1);
  });
});

describe('the engine walls (smoothed definition curves)', () => {
  const walls = engineWalls(def, 12);
  const curves = def.flowpath.curves;

  it('every wall is a function of x (strictly increasing samples)', () => {
    for (const w of Object.values(walls)) {
      for (let i = 1; i < w.samples.length; i++) {
        expect(w.samples[i]?.x ?? 0).toBeGreaterThan(w.samples[i - 1]?.x ?? Infinity);
      }
    }
  });

  it('passes through every definition point', () => {
    const check = (id: CurveId, wall: WallCurve) => {
      for (const p of curves[id].points) expect(wall.radiusAt(p.x)).toBeCloseTo(p.r, 9);
    };
    check('coreOuter', walls.coreOuter);
    check('coreCowl', walls.coreCowl);
    check('nacelleInner', walls.nacelleInner);
    check('nacelleOuter', walls.nacelleOuter);
    for (const id of ['spinner', 'coreInner', 'plug'] as const) check(id, walls.hub);
  });

  it('stays within a few mm of the definition polylines away from the rounded lips', () => {
    // the splitter and the highlight are rounded on purpose: skip the first 30 mm there
    const dev = (id: CurveId, wall: WallCurve, skip = 0) =>
      maxRadialDeviation(
        wall.samples.filter((p) => p.x > (curves[id].points[0]?.x ?? 0) + skip),
        (x) => radiusAt(curves[id], x),
      );
    expect(dev('coreOuter', walls.coreOuter, 0.03)).toBeLessThan(0.003);
    expect(dev('coreCowl', walls.coreCowl, 0.03)).toBeLessThan(0.003);
    expect(dev('nacelleInner', walls.nacelleInner, 0.03)).toBeLessThan(0.003);
    expect(dev('nacelleOuter', walls.nacelleOuter, 0.03)).toBeLessThan(0.006);
    expect(dev('coreInner', walls.hub)).toBeLessThan(0.003);
  });

  it('keeps every component annulus open (hub below casing)', () => {
    for (const c of def.flowpath.components) {
      const { hub, casing } = componentWalls(walls, c);
      for (let k = 0; k <= 50; k++) {
        const x = c.xStart + ((c.xEnd - c.xStart) * k) / 50;
        expect(casing.radiusAt(x)).toBeGreaterThan(hub.radiusAt(x));
      }
    }
  });

  it('is deterministic', () => {
    expect(engineWalls(def, 12).coreOuter.samples).toEqual(walls.coreOuter.samples);
  });
});
