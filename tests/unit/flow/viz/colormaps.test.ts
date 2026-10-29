// Colour maps, legend ticks and the cut-plane quantities of the flow visuals (w2/flowviz).
import { describe, expect, it } from 'vitest';
import {
  colormap,
  COLORMAPS,
  lightnessL,
  niceTicks,
  srgbToLinear,
  type ColormapId,
} from '../../../../src/flow/viz/colormaps';
import {
  deriveQuantities,
  FIELD_QUANTITIES,
  FIELD_QUANTITY_IDS,
  normalizeQuantity,
} from '../../../../src/flow/viz/fields';
import {
  cropAlpha,
  FLOW_VIZ_MODES,
  FLOW_VIZ_MODE_IDS,
  lookModeFor,
  nearFieldCrop,
} from '../../../../src/flow/viz/modes';

const close = (a: readonly number[], b: readonly number[], tol: number) =>
  a.every((v, i) => Math.abs(v - (b[i] ?? NaN)) <= tol);

describe('colour maps', () => {
  it('viridis and inferno match matplotlib at 0, 0.5 and 1 within 0.02', () => {
    // matplotlib _cm_listed.py entries 0, 128 and 255
    expect(close(colormap('viridis', 0), [0.267004, 0.004874, 0.329415], 0.02)).toBe(true);
    expect(close(colormap('viridis', 0.5), [0.128729, 0.563265, 0.551229], 0.02)).toBe(true);
    expect(close(colormap('viridis', 1), [0.993248, 0.906157, 0.143936], 0.02)).toBe(true);
    expect(close(colormap('inferno', 0), [0.001462, 0.000466, 0.013866], 0.02)).toBe(true);
    expect(close(colormap('inferno', 0.5), [0.735683, 0.215906, 0.330245], 0.02)).toBe(true);
    expect(close(colormap('inferno', 1), [0.988362, 0.998364, 0.644924], 0.02)).toBe(true);
  });

  it('the sequential maps rise monotonically in CIE L* (perceptual ordering)', () => {
    for (const id of ['viridis', 'inferno'] as const) {
      let last = -1;
      for (let k = 0; k <= 64; k++) {
        const l = lightnessL(colormap(id, k / 64));
        expect(l).toBeGreaterThan(last);
        last = l;
      }
    }
  });

  it('the diverging map is symmetric in L*, lightest at the centre, and hue-distinct at the ends', () => {
    for (let k = 0; k <= 32; k++) {
      const a = lightnessL(colormap('diverging', k / 64));
      const b = lightnessL(colormap('diverging', 1 - k / 64));
      expect(Math.abs(a - b)).toBeLessThan(1.5);
      if (k > 0) expect(a).toBeGreaterThan(lightnessL(colormap('diverging', (k - 1) / 64)) - 0.01);
    }
    const [r0, , b0] = colormap('diverging', 0);
    const [r1, , b1] = colormap('diverging', 1);
    expect(b0).toBeGreaterThan(r0);
    expect(r1).toBeGreaterThan(b1);
  });

  it('clamps t and stays inside [0, 1]', () => {
    for (const id of Object.keys(COLORMAPS) as ColormapId[])
      for (const t of [-1, 0, 0.3, 1, 2]) {
        const c = colormap(id, t);
        for (const v of c) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    expect(colormap('viridis', -1)).toEqual(colormap('viridis', 0));
  });

  it('converts sRGB to linear with the IEC 61966-2-1 curve', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12);
  });
});

describe('legend ticks', () => {
  it('picks 1-2-5 steps covering the range', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-0.37, 2.4, 6)).toEqual([-0.5, 0, 0.5, 1, 1.5, 2, 2.5]);
    expect(niceTicks(288, 1900, 5)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceTicks(1, 1, 5)).toEqual([1]);
  });
});

