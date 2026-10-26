import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAN_MAP } from '../../../src/cycle/maps/fan';
import { LPC_MAP } from '../../../src/cycle/maps/lpc';
import { HPC_MAP } from '../../../src/cycle/maps/hpc';
import { HPT_MAP } from '../../../src/cycle/maps/hpt';
import { LPT_MAP } from '../../../src/cycle/maps/lpt';
import {
  compressorPoint,
  hermite2,
  scaleCompressorMap,
  scaleTurbineMap,
  surgeMargin,
  turbinePoint,
  type CompressorDesign,
} from '../../../src/cycle/componentMaps';

const COMPRESSORS = [FAN_MAP, LPC_MAP, HPC_MAP];
const TURBINES = [HPT_MAP, LPT_MAP];

describe('ported pyCycle maps (Apache-2.0)', () => {
  it('every ported file carries the attribution and license header, and NOTICE exists', () => {
    for (const f of ['fan', 'lpc', 'hpc', 'hpt', 'lpt']) {
      const text = readFileSync(`src/cycle/maps/${f}.ts`, 'utf8');
      expect(text).toMatch(/OpenMDAO\/pyCycle/);
      expect(text).toMatch(/Apache License, Version 2\.0/);
    }
    const notice = readFileSync('NOTICE', 'utf8');
    expect(notice).toMatch(/pyCycle/);
    expect(notice).toMatch(/Apache License, Version 2\.0/);
  });
  it('keeps pyCycle design values and grid shapes', () => {
    expect(FAN_MAP.design).toEqual({ nc: 0.99, rline: 2.2, pr: 1.754 });
    expect(LPC_MAP.design).toEqual({ nc: 1, rline: 2.15, pr: 1.969 });
    expect(HPC_MAP.design).toEqual({ nc: 0.976, rline: 2.05, pr: 10.894 });
    expect(HPT_MAP.design).toEqual({ np: 100, pr: 6 });
    for (const m of COMPRESSORS) {
      expect(m.rlineStall).toBe(1);
      for (const t of [m.wc, m.eff, m.pr]) {
        expect(t).toHaveLength(m.nc.length);
        for (const row of t) expect(row).toHaveLength(m.rline.length);
      }
    }
    for (const m of TURBINES) {
      for (const t of [m.wp, m.eff]) {
        expect(t).toHaveLength(m.np.length);
        for (const row of t) expect(row).toHaveLength(m.pr.length);
      }
    }
  });
});

describe('hermite2 interpolation', () => {
  const xs = [0, 1, 3];
  const ys = [0, 2];
  const table = [
    [0, 2],
    [1, 5],
    [9, 4],
  ];
  it('reproduces the nodes', () => {
    xs.forEach((x, i) =>
      ys.forEach((y, j) =>
        expect(hermite2(xs, ys, table, x, y)).toBeCloseTo(table[i]?.[j] ?? 0, 12),
      ),
    );
  });
  it('reproduces a bilinear function exactly and extrapolates linearly', () => {
    const f = (x: number, y: number) => 2 + 3 * x - y + 0.5 * x * y;
    const t = xs.map((x) => ys.map((y) => f(x, y)));
    for (const [x, y] of [
      [0.5, 1],
      [2.2, 0.3],
      [-0.5, 1],
      [3.5, 2.5],
    ] as const) {
      expect(hermite2(xs, ys, t, x, y)).toBeCloseTo(f(x, y), 10);
    }
  });
  it('is continuous with a continuous slope across a node', () => {
    const at = (x: number) => hermite2(xs, ys, table, x, 1);
    const e = 1e-6;
    expect(Math.abs(at(1 - e) - at(1 + e))).toBeLessThan(1e-5);
    const left = (at(1) - at(1 - e)) / e;
    const right = (at(1 + e) - at(1)) / e;
    expect(Math.abs(left - right)).toBeLessThan(1e-4);
  });
});

describe('map scaling to the design point (pure)', () => {
  const design: CompressorDesign = { correctedFlow: 60, pressureRatio: 11, efficiency: 0.87 };
  it('the scaled map passes through the engine design point exactly', () => {
    for (const map of COMPRESSORS) {
      const s = scaleCompressorMap(map, design);
      const p = compressorPoint(s, 1, map.design.rline);
      expect(p.correctedFlow).toBeCloseTo(60, 10);
      expect(p.pressureRatio).toBeCloseTo(11, 10);
      expect(p.efficiency).toBeCloseTo(0.87, 12);
    }
  });
  it('scales PR - 1, not PR, and does not mutate the map', () => {
    const before = JSON.stringify(HPC_MAP);
    const s = scaleCompressorMap(HPC_MAP, design);
    expect(s.prScale).toBeCloseTo((11 - 1) / (HPC_MAP.design.pr - 1), 12);
    expect(JSON.stringify(HPC_MAP)).toBe(before);
    const raw = hermite2(HPC_MAP.nc, HPC_MAP.rline, HPC_MAP.pr, 0.9, 1.5);
    const p = compressorPoint(s, 0.9 / HPC_MAP.design.nc, 1.5);
    expect(p.pressureRatio).toBeCloseTo(1 + s.prScale * (raw - 1), 10);
  });
  it('rejects a non-physical design', () => {
    expect(() => scaleCompressorMap(FAN_MAP, { ...design, pressureRatio: 1 })).toThrow(/pressure/);
    expect(() => scaleCompressorMap(FAN_MAP, { ...design, efficiency: 1.2 })).toThrow(/efficiency/);
    expect(() => scaleCompressorMap(FAN_MAP, { ...design, correctedFlow: 0 })).toThrow(/flow/);
  });
});

