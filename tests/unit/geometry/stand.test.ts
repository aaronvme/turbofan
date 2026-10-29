// W1V-N5 (pass 6): the engine floated 0.37 m over the studio floor with its shadow detached.
// It now rests on a transport-stand cradle (src/geometry/stand.ts): a saddle under the fan
// cowl and one under the core cowl aft of the nacelle, each on two posts from a floor frame.
// The layout is pure; these tests pin that it touches what it carries and stands on the floor.

import { describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { engineWalls } from '../../../src/geometry/walls';
import { X } from '../../../src/geometry/parts';
import { STAND, standLayout } from '../../../src/geometry/stand';

const FLOOR_Y = -1.32;
const walls = engineWalls(ENGINE_DEFINITION, 96);
const radii = {
  nacelle: (x: number) => walls.nacelleOuter.radiusAt(x),
  cowl: (x: number) => walls.coreCowl.radiusAt(x),
};
const s = standLayout(radii, FLOOR_Y, X.nacelleTe);

describe('the engine stand (W1V-N5)', () => {
  it('one saddle under the nacelle, one under the core cowl aft of the nacelle', () => {
    expect(s.saddles.length).toBe(2);
    const [front, rear] = s.saddles;
    expect(front?.x).toBeLessThan(X.nacelleTe);
    expect(rear?.x).toBeGreaterThan(X.nacelleTe + 0.1);
    // each saddle's width lies over its skin
    expect((front?.x ?? 0) - (front?.width ?? 0) / 2).toBeGreaterThan(X.lipBulkhead);
    expect((rear?.x ?? 0) + (rear?.width ?? 0) / 2).toBeLessThan(X.coreLipStart);
  });

  it('the saddles carry the skins: a pad of STAND.pad m, the skin radius taken at both edges', () => {
    for (const [k, sd] of s.saddles.entries()) {
      const r = k === 0 ? radii.nacelle : radii.cowl;
      const rMax = Math.max(r(sd.x - sd.width / 2), r(sd.x), r(sd.x + sd.width / 2));
      expect(sd.innerRadius).toBeCloseTo(rMax + STAND.pad, 9);
      expect(sd.outerRadius - sd.innerRadius).toBeCloseTo(STAND.saddleDepth, 9);
      expect(sd.halfAngle).toBeGreaterThan(0.2);
      expect(sd.halfAngle).toBeLessThan(Math.PI / 2);
    }
  });

  it('the posts run from the floor frame to the saddle underside', () => {
    expect(s.posts.length).toBe(4);
    for (const p of s.posts) {
      const sd = s.saddles.find((q) => Math.abs(q.x - (p.min[0] + p.max[0]) / 2) < 1e-9);
      expect(sd).toBeDefined();
      if (sd === undefined) continue;
      const z = (p.min[2] + p.max[2]) / 2;
      // the post's top meets the saddle's outer arc at its z
      expect(p.max[1]).toBeCloseTo(-Math.sqrt(sd.outerRadius ** 2 - z ** 2), 9);
      expect(p.min[1]).toBeCloseTo(FLOOR_Y + STAND.frameLift + STAND.railHeight, 9);
      // inside the saddle's arc
      expect(Math.abs(z)).toBeLessThan(sd.outerRadius * Math.sin(sd.halfAngle));
    }
  });

  it('the frame rides on its casters under both saddles', () => {
    expect(s.rails.length).toBeGreaterThanOrEqual(2);
    for (const b of s.rails) {
      expect(b.min[1]).toBeCloseTo(FLOOR_Y + STAND.frameLift, 9);
      expect(b.max[1] - b.min[1]).toBeGreaterThan(0);
      expect(b.max[0]).toBeGreaterThan(b.min[0]);
      expect(b.max[2]).toBeGreaterThan(b.min[2]);
    }
    const xs = s.rails.flatMap((b) => [b.min[0], b.max[0]]);
    for (const sd of s.saddles) {
      expect(Math.min(...xs)).toBeLessThan(sd.x);
      expect(Math.max(...xs)).toBeGreaterThan(sd.x);
    }
  });

  // pass 8 (the toy-like stand): an engineering transport stand, a heavy frame on four
  // swivel casters, tied posts, rubber pads under the skins and a tow bar
  it('four casters on the floor at the frame corners, the frame on them', () => {
    expect(s.casters.length).toBe(4);
    const xs = s.rails.flatMap((b) => [b.min[0], b.max[0]]);
    for (const c of s.casters) {
      // the wheel touches the floor; its axle is under the frame
      expect(c.y - c.radius).toBeCloseTo(FLOOR_Y, 9);
      expect(c.y + c.radius).toBeLessThan(FLOOR_Y + STAND.frameLift);
      expect(c.x).toBeGreaterThan(Math.min(...xs));
      expect(c.x).toBeLessThan(Math.max(...xs));
      expect(Math.abs(Math.abs(c.z) - STAND.railZ)).toBeLessThan(1e-9);
    }
    // a stand for a 2.3 t engine: wide enough not to tip (the frame wider than the posts)
    expect(STAND.railZ).toBeGreaterThan(STAND.postZ + 0.1);
  });

  it('each pair of posts is tied across, at mid height, and joined to the rails by cross members', () => {
    expect(s.braces.length).toBe(s.saddles.length);
    for (const [k, b] of s.braces.entries()) {
      const sd = s.saddles[k];
      expect(Math.abs((b.min[0] + b.max[0]) / 2 - (sd?.x ?? 0))).toBeLessThan(1e-9);
      expect(b.min[2]).toBeCloseTo(-STAND.postZ, 9);
      expect(b.max[2]).toBeCloseTo(STAND.postZ, 9);
    }
    // the cross members under each saddle span the frame
    const across = s.rails.filter((r) => r.max[2] - r.min[2] > 2 * STAND.railZ);
    expect(across.length).toBe(s.saddles.length);
  });

  it('rubber pads between the saddles and the skins they carry; a tow bar ahead of the frame', () => {
    expect(s.pads.length).toBe(s.saddles.length);
    for (const [k, pd] of s.pads.entries()) {
      const sd = s.saddles[k];
      expect(pd.outerRadius).toBeCloseTo(sd?.innerRadius ?? 0, 9);
      expect(pd.outerRadius - pd.innerRadius).toBeCloseTo(STAND.pad, 9);
      expect(pd.width).toBeLessThan(sd?.width ?? 0);
    }
    const x0 = Math.min(...s.rails.map((r) => r.min[0]));
    expect(s.towBar.max[0]).toBeLessThanOrEqual(x0 + 1e-9);
    expect(s.towBar.min[0]).toBeLessThan(x0 - 0.2);
  });

  it('refuses a floor that is not under the engine', () => {
    expect(() => standLayout(radii, 0, X.nacelleTe)).toThrow(/floor/);
  });
});
