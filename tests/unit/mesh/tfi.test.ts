import { describe, expect, it } from 'vitest';
import { geometric, uniform, vinokur } from '../../../tools/mesh/distribution';
import { tfi, twoBoundary } from '../../../tools/mesh/tfi';
import { nodeIndex, type Block, type Pt } from '../../../tools/mesh/types';

function edge(fn: (u: number) => Pt, t: ArrayLike<number>): Pt[] {
  return Array.from(t, (u) => fn(u));
}

function node(b: Block, i: number, j: number): Pt {
  const k = nodeIndex(b, i, j);
  return { x: b.x[k] ?? NaN, r: b.r[k] ?? NaN };
}

/**
 * Curved, non-uniformly distributed edges of a duct-like patch. The shapes vanish exactly at the
 * ends (u(1-u) bumps, (1-v) a + v b blends) so the four corners coincide bitwise.
 */
function curvedEdges(ni: number, nj: number) {
  const ti = vinokur(ni, 0.01, 0.05);
  const tj = geometric(nj, 0.03);
  const rNE = 1 + 0.05;
  const south = edge((u) => ({ x: 2 * u, r: 0.3 + 0.4 * u * (1 - u) }), ti);
  const north = edge((u) => ({ x: 2 * u + 0.8 * u * (1 - u), r: 1 + 0.05 * u * u }), uniform(ni));
  const west = edge((v) => ({ x: 0.2 * v * (1 - v), r: 0.3 * (1 - v) + v }), tj);
  const east = edge((v) => ({ x: 2 - 0.1 * v * (1 - v), r: 0.3 * (1 - v) + rNE * v }), uniform(nj));
  return { south, north, west, east };
}

describe('tfi', () => {
  it('reproduces all four boundary curves exactly (bitwise)', () => {
    const ni = 24;
    const nj = 12;
    const { south, north, west, east } = curvedEdges(ni, nj);
    const b = tfi('t', south, north, west, east);
    expect(b.ni).toBe(ni);
    expect(b.nj).toBe(nj);
    for (let i = 0; i <= ni; i++) {
      expect(node(b, i, 0)).toEqual(south[i]);
      expect(node(b, i, nj)).toEqual(north[i]);
    }
    for (let j = 0; j <= nj; j++) {
      expect(node(b, 0, j)).toEqual(west[j]);
      expect(node(b, ni, j)).toEqual(east[j]);
    }
    // and the interior is a sensible fill (inside the bounding box, no NaN)
    for (let k = 0; k < b.x.length; k++) {
      expect(b.x[k]).toBeGreaterThan(-0.1);
      expect(b.x[k]).toBeLessThan(2.3);
      expect(b.r[k]).toBeGreaterThan(0.25);
      expect(b.r[k]).toBeLessThan(1.1);
    }
  });

  it('gives the analytic uniform mesh for a straight annular duct', () => {
    const ni = 20;
    const nj = 8;
    const L = 1.3;
    const rh = 0.25;
    const rt = 0.4;
    const b = tfi(
      'annulus',
      edge((u) => ({ x: L * u, r: rh }), uniform(ni)),
      edge((u) => ({ x: L * u, r: rt }), uniform(ni)),
      edge((v) => ({ x: 0, r: rh * (1 - v) + rt * v }), uniform(nj)),
      edge((v) => ({ x: L, r: rh * (1 - v) + rt * v }), uniform(nj)),
    );
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) {
        const p = node(b, i, j);
        expect(Math.abs(p.x - (L * i) / ni)).toBeLessThan(1e-14);
        expect(Math.abs(p.r - (rh + ((rt - rh) * j) / nj))).toBeLessThan(1e-14);
      }
    }
  });

  it('is exact for a bilinear map (trapezoid with uniform edges)', () => {
    const P00 = { x: 0, r: 0 };
    const P10 = { x: 2, r: 0.2 };
    const P01 = { x: 0.3, r: 1 };
    const P11 = { x: 1.8, r: 1.4 };
    const bil = (u: number, v: number): Pt => ({
      x: (1 - u) * (1 - v) * P00.x + u * (1 - v) * P10.x + (1 - u) * v * P01.x + u * v * P11.x,
      r: (1 - u) * (1 - v) * P00.r + u * (1 - v) * P10.r + (1 - u) * v * P01.r + u * v * P11.r,
    });
    const ni = 6;
    const nj = 5;
    const b = tfi(
      'trap',
      edge((u) => bil(u, 0), uniform(ni)),
      edge((u) => bil(u, 1), uniform(ni)),
      edge((v) => bil(0, v), uniform(nj)),
      edge((v) => bil(1, v), uniform(nj)),
    );
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) {
        const p = node(b, i, j);
        const q = bil(i / ni, j / nj);
        expect(Math.abs(p.x - q.x)).toBeLessThan(1e-14);
        expect(Math.abs(p.r - q.r)).toBeLessThan(1e-14);
      }
    }
  });

  it('rejects edges whose corners do not coincide or whose counts disagree', () => {
    const { south, north, west, east } = curvedEdges(6, 4);
    expect(() => tfi('bad', south, north.slice(1), west, east)).toThrow();
    const shifted = east.map((p) => ({ x: p.x + 1e-3, r: p.r }));
    expect(() => tfi('bad', south, north, west, shifted)).toThrow();
  });
});