describe('surge line and margin', () => {
  const s = scaleCompressorMap(HPC_MAP, { correctedFlow: 20, pressureRatio: 11, efficiency: 0.87 });
  it('is zero on the stall line, positive below it, negative beyond it', () => {
    for (const n of [0.7, 0.9, 1.0]) {
      expect(Math.abs(surgeMargin(s, compressorPoint(s, n, 1)))).toBeLessThan(1e-9);
      expect(surgeMargin(s, compressorPoint(s, n, 2))).toBeGreaterThan(0.05);
      const beyond = compressorPoint(s, n, 1);
      expect(
        surgeMargin(s, { ...beyond, pressureRatio: beyond.pressureRatio * 1.05 }),
      ).toBeLessThan(0);
    }
  });
});

describe('sub-idle extrapolation below the lowest speed line (similarity laws)', () => {
  const s = scaleCompressorMap(HPC_MAP, { correctedFlow: 20, pressureRatio: 11, efficiency: 0.87 });
  const nMin = (HPC_MAP.nc[0] ?? 0) / HPC_MAP.design.nc;
  it('is continuous at the lowest map speed', () => {
    const a = compressorPoint(s, nMin * (1 + 1e-9), 2);
    const b = compressorPoint(s, nMin * (1 - 1e-9), 2);
    expect(Math.abs(a.correctedFlow - b.correctedFlow)).toBeLessThan(1e-6);
    expect(Math.abs(a.pressureRatio - b.pressureRatio)).toBeLessThan(1e-6);
  });
  it('flow scales with speed and PR - 1 with speed squared, down to zero', () => {
    const a = compressorPoint(s, nMin, 2);
    const h = compressorPoint(s, nMin / 2, 2);
    expect(h.correctedFlow / a.correctedFlow).toBeCloseTo(0.5, 9);
    expect((h.pressureRatio - 1) / (a.pressureRatio - 1)).toBeCloseTo(0.25, 9);
    const z = compressorPoint(s, 0, 2);
    expect(z.correctedFlow).toBe(0);
    expect(z.pressureRatio).toBe(1);
    expect(h.efficiency).toBeGreaterThan(0.3);
  });
});

describe('turbine maps', () => {
  const design = { flowParameter: 1.2e-3, pressureRatio: 4, efficiency: 0.9 };
  it('the scaled map passes through the design point', () => {
    for (const map of TURBINES) {
      const s = scaleTurbineMap(map, design);
      const p = turbinePoint(s, 1, 4);
      expect(p.flowParameter).toBeCloseTo(1.2e-3, 14);
      expect(p.efficiency).toBeCloseTo(0.9, 12);
    }
  });
  it('unchokes below the map: the flow falls to zero at PR 1, continuously', () => {
    const s = scaleTurbineMap(HPT_MAP, design);
    const prMin = 1 + s.prScale * ((HPT_MAP.pr[0] ?? 0) - 1);
    const a = turbinePoint(s, 1, prMin * (1 + 1e-9));
    const b = turbinePoint(s, 1, prMin * (1 - 1e-9));
    expect(Math.abs(a.flowParameter / b.flowParameter - 1)).toBeLessThan(1e-6);
    expect(turbinePoint(s, 1, 1).flowParameter).toBe(0);
    expect(turbinePoint(s, 1, 1.2).flowParameter).toBeLessThan(a.flowParameter);
  });
  it('efficiency falls toward zero as the speed goes to zero below the map', () => {
    const s = scaleTurbineMap(LPT_MAP, design);
    const lo = (LPT_MAP.np[0] ?? 0) / LPT_MAP.design.np;
    expect(turbinePoint(s, lo / 2, 4).efficiency).toBeLessThan(turbinePoint(s, lo, 4).efficiency);
    expect(turbinePoint(s, 0, 4).efficiency).toBe(0);
  });
  it('rejects a non-physical design', () => {
    expect(() => scaleTurbineMap(HPT_MAP, { ...design, pressureRatio: 0.9 })).toThrow(/pressure/);
    expect(() => scaleTurbineMap(HPT_MAP, { ...design, efficiency: 0 })).toThrow(/efficiency/);
    expect(() => scaleTurbineMap(HPT_MAP, { ...design, flowParameter: -1 })).toThrow(/flow/);
  });
});
