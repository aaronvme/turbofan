import { describe, expect, it } from 'vitest';
import { bySpacing, geometric, maxRatio, uniform, vinokur } from '../../../tools/mesh/distribution';

function spacings(t: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let k = 1; k < t.length; k++) out.push((t[k] ?? 0) - (t[k - 1] ?? 0));
  return out;
}

describe('uniform', () => {
  it('places n + 1 equally spaced fractions from 0 to 1', () => {
    expect(Array.from(uniform(4))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('geometric', () => {
  it('hits the first spacing and keeps a constant ratio', () => {
    const t = geometric(10, 0.02);
    expect(t.length).toBe(11);
    expect(t[0]).toBe(0);
    expect(t[10]).toBe(1);
    const ds = spacings(t);
    expect(ds[0]).toBeCloseTo(0.02, 12);
    const q = (ds[1] ?? 0) / (ds[0] ?? 1);
    for (let k = 1; k < ds.length; k++) expect((ds[k] ?? 0) / (ds[k - 1] ?? 1)).toBeCloseTo(q, 9);
    expect(q).toBeGreaterThan(1);
  });

  it('shrinks when the first spacing is larger than uniform', () => {
    const ds = spacings(geometric(8, 0.2));
    expect(ds[0]).toBeCloseTo(0.2, 12);
    expect(ds[7]).toBeLessThan(ds[0] ?? 0);
  });

  it('is uniform when the first spacing is 1/n', () => {
    const t = geometric(5, 0.2);
    for (let k = 0; k <= 5; k++) expect(t[k]).toBeCloseTo(k / 5, 12);
  });
});

describe('vinokur', () => {
  it('reproduces both end spacings exactly (tanh branch, strong clustering)', () => {
    const t = vinokur(20, 0.005, 0.1);
    const ds = spacings(t);
    expect(t[0]).toBe(0);
    expect(t[20]).toBe(1);
    expect(Math.abs((ds[0] ?? 0) / 0.005 - 1)).toBeLessThan(1e-9);
    expect(Math.abs((ds[19] ?? 0) / 0.1 - 1)).toBeLessThan(1e-9);
    for (const d of ds) expect(d).toBeGreaterThan(0);
  });

  it('reproduces both end spacings when both ends are coarser than uniform (tan branch)', () => {
    const ds = spacings(vinokur(10, 0.14, 0.12));
    expect(Math.abs((ds[0] ?? 0) / 0.14 - 1)).toBeLessThan(1e-9);
    expect(Math.abs((ds[9] ?? 0) / 0.12 - 1)).toBeLessThan(1e-9);
    for (const d of ds) expect(d).toBeGreaterThan(0);
  });

  it('is uniform when both end spacings are 1/n', () => {
    const t = vinokur(8, 1 / 8, 1 / 8);
    for (let k = 0; k <= 8; k++) expect(t[k]).toBeCloseTo(k / 8, 10);
  });

  it('handles a one-sided ratio close to uniform', () => {
    const ds = spacings(vinokur(16, 0.05, 0.08));
    expect(Math.abs((ds[0] ?? 0) / 0.05 - 1)).toBeLessThan(1e-9);
    expect(Math.abs((ds[15] ?? 0) / 0.08 - 1)).toBeLessThan(1e-9);
  });

  it('rejects impossible requests', () => {
    expect(() => vinokur(4, 0.6, 0.6)).toThrow();
    expect(() => vinokur(0, 0.1, 0.1)).toThrow();
  });
});

describe('bySpacing', () => {
  it('follows a target spacing function and picks the cell count from it', () => {
    const h = (s: number): number => 0.01 + 0.05 * s;
    const s = bySpacing(2, h);
    // integral of ds / (0.01 + 0.05 s) from 0 to 2 = ln(11) / 0.05 = 47.96
    expect(s.length - 1).toBe(48);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBe(2);
    const ds = spacings(s);
    for (let k = 0; k < ds.length; k++) {
      const mid = ((s[k] ?? 0) + (s[k + 1] ?? 0)) / 2;
      expect(Math.abs((ds[k] ?? 0) / h(mid) - 1)).toBeLessThan(0.03);
    }
  });

  it('honours an explicit cell count by scaling the spacing', () => {
    const s = bySpacing(1, () => 0.1, 20);
    expect(s.length).toBe(21);
    for (let k = 0; k <= 20; k++) expect(s[k]).toBeCloseTo(k / 20, 12);
  });
});

describe('maxRatio', () => {
  it('reports the largest adjacent spacing ratio in either direction', () => {
    expect(maxRatio([0, 1, 3, 4])).toBeCloseTo(2, 12);
    expect(maxRatio([0, 1, 2])).toBe(1);
  });
});