describe('twoBoundary', () => {
  it('places nodes along straight connectors at the per-column fractions', () => {
    const ni = 10;
    const nj = 6;
    const inner = edge((u) => ({ x: u, r: 1 + 0.1 * Math.sin(3 * u) }), uniform(ni));
    const outer = edge((u) => ({ x: u + 0.05, r: 1.5 + 0.1 * u }), uniform(ni));
    const fr = (i: number): Float64Array => geometric(nj, 0.05 + 0.01 * i);
    const b = twoBoundary('c', inner, outer, fr);
    expect(b.ni).toBe(ni);
    expect(b.nj).toBe(nj);
    for (let i = 0; i <= ni; i++) {
      const w = inner[i] as Pt;
      const o = outer[i] as Pt;
      const f = fr(i);
      expect(node(b, i, 0)).toEqual(w);
      expect(node(b, i, nj)).toEqual(o);
      for (let j = 1; j < nj; j++) {
        const p = node(b, i, j);
        const fj = f[j] ?? NaN;
        expect(p.x).toBeCloseTo(w.x + fj * (o.x - w.x), 14);
        expect(p.r).toBeCloseTo(w.r + fj * (o.r - w.r), 14);
      }
    }
  });

  it('rejects mismatched inner/outer counts and bad fractions', () => {
    const inner = edge((u) => ({ x: u, r: 1 }), uniform(4));
    const outer = edge((u) => ({ x: u, r: 2 }), uniform(5));
    expect(() => twoBoundary('c', inner, outer, () => uniform(3))).toThrow();
    expect(() => twoBoundary('c', inner, inner.slice(), () => [0, 0.5, 0.9])).toThrow();
  });

  it('says which rule a bad input breaks', () => {
    const inner = edge((u) => ({ x: u, r: 1 }), uniform(4));
    const outer = edge((u) => ({ x: u, r: 2 }), uniform(4));
    const p = inner[0] as Pt;
    const q = outer[0] as Pt;
    expect(() => twoBoundary('c', inner, outer.slice(1), () => uniform(3))).toThrow(
      'two-boundary rows disagree for c',
    );
    expect(() => twoBoundary('c', [p], [q], () => uniform(3))).toThrow(
      'two-boundary rows disagree for c',
    );
    expect(() => twoBoundary('c', inner, outer, () => [1])).toThrow(
      'two-boundary block c needs at least one cell across',
    );
    // column 2 breaks one rule at a time; the other columns are fine
    const bad =
      (f: number[]) =>
      (i: number): number[] =>
        i === 2 ? f : [0, 0.4, 0.7, 1];
    const message = 'two-boundary fractions for c column 2 must run 0..1 with 4 entries';
    expect(() => twoBoundary('c', inner, outer, bad([0, 0.4, 1]))).toThrow(message);
    expect(() => twoBoundary('c', inner, outer, bad([0.1, 0.4, 0.7, 1]))).toThrow(message);
    expect(() => twoBoundary('c', inner, outer, bad([0, 0.4, 0.7, 0.9]))).toThrow(message);
    expect(() => twoBoundary('c', inner, outer, bad([0, 0.4, 0.7, 1, 1]))).toThrow(message);
    // the smallest legal block: one cell
    expect(twoBoundary('c', [p, inner[1] as Pt], [q, outer[1] as Pt], () => [0, 1]).nj).toBe(1);
  });

  it('copies the inner and outer rows bitwise (no lerp round-off at the ends)', () => {
    // 0.3 + (0.9 - 0.3) and 1.1 + (0.3 - 1.1) both round away from the end value
    const inner: Pt[] = [
      { x: 0.3, r: 1.1 },
      { x: 0.35, r: 1.1 },
    ];
    const outer: Pt[] = [
      { x: 0.9, r: 0.3 },
      { x: 0.95, r: 0.3 },
    ];
    expect(0.3 + (0.9 - 0.3)).not.toBe(0.9);
    const b = twoBoundary('c', inner, outer, () => [0, 0.5, 1]);
    expect(node(b, 0, 2)).toEqual(outer[0]);
    expect(node(b, 1, 2)).toEqual(outer[1]);
    expect(node(b, 0, 0)).toEqual(inner[0]);
  });
});

