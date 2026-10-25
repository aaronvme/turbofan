import { describe, expect, it } from 'vitest';
import { Polyline, sampleFunction } from '../../../tools/mesh/curve';

describe('Polyline', () => {
  const line = new Polyline([
    { x: 0, r: 0 },
    { x: 3, r: 4 },
    { x: 6, r: 4 },
  ]);

  it('measures arc length and interpolates by it', () => {
    expect(line.length).toBeCloseTo(8, 12);
    expect(line.at(2.5)).toEqual({ x: 1.5, r: 2 });
    expect(line.at(6.5)).toEqual({ x: 4.5, r: 4 });
    expect(line.at(-1)).toEqual({ x: 0, r: 0 });
    expect(line.at(99)).toEqual({ x: 6, r: 4 });
  });

  it('gives unit tangents per segment', () => {
    const t = line.tangent(1);
    expect(t.x).toBeCloseTo(0.6, 12);
    expect(t.r).toBeCloseTo(0.8, 12);
    expect(line.tangent(7)).toEqual({ x: 1, r: 0 });
  });

  it('finds where it crosses an axial station', () => {
    expect(line.sAtX(1.5)).toBeCloseTo(2.5, 12);
    expect(line.atX(4.5).r).toBeCloseTo(4, 12);
    expect(() => line.sAtX(7)).toThrow();
  });

  it('intersects a ray (either direction) and reports the arc length of the hit', () => {
    // vertical line through x = 4.5 hits the flat segment at s = 6.5
    expect(line.rayHit({ x: 4.5, r: 0 }, { x: 0, r: 1 })).toBeCloseTo(6.5, 12);
    expect(line.rayHit({ x: 4.5, r: 10 }, { x: 0, r: 1 })).toBeCloseTo(6.5, 12);
    expect(line.rayHit({ x: 10, r: 0 }, { x: 0, r: 1 })).toBeNull();
  });

  it('extracts sub-curves, reverses, samples and measures distance', () => {
    const sub = line.sub(2.5, 6.5);
    expect(sub.length).toBeCloseTo(4, 12);
    expect(sub.points[0]).toEqual({ x: 1.5, r: 2 });
    expect(sub.points[sub.points.length - 1]).toEqual({ x: 4.5, r: 4 });
    const rev = line.reversed();
    expect(rev.points[0]).toEqual({ x: 6, r: 4 });
    expect(rev.length).toBeCloseTo(8, 12);
    expect(line.sample([0, 5, 8])).toEqual([
      { x: 0, r: 0 },
      { x: 3, r: 4 },
      { x: 6, r: 4 },
    ]);
    expect(line.distanceTo({ x: 4, r: 5 })).toBeCloseTo(1, 12);
    expect(line.distanceTo({ x: 0, r: 0 })).toBe(0);
  });

  it('rejects degenerate input', () => {
    expect(() => new Polyline([{ x: 0, r: 0 }])).toThrow();
  });
});

describe('sampleFunction', () => {
  it('samples a parametric curve into a dense polyline', () => {
    const quarter = sampleFunction(
      (u) => ({ x: Math.cos((u * Math.PI) / 2), r: Math.sin((u * Math.PI) / 2) }),
      2000,
    );
    expect(quarter.length).toBeCloseTo(Math.PI / 2, 6);
    expect(quarter.points.length).toBe(2001);
  });
});
