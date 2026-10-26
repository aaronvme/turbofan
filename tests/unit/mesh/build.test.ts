// Building helpers for duct blocks with fixed grid lines (station planes, blade edges).
import { describe, expect, it } from 'vitest';
import {
  fixedSpacing,
  pchip,
  segmentCounts,
  wallRows,
  wallSpacing,
} from '../../../tools/mesh/build';
import { Polyline } from '../../../tools/mesh/curve';
import { maxRatio } from '../../../tools/mesh/distribution';
import type { Pt } from '../../../tools/mesh/types';

describe('pchip', () => {
  it('passes through the points, stays monotone and is C1', () => {
    const xs = [0, 1, 1.5, 4, 5];
    const ys = [0, 2, 2.1, 6, 6.5];
    const f = pchip(xs, ys);
    xs.forEach((x, k) => {
      expect(f(x)).toBeCloseTo(ys[k] ?? NaN, 14);
    });
    let prev = -Infinity;
    for (let k = 0; k <= 500; k++) {
      const v = f((5 * k) / 500);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // slopes agree on both sides of an interior knot
    const e = 1e-7;
    for (const x of [1, 1.5, 4]) {
      const left = (f(x) - f(x - e)) / e;
      const right = (f(x + e) - f(x)) / e;
      expect(Math.abs(left - right)).toBeLessThan(1e-4);
    }
  });

  it('is linear through collinear points and clamps outside the knots', () => {
    const f = pchip([0, 2, 3], [1, 5, 7]);
    expect(f(0.5)).toBeCloseTo(2, 14);
    expect(f(2.5)).toBeCloseTo(6, 14);
    expect(f(-1)).toBe(1);
    expect(f(9)).toBe(7);
  });

  it('rejects knots that do not increase', () => {
    expect(() => pchip([0, 0, 1], [0, 1, 2])).toThrow(/increase/);
    expect(() => pchip([0], [0])).toThrow(/two knots/);
  });
});

describe('segmentCounts', () => {
  it('rounds each target when neighbouring scales already agree', () => {
    expect(segmentCounts([8.2, 1.9, 7.6], [1, 1, 1])).toEqual([8, 2, 8]);
  });

  it('keeps the spacing scale g/n from jumping between neighbours', () => {
    // a 1.18-cell gap between two 8-cell chords: with a 1.1 limit the chords take 7 cells
    const g = [8, 1.18, 8];
    expect(segmentCounts(g, [6, 1, 6], 1.25)).toEqual([8, 1, 8]);
    const n = segmentCounts(g, [6, 1, 6], 1.1);
    expect(n).toEqual([7, 1, 7]);
    for (let k = 1; k < g.length; k++) {
      const c0 = (g[k - 1] ?? 0) / (n[k - 1] ?? 1);
      const c1 = (g[k] ?? 0) / (n[k] ?? 1);
      expect(Math.abs(Math.log(c1 / c0))).toBeLessThanOrEqual(Math.log(1.1) + 1e-12);
    }
  });

  it('respects the minimum counts and relaxes the limit when it cannot be met', () => {
    const n = segmentCounts([2, 0.3, 2], [4, 1, 4], 1.05);
    expect(n[0]).toBeGreaterThanOrEqual(4);
    expect(n[1]).toBe(1);
    expect(n[2]).toBeGreaterThanOrEqual(4);
  });
});

describe('fixedSpacing', () => {
  const h = (s: number): number => 0.01 + 0.004 * s;

  it('puts nodes exactly on the fixed arc lengths and follows the spacing elsewhere', () => {
    const fixed = [0, 0.31, 0.3155, 0.62, 1];
    const { s, fixedIndex } = fixedSpacing(1, h, fixed, [1, 1, 1, 1]);
    expect(fixedIndex.length).toBe(fixed.length);
    fixedIndex.forEach((i, k) => {
      expect(s[i]).toBe(fixed[k]);
    });
    expect(fixedIndex[0]).toBe(0);
    expect(fixedIndex[fixedIndex.length - 1]).toBe(s.length - 1);
    for (let k = 1; k < s.length; k++) expect(s[k] ?? 0).toBeGreaterThan(s[k - 1] ?? 0);
    // a 5.5 mm segment between ~11 mm cells: one cell, and no abrupt jump either side
    expect((fixedIndex[2] ?? 0) - (fixedIndex[1] ?? 0)).toBe(1);
    expect(maxRatio(s)).toBeLessThanOrEqual(1.15);
    // far from fixed nodes the spacing is the target spacing to within the per-segment scale
    const mid = Math.floor(((fixedIndex[3] ?? 0) + (fixedIndex[4] ?? 0)) / 2);
    const ds = (s[mid + 1] ?? 0) - (s[mid] ?? 0);
    expect(Math.abs(ds / h(s[mid] ?? 0) - 1)).toBeLessThan(0.1);
  });

  it('honours minimum cell counts per segment', () => {
    const { fixedIndex } = fixedSpacing(1, () => 0.2, [0, 0.4, 0.5, 1], [1, 6, 1]);
    expect((fixedIndex[2] ?? 0) - (fixedIndex[1] ?? 0)).toBe(6);
  });

  it('rejects fixed arc lengths that do not span the length in order', () => {
    expect(() => fixedSpacing(1, h, [0, 0.5], [1])).toThrow(/span/);
    expect(() => fixedSpacing(1, h, [0, 0.6, 0.5, 1], [1, 1, 1])).toThrow(/increase/);
  });
});

describe('wallSpacing', () => {
  it('holds exactly the prescribed cells per segment with nodes on the fixed arc lengths', () => {
    const fixed = [0, 0.3, 0.33, 0.7, 1];
    const counts = [30, 1, 40, 25];
    const { s, fixedIndex } = wallSpacing(1, () => 0.012, fixed, counts);
    expect(fixedIndex).toEqual([0, 30, 31, 71, 96]);
    fixedIndex.forEach((i, k) => {
      expect(s[i]).toBe(fixed[k]);
    });
    for (let k = 1; k < s.length; k++) expect(s[k] ?? 0).toBeGreaterThan(s[k - 1] ?? 0);
  });

  it('steps from a one-cell gap to finer chord cells without a jump', () => {
    // a 4.5 mm gap between two 30 mm chords at 3.75 mm (8 cells each)
    const fixed = [0, 0.03, 0.0345, 0.0645];
    const { s } = wallSpacing(0.0645, () => 0.00375, fixed, [8, 1, 8]);
    expect(maxRatio(s)).toBeLessThanOrEqual(1.15);
  });

  it('puts extra cells in the interior of a segment, not at its ends', () => {
    // twice the natural count in the middle segment: its end cells still match the neighbours
    const fixed = [0, 0.2, 0.4, 0.6];
    const { s, fixedIndex } = wallSpacing(0.6, () => 0.01, fixed, [20, 40, 20]);
    expect(maxRatio(s)).toBeLessThanOrEqual(1.15);
    const i = fixedIndex[1] ?? 0;
    const before = (s[i] ?? 0) - (s[i - 1] ?? 0);
    const after = (s[i + 1] ?? 0) - (s[i] ?? 0);
    expect(after / before).toBeGreaterThan(1 / 1.15);
  });

  it('reports the cells each segment needs at least', () => {
    const { need } = wallSpacing(0.6, () => 0.01, [0, 0.2, 0.4, 0.6], [20, 20, 20]);
    for (const n of need) expect(n).toBeCloseTo(20, 0);
  });
});

describe('wallRows', () => {
  // a duct with a sloping hub, 0..1 m long
  const lower = new Polyline([
    { x: 0, r: 0.2 },
    { x: 0.5, r: 0.25 },
    { x: 1, r: 0.25 },
  ]);
  const upper = new Polyline([
    { x: 0, r: 0.5 },
    { x: 1, r: 0.45 },
  ]);
  const radial = (x: number) => ({ hub: lower.atX(x), tip: upper.atX(x) });

  it('puts a node row exactly on every fixed line, slanted ones included', () => {
    const slanted = { hub: lower.atX(0.6), tip: upper.atX(0.64) };
    const cuts = [radial(0), radial(0.3), radial(0.3045), slanted, radial(1)];
    const { lo, up, fixed } = wallRows(lower, upper, () => 0.012, cuts);
    expect(lo.length).toBe(up.length);
    expect(fixed.length).toBe(3);
    cuts.slice(1, -1).forEach((c, k) => {
      const i = fixed[k] ?? -1;
      expect(lo[i]).toEqual(c.hub);
      expect(up[i]).toEqual(c.tip);
    });
    expect(lo[0]).toEqual(cuts[0]?.hub);
    expect(up[up.length - 1]).toEqual(cuts[4]?.tip);
    for (let i = 1; i < lo.length; i++) {
      expect((lo[i] as Pt).x).toBeGreaterThan((lo[i - 1] as Pt).x);
      expect((up[i] as Pt).x).toBeGreaterThan((up[i - 1] as Pt).x);
    }
    // each wall's own spacing stays smooth across the fixed lines
    const arc = (pts: readonly Pt[]) => {
      const out = [0];
      for (let i = 1; i < pts.length; i++)
        out.push(
          (out[i - 1] ?? 0) +
            Math.hypot(
              (pts[i] as Pt).x - (pts[i - 1] as Pt).x,
              (pts[i] as Pt).r - (pts[i - 1] as Pt).r,
            ),
        );
      return out;
    };
    expect(maxRatio(arc(lo))).toBeLessThanOrEqual(1.15);
    expect(maxRatio(arc(up))).toBeLessThanOrEqual(1.15);
  });

  it('keeps at least the minimum cell count between two fixed lines', () => {
    const cuts = [radial(0), radial(0.4), radial(0.43), radial(1)];
    const { fixed } = wallRows(
      lower,
      upper,
      () => 0.012,
      cuts,
      (k) => (k === 1 ? 6 : 1),
    );
    expect((fixed[1] ?? 0) - (fixed[0] ?? 0)).toBe(6);
  });

  it('rejects fixed lines out of order or without both ends', () => {
    expect(() =>
      wallRows(lower, upper, () => 0.012, [radial(0), radial(0.5), radial(0.4), radial(1)]),
    ).toThrow(/order/);
    expect(() => wallRows(lower, upper, () => 0.012, [radial(0)])).toThrow(/end lines/);
  });
});
