import { describe, expect, it } from 'vitest';
import { revolveLoop, loopAreaCentroid } from '../../../src/geometry/revolve';
import { capMesh, triangulateLoop } from '../../../src/geometry/cap';
import { meshTopology } from '../../../src/geometry/mesh';
import type { P2 } from '../../../src/geometry/profile';

const square: P2[] = [
  { x: 0, r: 1 },
  { x: 1, r: 1 },
  { x: 1, r: 2 },
  { x: 0, r: 2 },
];
/** A cone on the axis: nose, base edge, back on the axis (the axis segment is not a surface). */
const cone: P2[] = [
  { x: 0, r: 0 },
  { x: 1, r: 0.5 },
  { x: 1, r: 0 },
];
const pappus = (loop: P2[]) => {
  const { area, centroid } = loopAreaCentroid(loop);
  // the sign of the area follows the loop orientation; the volume of the solid does not
  return Math.abs(2 * Math.PI * area * centroid.r);
};

describe('revolveLoop', () => {
  it('a revolved square is a closed, outward tube with the Pappus volume', () => {
    const m = revolveLoop(square, { segments: 96 });
    const t = meshTopology(m);
    expect(t.boundaryEdges).toBe(0);
    expect(t.nonManifoldEdges).toBe(0);
    expect(t.misorientedEdges).toBe(0);
    expect(t.degenerateTriangles).toBe(0);
    // inscribed polygon: volume short by about (2 pi / S)^2 / 6
    expect(t.signedVolume / pappus(square)).toBeCloseTo(1, 2);
    expect(t.signedVolume).toBeGreaterThan(0);
  });

  it('either loop orientation gives an outward surface', () => {
    const t = meshTopology(revolveLoop([...square].reverse(), { segments: 32 }));
    expect(t.signedVolume).toBeGreaterThan(0);
    expect(t.misorientedEdges).toBe(0);
  });

  it('closes on the axis with poles and skips axis segments', () => {
    const m = revolveLoop(cone, { segments: 48 });
    const t = meshTopology(m);
    expect(t.boundaryEdges).toBe(0);
    expect(t.degenerateTriangles).toBe(0);
    expect(t.signedVolume / pappus(cone)).toBeCloseTo(1, 2);
  });

  it('splits normals at sharp corners and keeps them smooth elsewhere', () => {
    const m = revolveLoop(square, { segments: 8, sharpAngle: Math.PI / 6 });
    // 4 sharp corners, each duplicated: 8 profile nodes x 9 columns
    expect(m.positions.length / 3).toBe(8 * 9);
    const smooth = revolveLoop(square, { segments: 8, sharpAngle: Math.PI });
    expect(smooth.positions.length / 3).toBe(4 * 9);
    // normals are unit and the tangents run around the axis
    for (let v = 0; v < m.normals.length / 3; v++) {
      const n = Math.hypot(
        m.normals[3 * v] ?? 0,
        m.normals[3 * v + 1] ?? 0,
        m.normals[3 * v + 2] ?? 0,
      );
      expect(n).toBeCloseTo(1, 5);
      expect(m.tangents[4 * v] ?? 1).toBeCloseTo(0, 6);
    }
  });

  it('rejects too few segments or points', () => {
    expect(() => revolveLoop(square, { segments: 2 })).toThrow();
    expect(() => revolveLoop(square.slice(0, 2), { segments: 8 })).toThrow();
  });
});

describe('caps (the cutaway cross-section faces)', () => {
  const notched: P2[] = [
    { x: 0, r: 0 },
    { x: 3, r: 0 },
    { x: 3, r: 2 },
    { x: 2, r: 2 },
    { x: 2, r: 0.5 },
    { x: 1, r: 0.5 },
    { x: 1, r: 2 },
    { x: 0, r: 2 },
  ];

  it('triangulates a non-convex loop into n - 2 counter-clockwise triangles covering its area', () => {
    for (const loop of [square, notched, [...notched].reverse()]) {
      const tri = triangulateLoop(loop);
      expect(tri.length).toBe(3 * (loop.length - 2));
      let sum = 0;
      const ccw = loopAreaCentroid(loop).area > 0 ? loop : [...loop].reverse();
      for (let t = 0; t < tri.length; t += 3) {
        const a = ccw[tri[t] ?? 0];
        const b = ccw[tri[t + 1] ?? 0];
        const c = ccw[tri[t + 2] ?? 0];
        if (a === undefined || b === undefined || c === undefined) throw new Error('index');
        const area = ((b.x - a.x) * (c.r - a.r) - (b.r - a.r) * (c.x - a.x)) / 2;
        expect(area).toBeGreaterThan(0);
        sum += area;
      }
      expect(sum).toBeCloseTo(Math.abs(loopAreaCentroid(loop).area), 12);
    }
  });

  it('a cap lies in the meridional plane z = 0 and faces +z (the +theta side)', () => {
    const cap = capMesh(notched);
    for (let v = 0; v < cap.positions.length / 3; v++) {
      expect(cap.positions[3 * v + 2]).toBe(0);
      expect(cap.normals[3 * v + 2]).toBe(1);
    }
    const t = meshTopology(cap);
    expect(t.boundaryEdges).toBe(notched.length);
    expect(t.degenerateTriangles).toBe(0);
  });

  it('still returns n - 2 triangles for a degenerate (zero-area) loop', () => {
    const flat: P2[] = [
      { x: 0, r: 1 },
      { x: 1, r: 1 },
      { x: 2, r: 1 },
      { x: 3, r: 1 },
    ];
    expect(triangulateLoop(flat).length).toBe(6);
  });

  it('rejects a loop with fewer than three points', () => {
    expect(() => triangulateLoop(square.slice(0, 2))).toThrow();
  });
});
