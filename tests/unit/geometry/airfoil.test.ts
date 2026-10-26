import { describe, expect, it } from 'vitest';
import {
  airfoilSection,
  camberFraction,
  halfThickness,
  isSimplePolygon,
  PROFILE_FAMILIES,
  type SectionSpec,
} from '../../../src/geometry/airfoil';
import { rowProfileFamily, spanValue } from '../../../src/geometry/blade';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';

const DEG = Math.PI / 180;
const spec = (over: Partial<SectionSpec> = {}): SectionSpec => ({
  family: 'naca65',
  inletAngle: 50 * DEG,
  exitAngle: 20 * DEG,
  maxThickness: 0.08,
  meridionalLength: 0.05,
  pointsPerSide: 25,
  ...over,
});

describe('thickness distributions', () => {
  it.each(PROFILE_FAMILIES)('%s: closed at both edges, peak = tMax / 2', (family) => {
    expect(halfThickness(family, 0, 0.1)).toBe(0);
    expect(halfThickness(family, 1, 0.1)).toBeCloseTo(0, 12);
    let peak = 0;
    for (let k = 0; k <= 1000; k++) peak = Math.max(peak, halfThickness(family, k / 1000, 0.1));
    expect(peak / 0.05 - 1).toBeLessThan(0.01);
    expect(peak / 0.05 - 1).toBeGreaterThan(-0.01);
    // thicker sections are thicker everywhere; NACA forms scale linearly, a DCA does not
    expect(halfThickness(family, 0.3, 0.2)).toBeGreaterThan(halfThickness(family, 0.3, 0.1));
    if (family !== 'dca')
      expect(halfThickness(family, 0.3, 0.2)).toBeCloseTo(2 * halfThickness(family, 0.3, 0.1), 12);
  });

  it('puts the peak where each family has it: NACA 65 at 40 %, DCA at 50 %, turbine at 30 %', () => {
    const argmax = (f: (typeof PROFILE_FAMILIES)[number]) => {
      let best = 0;
      let at = 0;
      for (let k = 0; k <= 1000; k++) {
        const y = halfThickness(f, k / 1000, 0.1);
        if (y > best) {
          best = y;
          at = k / 1000;
        }
      }
      return at;
    };
    expect(argmax('naca65')).toBeCloseTo(0.4, 1);
    expect(argmax('dca')).toBeCloseTo(0.5, 2);
    expect(argmax('turbine')).toBeCloseTo(0.3, 1);
  });

  it('a turbine section has a blunter leading edge than a NACA 65 of the same thickness', () => {
    expect(halfThickness('turbine', 0.01, 0.1)).toBeGreaterThan(halfThickness('naca65', 0.01, 0.1));
    expect(halfThickness('naca65', 0.01, 0.1)).toBeGreaterThan(halfThickness('dca', 0.01, 0.1));
  });

  it('rejects a chord fraction outside [0, 1]', () => {
    expect(() => halfThickness('dca', -0.1, 0.1)).toThrow();
    expect(() => halfThickness('naca65', 1.1, 0.1)).toThrow();
  });
});

describe('camber lines', () => {
  it('compressor camber lines are circular arcs: the slope turns linearly', () => {
    expect(camberFraction('naca65', 0.25)).toBeCloseTo(0.25, 12);
    expect(camberFraction('dca', 0.7)).toBeCloseTo(0.7, 12);
  });
  it('turbine camber lines are front-loaded but end at the metal angles', () => {
    expect(camberFraction('turbine', 0)).toBe(0);
    expect(camberFraction('turbine', 1)).toBeCloseTo(1, 12);
    expect(camberFraction('turbine', 0.3)).toBeGreaterThan(0.3);
  });
});

describe('airfoilSection', () => {
  it('starts at the origin and ends at the meridional length, on the metal angles', () => {
    for (const family of PROFILE_FAMILIES) {
      const s = airfoilSection(spec({ family }));
      const le = s.points[0];
      const te = s.points[s.teIndex];
      expect(le?.m).toBe(0);
      expect(le?.t).toBe(0);
      expect(te?.m).toBeCloseTo(0.05, 12);
      const c0 = s.camber[0];
      const c1 = s.camber[1];
      const cn = s.camber[s.camber.length - 1];
      const cm = s.camber[s.camber.length - 2];
      if (c0 === undefined || c1 === undefined || cn === undefined || cm === undefined)
        throw new Error('no camber');
      expect(Math.atan2(c1.t - c0.t, c1.m - c0.m)).toBeCloseTo(50 * DEG, 2);
      expect(Math.atan2(cn.t - cm.t, cn.m - cm.m)).toBeCloseTo(20 * DEG, 2);
    }
  });

  it('a circular-arc section has its chord at the mean metal angle (the definition stagger)', () => {
    const s = airfoilSection(spec());
    expect(s.chordAngle).toBeCloseTo(35 * DEG, 9);
    expect(s.chord).toBeCloseTo(0.05 / Math.cos(35 * DEG), 9);
  });

  it('has the requested thickness and a positive (counter-clockwise) area', () => {
    for (const family of PROFILE_FAMILIES) {
      const thin = airfoilSection(spec({ family, maxThickness: 0.05 }));
      const thick = airfoilSection(spec({ family, maxThickness: 0.1 }));
      expect(thin.area).toBeGreaterThan(0);
      expect(thick.area / thin.area).toBeCloseTo(2, 1);
      expect(thick.maxThickness / (0.1 * thick.chord)).toBeCloseTo(1, 1);
      expect(isSimplePolygon(thick.points)).toBe(true);
    }
  });

  it('has 2n - 2 loop points, the centroid inside the thickness band', () => {
    const s = airfoilSection(spec({ pointsPerSide: 9 }));
    expect(s.points.length).toBe(16);
    expect(s.teIndex).toBe(8);
    expect(s.centroid.m).toBeGreaterThan(0);
    expect(s.centroid.m).toBeLessThan(0.05);
  });

  it('rejects degenerate specs', () => {
    expect(() => airfoilSection(spec({ pointsPerSide: 2 }))).toThrow();
    expect(() => airfoilSection(spec({ meridionalLength: 0 }))).toThrow();
    expect(() => airfoilSection(spec({ maxThickness: 0 }))).toThrow();
  });

  it('every hub, mid and tip section of the engine is a simple polygon', () => {
    for (const row of def.bladeRows) {
      for (const eta of [0, 0.5, 1]) {
        const s = airfoilSection({
          family: rowProfileFamily(row),
          inletAngle: spanValue(row.inletMetalAngle, eta),
          exitAngle: spanValue(row.exitMetalAngle, eta),
          maxThickness: spanValue(row.maxThicknessRatio, eta),
          meridionalLength: 0.05,
          pointsPerSide: 17,
        });
        expect(isSimplePolygon(s.points), `${row.id} at ${eta}`).toBe(true);
        expect(s.area).toBeGreaterThan(0);
      }
    }
  });
});

describe('isSimplePolygon', () => {
  it('detects a bow tie', () => {
    expect(
      isSimplePolygon([
        { m: 0, t: 0 },
        { m: 1, t: 1 },
        { m: 1, t: 0 },
        { m: 0, t: 1 },
      ]),
    ).toBe(false);
    expect(
      isSimplePolygon([
        { m: 0, t: 0 },
        { m: 1, t: 0 },
        { m: 1, t: 1 },
        { m: 0, t: 1 },
      ]),
    ).toBe(true);
  });
});
