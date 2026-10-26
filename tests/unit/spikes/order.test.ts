import { describe, expect, it } from 'vitest';
import { mulberry32, orderEffect, sweepOrder } from '../../../spikes/lib/order';

// The throughput sweep: 3 grids x 3 tiles; the tile comparison is within a grid (W0G-I2).
const THROUGHPUT = ['80k', '130k', '256k'].flatMap((g) =>
  ['16x8', '8x8', '32x4'].map((t) => ({ id: `${g}-${t}`, group: g })),
);
const WORKER = ['idle', 'react15', 'react60'].flatMap((load) =>
  ['main', 'worker'].map((mode) => ({ id: `${mode}-${load}`, group: load })),
);

describe('mulberry32', () => {
  it('is a deterministic generator in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBe(1000);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });
});

describe('sweepOrder (rotated per repetition, seeded)', () => {
  it('every repetition runs every configuration once', () => {
    const orders = sweepOrder(THROUGHPUT, 3, 7);
    expect(orders).toHaveLength(3);
    for (const o of orders) expect([...o].sort()).toEqual(THROUGHPUT.map((c) => c.id).sort());
  });

  it('keeps a group together, so its configurations run close in time', () => {
    for (const o of sweepOrder(THROUGHPUT, 3, 11)) {
      for (let k = 0; k < 9; k += 3) {
        const groups = new Set(o.slice(k, k + 3).map((id) => id.split('-')[0]));
        expect(groups.size).toBe(1);
      }
    }
  });

  it('Latin square: each tile takes each position in its grid once over 3 repetitions', () => {
    for (const seed of [1, 2, 3, 99]) {
      const orders = sweepOrder(THROUGHPUT, 3, seed);
      for (const c of THROUGHPUT) {
        const slots = orders.map((o) =>
          o.filter((id) => id.startsWith(`${c.group}-`)).indexOf(c.id),
        );
        expect([...slots].sort()).toEqual([0, 1, 2]);
      }
      // ... and each grid takes each block position once.
      for (const g of ['80k', '130k', '256k']) {
        const blocks = orders.map((o) =>
          Math.floor(o.findIndex((id) => id.startsWith(`${g}-`)) / 3),
        );
        expect([...blocks].sort()).toEqual([0, 1, 2]);
      }
    }
  });

  it('alternates a pair (main vs worker) between repetitions', () => {
    const orders = sweepOrder(WORKER, 3, 5);
    for (const load of ['idle', 'react15', 'react60']) {
      const first = orders.map((o) => o.find((id) => id.endsWith(`-${load}`)));
      expect(first[0]).not.toBe(first[1]);
      expect(first[0]).toBe(first[2]);
    }
  });

  it('is deterministic for a seed, and the seed picks the base order', () => {
    expect(sweepOrder(THROUGHPUT, 3, 123)).toEqual(sweepOrder(THROUGHPUT, 3, 123));
    const bases = new Set(
      Array.from({ length: 20 }, (_, s) => sweepOrder(THROUGHPUT, 1, s)[0]?.join()),
    );
    expect(bases.size).toBeGreaterThan(5);
  });

  it('keeps a subset (--only) in the same scheme', () => {
    const only = THROUGHPUT.filter((c) => c.group === '130k');
    const orders = sweepOrder(only, 3, 4);
    expect(orders.map((o) => o[0])).toHaveLength(3);
    expect(new Set(orders.map((o) => o[0])).size).toBe(3);
  });

  it('rejects duplicate ids and a non-positive repetition count', () => {
    expect(() => sweepOrder([...THROUGHPUT, THROUGHPUT[0] as never], 3, 1)).toThrow(/duplicate/);
    expect(() => sweepOrder(THROUGHPUT, 0, 1)).toThrow(/repetitions/);
  });
});

describe('orderEffect (drift with sweep position)', () => {
  it('is zero when the values do not depend on position', () => {
    const samples = THROUGHPUT.flatMap((c, k) =>
      [0, 1, 2].map((rep) => ({ id: c.id, seq: 9 * rep + ((k + 3 * rep) % 9), value: 1 + k })),
    );
    const e = orderEffect(samples);
    expect(e?.slopePerSlot).toBeCloseTo(0, 12);
    expect(e?.overSweep).toBeCloseTo(0, 12);
    expect(e?.n).toBe(27);
  });

  it('recovers a drift of +1 % per slot across configurations of different cost', () => {
    const samples = THROUGHPUT.flatMap((c, k) =>
      [0, 1, 2].map((rep) => {
        const seq = 9 * rep + ((k + 3 * rep) % 9);
        return { id: c.id, seq, value: (1 + k) * (1 + 0.01 * seq) };
      }),
    );
    const e = orderEffect(samples);
    // Normalized by each configuration's median, so the slope is about 1 % per slot.
    expect(e?.slopePerSlot).toBeGreaterThan(0.008);
    expect(e?.slopePerSlot).toBeLessThan(0.011);
    expect(e?.overSweep).toBeCloseTo((e?.slopePerSlot ?? 0) * 26, 12);
  });

  it('is null without at least two positions', () => {
    expect(orderEffect([])).toBeNull();
    expect(orderEffect([{ id: 'a', seq: 3, value: 1 }])).toBeNull();
  });
});