describe('cut-plane quantities', () => {
  const ambient = { pPa: 101325, rhoKgPerM3: 1.225, tK: 288.15, fuelAirRatio: 0 };

  it('derives Mach from the thermally perfect speed of sound (ISA SLS: a = 340.3 m/s)', () => {
    const q = deriveQuantities({
      ...ambient,
      uxMPerS: 170.15,
      urMPerS: 0,
      uthetaMPerS: 0,
      fluidFraction: 1,
    });
    expect(q.mach).toBeCloseTo(0.5, 2);
    expect(q.speed).toBeCloseTo(170.15, 9);
  });

  it('includes the swirl in the speed', () => {
    const q = deriveQuantities({
      ...ambient,
      uxMPerS: 3,
      urMPerS: 0,
      uthetaMPerS: 4,
      fluidFraction: 1,
    });
    expect(q.speed).toBeCloseTo(5, 12);
  });

  it('offers p, rho, T, Mach and |u|, each with a perceptual map, a unit and a range', () => {
    expect([...FIELD_QUANTITY_IDS].sort()).toEqual(['mach', 'p', 'rho', 'speed', 't']);
    for (const id of FIELD_QUANTITY_IDS) {
      const s = FIELD_QUANTITIES[id];
      expect(s.unit.length).toBeGreaterThan(0);
      expect(s.max).toBeGreaterThan(s.min);
      expect(Object.keys(COLORMAPS)).toContain(s.colormap);
    }
    // the gauge quantities diverge about the ambient
    expect(FIELD_QUANTITIES.p.colormap).toBe('diverging');
    expect(FIELD_QUANTITIES.t.colormap).toBe('inferno');
  });

  it('normalises into [0, 1], the diverging ones with the ambient at 0.5', () => {
    expect(normalizeQuantity('mach', FIELD_QUANTITIES.mach.min)).toBe(0);
    expect(normalizeQuantity('mach', 1e9)).toBe(1);
    expect(normalizeQuantity('p', 0)).toBeCloseTo(0.5, 12);
  });
});

describe('modes', () => {
  it('has Realistic, Cutaway, Schlieren and Data, each mapped onto a look mode', () => {
    expect([...FLOW_VIZ_MODE_IDS]).toEqual(['realistic', 'cutaway', 'schlieren', 'data']);
    expect(lookModeFor('realistic')).toBe('realistic');
    expect(lookModeFor('cutaway')).toBe('cutaway');
    expect(lookModeFor('data')).toBe('cutaway');
  });

  it('keeps Realistic subtle and puts the legend wherever a field is drawn', () => {
    expect(FLOW_VIZ_MODES.realistic.particleOpacity).toBeLessThanOrEqual(0.35);
    expect(FLOW_VIZ_MODES.realistic.cutPlane).toBe(false);
    expect(FLOW_VIZ_MODES.realistic.haze).toBeGreaterThan(0);
    expect(FLOW_VIZ_MODES.cutaway.cutPlane).toBe(true);
    expect(FLOW_VIZ_MODES.schlieren.schlieren).toBe(true);
    for (const id of FLOW_VIZ_MODE_IDS) {
      const m = FLOW_VIZ_MODES[id];
      expect(m.legend).toBe(m.cutPlane || m.schlieren);
    }
  });

  it('presents nothing synthesized: every mode draws only derived fields (PHYSICS.md 1)', () => {
    for (const id of FLOW_VIZ_MODE_IDS) expect(FLOW_VIZ_MODES[id].synthesized).toEqual([]);
  });

  it('D4-76: data colours composite after tone mapping (display space), the beauty paths before', () => {
    expect(FLOW_VIZ_MODES.data.composite).toBe('display');
    expect(FLOW_VIZ_MODES.cutaway.composite).toBe('display');
    expect(FLOW_VIZ_MODES.realistic.composite).toBe('scene');
    // the schlieren image is its own grey scale with a legend: shown as computed
    expect(FLOW_VIZ_MODES.schlieren.composite).toBe('display');
  });

  it('D4-76: the cut plane is cropped to the near field (a few diameters) by default', () => {
    for (const id of ['data', 'cutaway'] as const) {
      const c = FLOW_VIZ_MODES[id].crop;
      expect(c).not.toBeNull();
      if (c === null) continue;
      // about the nacelle: r out to ~1.2 m, x from a little ahead of the lip to behind the plug
      expect(c.rMax).toBeGreaterThan(1);
      expect(c.rMax).toBeLessThan(1.5);
      expect(c.xMin).toBeLessThan(-0.6);
      expect(c.xMax).toBeGreaterThan(3.6);
      expect(c.fadeM).toBeGreaterThan(0);
    }
    expect(nearFieldCrop(null)).toBeNull();
    expect(cropAlpha({ xMin: -1, xMax: 4, rMax: 1.2, fadeM: 0.2 }, 0, 0.5)).toBe(1);
    expect(cropAlpha({ xMin: -1, xMax: 4, rMax: 1.2, fadeM: 0.2 }, 0, 1.2)).toBe(0);
    expect(cropAlpha({ xMin: -1, xMax: 4, rMax: 1.2, fadeM: 0.2 }, -1.1, 0.5)).toBe(0);
    expect(cropAlpha({ xMin: -1, xMax: 4, rMax: 1.2, fadeM: 0.2 }, 0, 1.1)).toBeCloseTo(0.5, 12);
  });

  it('states the schlieren sensitivity (knife-edge cut-off a/f, rad)', () => {
    expect(FLOW_VIZ_MODES.schlieren.schlierenRangeRad).toBeGreaterThan(0);
    expect(FLOW_VIZ_MODES.schlieren.schlierenRangeRad).toBeLessThan(1e-2);
  });
});