describe('tfi arc-length blending (W0M-I3)', () => {
  /** Straight segment from a to b at fraction u, with exact end points. */
  const lerp = (a: Pt, b: Pt, u: number): Pt =>
    u === 0 ? a : u === 1 ? b : { x: a.x + u * (b.x - a.x), r: a.r + u * (b.r - a.r) };

  /** Intersection of the lines a1-a2 and b1-b2. */
  function intersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt {
    const d1 = { x: a2.x - a1.x, r: a2.r - a1.r };
    const d2 = { x: b2.x - b1.x, r: b2.r - b1.r };
    const w = { x: b1.x - a1.x, r: b1.r - a1.r };
    const s = (w.x * d2.r - w.r * d2.x) / (d1.x * d2.r - d1.r * d2.x);
    return { x: a1.x + s * d1.x, r: a1.r + s * d1.r };
  }

  it('puts each interior node where the lines joining opposite edge nodes cross', () => {
    // A parallelogram with straight edges and a different clustering on every edge. Soni's
    // arc-length blending makes node (i, j) the intersection of segment S_i-N_i with W_j-E_j
    // (exactly, for straight edges and any affine image of the unit square).
    const P00 = { x: 0, r: 0 };
    const P10 = { x: 2, r: 0.3 };
    const P01 = { x: 0.5, r: 1 };
    const P11 = { x: 2.5, r: 1.3 };
    const ni = 9;
    const nj = 7;
    const south = edge((u) => lerp(P00, P10, u), vinokur(ni, 0.02, 0.2));
    const north = edge((u) => lerp(P01, P11, u), geometric(ni, 0.18));
    const west = edge((v) => lerp(P00, P01, v), geometric(nj, 0.04));
    const east = edge((v) => lerp(P10, P11, v), vinokur(nj, 0.25, 0.06));
    const b = tfi('blend', south, north, west, east);
    let worst = 0;
    for (let j = 1; j < nj; j++) {
      for (let i = 1; i < ni; i++) {
        const q = intersect(south[i] as Pt, north[i] as Pt, west[j] as Pt, east[j] as Pt);
        const p = node(b, i, j);
        worst = Math.max(worst, Math.hypot(p.x - q.x, p.r - q.r));
      }
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it('names the corner that does not coincide (W0M-N5)', () => {
    const { south, north, west, east } = curvedEdges(6, 4);
    const moved = (pts: readonly Pt[], k: number, dx: number, dr: number): Pt[] =>
      pts.map((p, m) => (m === k ? { x: p.x + dx, r: p.r + dr } : p));
    // each corner once, with only x or only r off
    expect(() => tfi('bad', moved(south, 0, 1e-9, 0), north, west, east)).toThrow(
      'TFI corner mismatch at bad SW',
    );
    expect(() => tfi('bad', south, north, west, moved(east, 0, 0, 1e-9))).toThrow(
      'TFI corner mismatch at bad SE',
    );
    expect(() => tfi('bad', south, moved(north, 0, 0, 1e-9), west, east)).toThrow(
      'TFI corner mismatch at bad NW',
    );
    expect(() => tfi('bad', south, north, west, moved(east, 4, 1e-9, 0))).toThrow(
      'TFI corner mismatch at bad NE',
    );
  });

  it('checks the edge counts before the corners', () => {
    const { south, north, west, east } = curvedEdges(6, 4);
    const message = 'TFI edge counts disagree for block bad';
    expect(() => tfi('bad', south, north.slice(1), west, east)).toThrow(message);
    expect(() => tfi('bad', south, north, west, east.slice(1))).toThrow(message);
    const sw = south[0] as Pt;
    const nw = north[0] as Pt;
    expect(() => tfi('bad', [sw], [nw], west, west)).toThrow(message);
    expect(() => tfi('bad', south, south, [sw], [south[6] as Pt])).toThrow(message);
    // the smallest legal block: one cell
    const one = tfi(
      'one',
      [sw, south[6] as Pt],
      [nw, north[6] as Pt],
      [sw, nw],
      [south[6] as Pt, north[6] as Pt],
    );
    expect([one.ni, one.nj]).toEqual([1, 1]);
  });
});
