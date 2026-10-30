// Hot-part glow (w2/flowviz round 2): blackbody emission of the hot section at metal
// temperatures taken from the cycle's gas temperatures, through a stated cooling assumption,
// in the studio's scene units through a stated illuminance calibration (PHYSICS.md 1: derived,
// with an assumption). Physically it is dim: below about 800 K (the Draper point) nothing shows.
import { describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../../../src/engine/definition';
import { blackbodyLuminance } from '../../../../src/flow/viz/optics';
import {
  createGlowRadianceCache,
  GLOW_ASSUMPTIONS,
  GLOW_PARTS,
  glowSceneRadiance,
  hotPartTemperatures,
  sceneLuminance,
} from '../../../../src/flow/viz/glow';
import { mockSteadyState } from '../../../../src/mocks/mockCycle';

describe('hotPartTemperatures (metal from the cycle gas temperatures)', () => {
  const takeoff = mockSteadyState(ENGINE_DEFINITION, 1).stations;

  it('cools the HPT airfoils toward the compressor delivery by the stated effectiveness', () => {
    const t = hotPartTemperatures(takeoff);
    const phi = GLOW_ASSUMPTIONS.coolingEffectiveness;
    const t3 = takeoff['3'].ttK;
    expect(t.hptVane).toBeCloseTo(takeoff['4'].ttK - phi * (takeoff['4'].ttK - t3), 9);
    expect(t.hptBlade).toBeCloseTo(takeoff['41'].ttK - phi * (takeoff['41'].ttK - t3), 9);
    expect(t.hptBlade).toBeGreaterThan(t3);
    expect(t.hptBlade).toBeLessThan(takeoff['41'].ttK);
  });

  it('takes the uncooled LPT and exhaust parts at their gas temperature', () => {
    const t = hotPartTemperatures(takeoff);
    expect(t.lptVane).toBe(takeoff['45'].ttK);
    expect(t.lptBlade).toBeCloseTo((takeoff['45'].ttK + takeoff['5'].ttK) / 2, 9);
    expect(t.exhaust).toBe(takeoff['5'].ttK);
    expect(t.plug).toBe(takeoff['5'].ttK);
  });

  it('with no cooling the airfoils are at the gas temperature', () => {
    const t = hotPartTemperatures(takeoff, 0);
    expect(t.hptBlade).toBe(takeoff['41'].ttK);
    expect(GLOW_PARTS).toContain('hptBlade');
  });
});

describe('glowSceneRadiance (blackbody colour x emissivity x luminance, in scene units)', () => {
  const a = GLOW_ASSUMPTIONS;
  const scale = a.sceneKeyIntensity / a.studioKeyLux;

  it('has the luminance emissivity x L_bb(T), scaled by the studio calibration', () => {
    for (const t of [900, 1100, 1300]) {
      const rgb = glowSceneRadiance(t, 0.85);
      expect(sceneLuminance(rgb) / (0.85 * blackbodyLuminance(t) * scale)).toBeCloseTo(1, 9);
    }
  });

  it('is red-orange (red the largest channel) and rises steeply with temperature', () => {
    const lo = glowSceneRadiance(1000, 1);
    const hi = glowSceneRadiance(1200, 1);
    expect(lo[0]).toBeGreaterThan(lo[1]);
    expect(lo[1]).toBeGreaterThanOrEqual(lo[2]);
    expect(sceneLuminance(hi) / sceneLuminance(lo)).toBeGreaterThan(10);
  });

  it('is invisible below the Draper point (798 K): under one 8-bit step of a white wall under the key', () => {
    // a white Lambert wall under the key has radiance intensity / pi; the first 8-bit sRGB step
    // above black is 1 / (255 x 12.92) in linear light
    const wall = a.sceneKeyIntensity / Math.PI;
    expect(sceneLuminance(glowSceneRadiance(790, 1)) / wall).toBeLessThan(1 / (255 * 12.92));
    // and shows (a dull red) by 1100 K
    expect(sceneLuminance(glowSceneRadiance(1100, 1)) / wall).toBeGreaterThan(0.01);
    expect(glowSceneRadiance(300, 1)).toEqual([0, 0, 0]);
  });
});

// W2V-N14: the glow uniforms are set every frame; 12 blackbody integrals per frame cost 0.28 ms of
// CPU at take-off, so a part's radiance is recomputed only when its temperature changes
describe('createGlowRadianceCache', () => {
  it('returns the exact radiance and integrates only on a new temperature or emissivity', () => {
    let calls = 0;
    const cache = createGlowRadianceCache((t, e) => {
      calls++;
      return glowSceneRadiance(t, e);
    });
    const a = cache('hptVane', 1148, 0.4);
    expect(a).toEqual(glowSceneRadiance(1148, 0.4));
    expect(cache('hptVane', 1148, 0.4)).toEqual(a);
    expect(calls).toBe(1);
    cache('lptVane', 1148, 0.4);
    expect(calls).toBe(2);
    expect(cache('hptVane', 1150, 0.4)).toEqual(glowSceneRadiance(1150, 0.4));
    expect(calls).toBe(3);
    cache('hptVane', 1150, 0.85);
    expect(calls).toBe(4);
  });
});
