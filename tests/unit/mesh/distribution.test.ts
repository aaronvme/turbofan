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
    // growing only, then shrinking only
    expect(maxRatio([0, 1, 4])).toBeCloseTo(3, 12);
    expect(maxRatio([0, 3, 4])).toBeCloseTo(3, 12);
  });

  it('reports a fold or a zero spacing as an infinite ratio (W0M-N2)', () => {
    expect(maxRatio([0, 0.5, 0.4, 1])).toBe(Infinity);
    expect(maxRatio([0, 0.5, 0.5, 1])).toBe(Infinity);
    expect(maxRatio([0, -0.1])).toBe(Infinity);
  });
});

describe('vinokur interior (W0M-I3)', () => {
  // Vinokur (1983), the two-sided function: u(xi) = 1/2 (1 + tanh(dy (xi - 1/2)) / tanh(dy / 2))
  // when B > 1, tan instead of tanh when B < 1, u = xi when B = 1, and s = u / (A + (1 - A) u).
  // Asking vinokur() for the end spacings of such a closed-form distribution must give back the
  // whole distribution, interior included (the Newton step only fixes the ends, so this pins the
  // interior formula).
  const closed = (n: number, A: number, u: (xi: number) => number): Float64Array =>
    Float64Array.from({ length: n + 1 }, (_, k) => {
      const uk = u(k / n);
      return uk / (A + (1 - A) * uk);
    });
  const tanh = (dy: number) => (xi: number) =>
    0.5 * (1 + Math.tanh(dy * (xi - 0.5)) / Math.tanh(dy / 2));
  const tan = (dy: number) => (xi: number) =>
    0.5 * (1 + Math.tan(dy * (xi - 0.5)) / Math.tan(dy / 2));
  // A < 1/2 matters: normalised, u / (A - (1 - A) u) is the same family with A' = A / (2A - 1),
  // so a sign error there only shows when A' would have to be negative. Weak tanh clustering
  // (dy < 0.93) is where a wrong sinh(y)/y root would push the solver onto the tan branch.
  const cases: [string, number, number, (xi: number) => number][] = [
    ['tanh branch (B > 1)', 20, 1.8, tanh(3)],
    ['tanh branch, last cell much finer than the first (A < 1/2)', 16, 0.3, tanh(2)],
    ['tanh branch, weak clustering', 10, 1.2, tanh(0.5)],
    ['tan branch (B < 1)', 12, 0.7, tan(1.2)],
    ['B = 1', 10, 1.5, (xi) => xi],
  ];
  it.each(cases)('matches the closed form on the %s', (_, n, A, u) => {
    const ref = closed(n, A, u);
    const t = vinokur(n, ref[1] ?? 0, 1 - (ref[n - 1] ?? 0));
    for (let k = 0; k <= n; k++) {
      expect(Math.abs((t[k] ?? NaN) - (ref[k] ?? NaN))).toBeLessThan(1e-10);
    }
  });

  it('converges for strong two-sided clustering', () => {
    const ds = spacings(vinokur(40, 1e-4, 0.2));
    expect(Math.abs((ds[0] ?? 0) / 1e-4 - 1)).toBeLessThan(1e-9);
    expect(Math.abs((ds[39] ?? 0) / 0.2 - 1)).toBeLessThan(1e-9);
  });

  it('is a single cell for n = 1', () => {
    expect(Array.from(vinokur(1, 0.3, 0.3))).toEqual([0, 1]);
  });

  it('says why it rejects a request', () => {
    for (const [d0, d1] of [
      [0, 0.1],
      [0.1, 0],
      [-0.1, 0.2],
      [0.5, 0.5],
      [0.6, 0.45],
    ] as const) {
      expect(() => vinokur(4, d0, d1), `${d0}, ${d1}`).toThrow(/impossible for 4 cells/);
    }
    // legal by the end-spacing rule but impossible with two cells: the Newton step cannot meet it
    expect(() => vinokur(2, 0.3, 0.3)).toThrow(/did not converge/);
  });
});

describe('distribution input checks', () => {
  it('rejects cell counts that are not positive integers', () => {
    expect(() => uniform(0)).toThrow(/positive integer, got 0/);
    expect(() => uniform(2.5)).toThrow(/positive integer, got 2.5/);
    expect(() => bySpacing(1, () => 0.1, 0)).toThrow(/positive integer/);
  });

  it('rejects first spacings outside (0, 1)', () => {
    for (const ds0 of [0, -0.1, 1, 1.5]) {
      expect(() => geometric(4, ds0), String(ds0)).toThrow(/first spacing/);
    }
  });

  it('finds ratios above 2 (the bracket grows)', () => {
    const ds = spacings(geometric(10, 1e-4));
    expect(ds[0]).toBeCloseTo(1e-4, 15);
    const q = (ds[1] ?? 0) / (ds[0] ?? 1);
    expect(q).toBeGreaterThan(2);
    for (let k = 1; k < ds.length; k++) expect((ds[k] ?? 0) / (ds[k - 1] ?? 1)).toBeCloseTo(q, 9);
  });
});
