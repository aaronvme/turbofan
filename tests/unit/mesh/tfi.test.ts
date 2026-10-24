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
});
