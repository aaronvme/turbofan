// Optics of the flow visuals (w2/flowviz): Gladstone-Dale refraction for the schlieren and the
// heat haze, Planck radiance and its CIE 1931 colour for the blackbody emissive.
import { describe, expect, it } from 'vitest';
import {
  blackbodyChromaticity,
  blackbodyLinearSrgb,
  blackbodyLuminance,
  cieXyzBar,
  edlenRefractivity,
  gladstoneDaleK,
  hazeDeflectionRad,
  planckRadiance,
  refractiveIndex,
  STD_AIR_DENSITY,
} from '../../../../src/flow/viz/optics';

describe('Gladstone-Dale (n - 1 = K rho)', () => {
  it('Edlen 1966 gives the refractivity of standard air: 2.77e-4 at the sodium D line', () => {
    // Edlen, Metrologia 2 (1966) 71, eq. 1: 15 C, 101325 Pa, dry, 0.03 % CO2
    expect(edlenRefractivity(589.3)).toBeGreaterThan(2.76e-4);
    expect(edlenRefractivity(589.3)).toBeLessThan(2.78e-4);
    // normal dispersion: bluer light refracts more
    expect(edlenRefractivity(450)).toBeGreaterThan(edlenRefractivity(650));
  });

  it('K for air is 2.26e-4 m^3/kg (Merzkirch, Flow Visualization, 1987, Table 3.1) within 1 %', () => {
    expect(Math.abs(gladstoneDaleK(589.3) / 2.26e-4 - 1)).toBeLessThan(0.01);
    expect(STD_AIR_DENSITY).toBeCloseTo(1.225, 3);
  });

  it('n follows the density; the ambient-gauge form is exact', () => {
    const k = gladstoneDaleK(550);
    expect(refractiveIndex(STD_AIR_DENSITY, k) - 1).toBeCloseTo(k * STD_AIR_DENSITY, 15);
    // a hot jet (rho / rho_inf = 0.35) refracts less than the ambient air around it
    expect(refractiveIndex(0.35 * 1.225, k)).toBeLessThan(refractiveIndex(1.225, k));
  });

  it('the small-angle ray deflection is K times the path integral of the transverse gradient', () => {
    const k = gladstoneDaleK(550);
    // |grad rho| = 2 kg/m^4 over a 0.5 m path
    expect(hazeDeflectionRad(2, 0.5, k)).toBeCloseTo(k * 2 * 0.5, 15);
    expect(hazeDeflectionRad(0, 0.5, k)).toBe(0);
  });
});

describe('Planck radiance', () => {
  it('peaks at Wien b / T (CODATA b = 2.897771955e-3 m K)', () => {
    const t = 1200;
    const peak = 2.897771955e-3 / t;
    expect(planckRadiance(peak, t)).toBeGreaterThan(planckRadiance(peak * 0.98, t));
    expect(planckRadiance(peak, t)).toBeGreaterThan(planckRadiance(peak * 1.02, t));
  });

  it('integrates to sigma T^4 / pi within 0.1 %', () => {
    const t = 1500;
    let sum = 0;
    const n = 20000;
    const l0 = 1e-7;
    const l1 = 2e-4;
    // log-spaced midpoint rule
    const q = Math.log(l1 / l0) / n;
    for (let i = 0; i < n; i++) {
      const l = l0 * Math.exp((i + 0.5) * q);
      sum += planckRadiance(l, t) * l * q;
    }
    expect(Math.abs(sum / ((5.670374419e-8 * t ** 4) / Math.PI) - 1)).toBeLessThan(1e-3);
  });
});

describe('CIE 1931 colour of a blackbody', () => {
  it('the colour-matching fit reproduces the CIE table (Wyman, Sloan, Shirley 2013)', () => {
    // CIE 1931 2 deg: ybar(555) = 1.0000, xbar(600) = 1.0622, zbar(450) = 1.7471
    expect(cieXyzBar(555)[1]).toBeCloseTo(1.0, 1);
    expect(Math.abs(cieXyzBar(600)[0] / 1.0622 - 1)).toBeLessThan(0.03);
    expect(Math.abs(cieXyzBar(450)[2] / 1.7471 - 1)).toBeLessThan(0.03);
  });

  it('lands on the Planckian locus: CIE illuminant A (2856 K) at (0.4476, 0.4074)', () => {
    const a = blackbodyChromaticity(2856);
    expect(a.x).toBeCloseTo(0.4476, 2);
    expect(a.y).toBeCloseTo(0.4074, 2);
    // and redder when colder (1000 K: x about 0.65)
    expect(blackbodyChromaticity(1000).x).toBeGreaterThan(0.64);
  });

  it('is red-orange in linear sRGB below 3000 K, normalised to a max channel of 1', () => {
    for (const t of [1000, 1500, 2500]) {
      const [r, g, b] = blackbodyLinearSrgb(t);
      expect(r).toBeCloseTo(1, 12);
      expect(g).toBeLessThan(r);
      expect(b).toBeLessThanOrEqual(g);
      expect(b).toBeGreaterThanOrEqual(0);
    }
  });

  it('luminance rises steeply with T, and a 700 K part is invisibly dim next to a 1100 K one', () => {
    const l700 = blackbodyLuminance(700);
    const l1100 = blackbodyLuminance(1100);
    expect(l1100).toBeGreaterThan(1e3 * l700);
    expect(blackbodyLuminance(1300)).toBeGreaterThan(l1100);
    expect(blackbodyLuminance(300)).toBeLessThan(1e-20);
  });
});
