import { describe, expect, it } from 'vitest';
import {
  distanceToPolyline,
  maxDistanceToPolyline,
  maxRadialDeviation,
  monotoneInX,
  roundedPolyline,
  WallCurve,
} from '../../../src/geometry/profile';
import {
  componentWalls,
  engineWalls,
  WALL_BLEND,
  type EngineWall,
} from '../../../src/geometry/walls';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';
import type { CurveId } from '../../../src/contracts/engine';

describe('roundedPolyline', () => {
  const pts = [
    { x: 0, r: 0 },
    { x: 1, r: 1 },
    { x: 2, r: 0.5 },
    { x: 3, r: 2 },
  ];
  const o = { blend: 0.2, samplesPerFillet: 8 };

  it('starts and ends on the end points and stays on each segment between the fillets', () => {
    const d = roundedPolyline(pts, o);
    expect(d[0]).toEqual(pts[0]);
    expect(d[d.length - 1]).toEqual(pts[3]);
    // the segment midpoints are untouched: the polyline itself
    const ref = (x: number) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a !== undefined && b !== undefined && x >= a.x && x <= b.x)
          return a.r + ((x - a.x) * (b.r - a.r)) / (b.x - a.x);
      }
      return null;
    };
    const wall = new WallCurve(d);
    for (const x of [0.5, 1.5, 2.5]) expect(wall.radiusAt(x)).toBeCloseTo(ref(x) ?? Number.NaN, 12);
    // and never further from the polyline than the fillet sag d sin(turn / 2) / 2
    expect(maxRadialDeviation(d, ref)).toBeLessThan(0.2);
  });

  it('is C1: no sample turns much more than its neighbours', () => {
    const d = roundedPolyline(pts, { blend: 0.3, samplesPerFillet: 32 });
    const turns: number[] = [];
    for (let i = 1; i + 1 < d.length; i++) {
      const a = d[i - 1];
      const b = d[i];
      const c = d[i + 1];
      if (a === undefined || b === undefined || c === undefined) continue;
      const t1 = Math.atan2(b.r - a.r, b.x - a.x);
      const t2 = Math.atan2(c.r - b.r, c.x - b.x);
      turns.push(Math.abs(t2 - t1));
    }
    // a polyline would turn by 0.6-1.0 rad at once; the fillets spread it over 32 samples
    expect(Math.max(...turns)).toBeLessThan(0.08);
  });

  it('a phantom neighbour rounds the end and starts the curve at the fillet apex', () => {
    const free = roundedPolyline(pts, o);
    const lip = roundedPolyline(pts, { ...o, before: { x: 1, r: -1 } });
    const other = roundedPolyline([pts[0] ?? { x: 0, r: 0 }, { x: 1, r: -1 }], {
      ...o,
      before: pts[1],
    });
    expect(lip[0]).not.toEqual(free[0]);
    expect(lip[0]?.x).toBeCloseTo(other[0]?.x ?? Number.NaN, 12);
    expect(lip[0]?.r).toBeCloseTo(other[0]?.r ?? Number.NaN, 12);
    expect(lip.slice(-12)).toEqual(free.slice(-12));
    const tail = roundedPolyline(pts, { ...o, after: { x: 4, r: 0 } });
    expect(tail[tail.length - 1]).not.toEqual(pts[3]);
  });

  it('keeps a two-point curve straight', () => {
    const d = roundedPolyline(
      [
        { x: 0, r: 0 },
        { x: 2, r: 2 },
      ],
      o,
    );
    expect(d).toEqual([
      { x: 0, r: 0 },
      { x: 2, r: 2 },
    ]);
  });

  it('rejects bad options', () => {
    expect(() => roundedPolyline([{ x: 0, r: 0 }], o)).toThrow();
    expect(() => roundedPolyline(pts, { ...o, samplesPerFillet: 1 })).toThrow();
    expect(() => roundedPolyline(pts, { ...o, blend: 0 })).toThrow();
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
  it('measures distances to a polyline', () => {
    const line = [
      { x: 0, r: 0 },
      { x: 1, r: 0 },
    ];
    expect(distanceToPolyline({ x: 0.5, r: 2 }, line)).toBe(2);
    expect(distanceToPolyline({ x: 2, r: 0 }, line)).toBe(1);
    expect(maxDistanceToPolyline([{ x: -3, r: 4 }], line)).toBe(5);
  });

  it('measures the largest radial deviation from a reference', () => {
    expect(
      monotoneInX([
        { x: 0, r: 0 },
        { x: -1, r: 1 },
        { x: 1, r: 1 },
      ]),
    ).toEqual([
      { x: 0, r: 0 },
      { x: 1, r: 1 },
    ]);
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

  it('is the definition polyline away from the vertices, and within 3 mm of every vertex', () => {
    const check = (id: CurveId, wall: EngineWall) => {
      const pts = curves[id].points;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p === undefined) continue;
        expect(distanceToPolyline(p, wall.path), `${id} point ${i}`).toBeLessThan(0.003);
        const q = pts[i + 1];
        // the middle of a segment longer than two fillet legs is the segment itself
        if (q !== undefined && Math.hypot(q.x - p.x, q.r - p.r) > 2 * WALL_BLEND + 1e-3) {
          const xm = (p.x + q.x) / 2;
          expect(wall.radiusAt(xm)).toBeCloseTo((p.r + q.r) / 2, 9);
        }
      }
    };
    check('coreOuter', walls.coreOuter);
    check('coreCowl', walls.coreCowl);
    check('nacelleInner', walls.nacelleInner);
    check('nacelleOuter', walls.nacelleOuter);
    for (const id of ['spinner', 'coreInner', 'plug'] as const) check(id, walls.hub);
  });

  it('stays within 3 mm of the definition polylines everywhere', () => {
    const dev = (id: CurveId, wall: EngineWall) =>
      maxDistanceToPolyline(wall.path, curves[id].points);
    expect(dev('coreOuter', walls.coreOuter)).toBeLessThan(0.003);
    expect(dev('coreCowl', walls.coreCowl)).toBeLessThan(0.003);
    expect(dev('nacelleInner', walls.nacelleInner)).toBeLessThan(0.003);
    expect(dev('nacelleOuter', walls.nacelleOuter)).toBeLessThan(0.003);
    const hubLine = [...curves.spinner.points, ...curves.coreInner.points, ...curves.plug.points];
    expect(maxDistanceToPolyline(walls.hub.path, hubLine)).toBeLessThan(0.003);
  });

  it('keeps the whole lip path (which may turn back in x) and a monotone wall from it', () => {
    expect(walls.nacelleOuter.path.length).toBeGreaterThanOrEqual(
      walls.nacelleOuter.samples.length,
    );
    expect(monotoneInX(walls.nacelleOuter.path)).toEqual(walls.nacelleOuter.samples);
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
