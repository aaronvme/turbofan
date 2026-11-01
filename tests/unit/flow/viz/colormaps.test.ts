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
import { gamma, gasConstant } from '../../../../src/thermo/gas';
import {
  airGammaR,
  deriveQuantities,
  GAMMA_R_TABLE,
  FIELD_QUANTITIES,
  FIELD_QUANTITY_IDS,
  normalizeQuantity,
} from '../../../../src/flow/viz/fields';
import {
  CROP_OUTLINE,
  cropAlpha,
  cropDash,
  FLOW_VIZ_MODES,
  FLOW_VIZ_MODE_IDS,
  lookModeFor,
  nearFieldCrop,
  tracersShown,
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

  // W2V-N11: the tested Mach is the drawn one: air's gamma R from the table the shader samples
  // (PHYSICS.md ledger: the cut plane's speed of sound is air's), whatever the fuel-air ratio
  it("uses air's gamma R from the shader's table, nearest entry, at any fuel-air ratio", () => {
    expect(GAMMA_R_TABLE.values.length).toBe(GAMMA_R_TABLE.n);
    for (const tK of [250, 288.15, 900, 1700]) {
      expect(airGammaR(tK) / (gamma(tK, 0) * gasConstant(0))).toBeCloseTo(1, 2);
      const i = Math.round(
        ((tK - GAMMA_R_TABLE.t0) / (GAMMA_R_TABLE.t1 - GAMMA_R_TABLE.t0)) * (GAMMA_R_TABLE.n - 1),
      );
      expect(airGammaR(tK)).toBe(GAMMA_R_TABLE.values[i]);
    }
    const hot = {
      ...ambient,
      tK: 1500,
      uxMPerS: 400,
      urMPerS: 0,
      uthetaMPerS: 0,
      fluidFraction: 1,
    };
    const burnt = deriveQuantities({ ...hot, fuelAirRatio: 0.03 });
    expect(burnt.mach).toBe(deriveQuantities(hot).mach);
    expect(burnt.mach).toBeCloseTo(400 / Math.sqrt(airGammaR(1500) * 1500), 12);
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

  // D4-83: the cinematic view read tracers as hair; they stay as an option there, on by default
  // in the cut modes
  it('gives Realistic no tracers by default (an option), and the cut modes tracers on', () => {
    expect(FLOW_VIZ_MODES.realistic.tracersByDefault).toBe(false);
    expect(FLOW_VIZ_MODES.cutaway.tracersByDefault).toBe(true);
    expect(FLOW_VIZ_MODES.data.tracersByDefault).toBe(true);
    expect(tracersShown(FLOW_VIZ_MODES.realistic, null)).toBe(false);
    expect(tracersShown(FLOW_VIZ_MODES.realistic, true)).toBe(true);
    expect(tracersShown(FLOW_VIZ_MODES.data, null)).toBe(true);
    expect(tracersShown(FLOW_VIZ_MODES.data, false)).toBe(false);
    // the schlieren has none to offer
    expect(FLOW_VIZ_MODES.schlieren.particleOpacity).toBe(0);
    expect(tracersShown(FLOW_VIZ_MODES.schlieren, true)).toBe(false);
    expect(FLOW_VIZ_MODES.realistic.particleOpacity).toBeGreaterThan(0);
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
    }
    expect(nearFieldCrop(null)).toBeNull();
  });

  // D4-83: a crisp edge with a thin outline, not a fade (the fade left a purple fog round the
  // engine: viridis' darkest end out to 1.15 R)
  it('D4-83: the crop has a crisp edge (no fade) and a thin outline', () => {
    const c = { xMin: -1, xMax: 4, rMax: 1.2 };
    expect(cropAlpha(c, 0, 0.5)).toBe(1);
    expect(cropAlpha(c, 0, 1.2 - 1e-3)).toBe(1);
    expect(cropAlpha(c, 0, 1.2 + 1e-3)).toBe(0);
    expect(cropAlpha(c, -1 + 1e-3, 0.5)).toBe(1);
    expect(cropAlpha(c, -1 - 1e-3, 0.5)).toBe(0);
    expect(cropAlpha(c, 4 + 1e-3, 0.5)).toBe(0);
    expect('fadeM' in (FLOW_VIZ_MODES.data.crop ?? {})).toBe(false);
    // the outline: about a pixel, light and translucent (it frames, it does not compete)
    expect(CROP_OUTLINE.widthPx).toBeGreaterThanOrEqual(1);
    expect(CROP_OUTLINE.widthPx).toBeLessThanOrEqual(2);
    expect(CROP_OUTLINE.alpha).toBeGreaterThan(0.3);
    expect(CROP_OUTLINE.alpha).toBeLessThanOrEqual(0.8);
  });

  // W2V-N25 (app-ui round 7): with the floor the outline crossed the empty studio, a solid thin
  // light line, and read as a stray leader beside the callouts' own. Dashed and lighter, it reads
  // as the field's frame (the legend says so: "Not drawn in the dashed frame")
  it('W2V-N25: the outline is dashed and lighter than a leader (the field frame)', () => {
    const { dashM, gapM, alpha } = CROP_OUTLINE;
    // lighter than round 6's 0.55, still over the old floor of 0.3
    expect(alpha).toBeLessThanOrEqual(0.45);
    // a dash of 4-12 px at the app's 90-140 px per metre on the cut plane, more line than gap
    expect(dashM).toBeGreaterThanOrEqual(0.04);
    expect(dashM).toBeLessThanOrEqual(0.09);
    expect(gapM).toBeGreaterThan(0);
    expect(gapM).toBeLessThan(dashM);
    const period = dashM + gapM;
    expect(cropDash(0.5 * dashM)).toBe(1);
    expect(cropDash(dashM + 0.5 * gapM)).toBe(0);
    // periodic along the edge, either side of 0 (the crop starts ahead of the intake, x < 0)
    expect(cropDash(-period + 0.5 * dashM)).toBe(1);
    expect(cropDash(3 * period + dashM + 0.5 * gapM)).toBe(0);
    // over an edge, the share drawn is the dash's
    let on = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) on += cropDash(-2 + (5 * i) / n);
    expect(on / n).toBeCloseTo(dashM / period, 2);
  });

  it('states the schlieren sensitivity (knife-edge cut-off a/f, rad)', () => {
    expect(FLOW_VIZ_MODES.schlieren.schlierenRangeRad).toBeGreaterThan(0);
    expect(FLOW_VIZ_MODES.schlieren.schlierenRangeRad).toBeLessThan(1e-2);
  });

  // W2V-N10: the comment's own estimate of the core jet's deflection (about 1e-3 rad; the
  // critic's probe 9.9e-4) must sit inside the grey scale, not at 2x its range
  it('W2V-N10: a/f covers the estimated core-jet deflection (about 1e-3 rad)', () => {
    expect(FLOW_VIZ_MODES.schlieren.schlierenRangeRad).toBeGreaterThanOrEqual(9.9e-4);
    expect(FLOW_VIZ_MODES.schlieren.schlierenRangeRad).toBeLessThan(2e-3);
  });
});
