import { describe, expect, it } from 'vitest';
import {
  advanceAngle,
  bladePassFrequencyHz,
  shutterBlurAngle,
  spoolOmega,
} from '../../../src/geometry/motion';
import { explodeOffsets, moduleRank, easeInOut } from '../../../src/geometry/explode';
import { angleInWedge, bladeHidden, cutawayWedge, wrapAngle } from '../../../src/geometry/cutaway';
import { ENGINE_DEFINITION as def } from '../../../src/engine/definition';
import { factValue } from '../../../src/engine/facts';
import { COMPONENT_IDS } from '../../../src/contracts/engine';

describe('spool motion', () => {
  it('turns at N with the definition rotation sign', () => {
    expect(spoolOmega(60, 1)).toBeCloseTo(2 * Math.PI, 12);
    expect(spoolOmega(60, def.rotation.lp)).toBeCloseTo(-2 * Math.PI, 12);
    expect(advanceAngle(0, 60, 1, 0.25)).toBeCloseTo(Math.PI / 2, 12);
    const back = advanceAngle(0, 60, -1, 0.25);
    expect(back).toBeCloseTo(1.5 * Math.PI, 12);
    expect(back).toBeGreaterThanOrEqual(0);
  });

  it('blurs by the angle turned while the shutter is open, at most one revolution', () => {
    // 180 degree shutter at 60 fps: open 1/120 s
    expect(shutterBlurAngle(60, 180, 60)).toBeCloseTo((2 * Math.PI) / 120, 12);
    expect(shutterBlurAngle(0, 180, 60)).toBe(0);
    // 100 % N1 = 5175 rpm: 86 rev/s, 0.72 rev per 1/120 s exposure
    const n1 = def.designPoint.n1Rpm;
    expect(shutterBlurAngle(n1, 180, 60) / (2 * Math.PI)).toBeCloseTo(n1 / 60 / 120, 9);
    expect(shutterBlurAngle(1e6, 360, 24)).toBe(2 * Math.PI);
    expect(() => shutterBlurAngle(60, 400, 60)).toThrow();
  });

  it('blade-pass frequency is count x N / 60 (24 fan blades)', () => {
    expect(bladePassFrequencyHz(factValue('n1ReferenceRpm'), 24)).toBeCloseTo(2070, 0);
  });
});

describe('exploded view', () => {
  it('ranks modules by their axial position, the fan at 0', () => {
    expect(moduleRank(def, 'fan')).toBe(0);
    expect(moduleRank(def, 'inlet')).toBe(-1);
    expect(moduleRank(def, 'booster')).toBe(moduleRank(def, 'bypassDuct'));
    expect(moduleRank(def, 'lpt')).toBeGreaterThan(moduleRank(def, 'hpt'));
    expect(moduleRank(def, null)).toBe(0);
  });

  it('slides modules apart along the shaft, in flow order, zero when assembled', () => {
    const closed = explodeOffsets(def, 0, 0.2);
    const open = explodeOffsets(def, 1, 0.2);
    for (const id of COMPONENT_IDS) expect(closed[id]).toBe(0);
    expect(open.fan).toBe(0);
    expect(open.inlet).toBeLessThan(0);
    expect(open.hpc).toBeGreaterThan(open.booster);
    expect(open.exhaust).toBeGreaterThan(open.lpt);
    expect(open.hpc).toBeCloseTo(0.2 * moduleRank(def, 'hpc'), 12);
    const half = explodeOffsets(def, 0.5, 0.2);
    expect(half.hpc).toBeCloseTo(open.hpc / 2, 12);
  });

  it('eases in and out, clamped to [0, 1]', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });
});

describe('cutaway wedge', () => {
  it('wraps angles into (-pi, pi]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(2 * Math.PI + 0.1)).toBeCloseTo(0.1, 12);
  });

  it('opens from zero to the full width, centred on its angle', () => {
    expect(cutawayWedge(0, Math.PI / 2, 1).halfWidth).toBe(0);
    const w = cutawayWedge(1, Math.PI / 2, 1);
    expect(w.halfWidth).toBeCloseTo(0.5, 12);
    expect(w.center).toBe(Math.PI / 2);
    expect(angleInWedge(Math.PI / 2 + 0.4, w)).toBe(true);
    expect(angleInWedge(Math.PI / 2 + 0.6, w)).toBe(false);
    expect(angleInWedge(Math.PI / 2 - 0.4 + 2 * Math.PI, w)).toBe(true);
  });

  it('hides exactly the blades whose angular extent touches the wedge', () => {
    const w = cutawayWedge(1, 0, 0.5); // theta in (-0.25, 0.25)
    expect(bladeHidden(0, -0.05, 0.05, w)).toBe(true);
    expect(bladeHidden(0.3, -0.04, 0.04, w)).toBe(false); // [0.26, 0.34] misses (-0.25, 0.25)
    expect(bladeHidden(0.3, -0.06, 0.06, w)).toBe(true); // [0.24, 0.36] touches it
    expect(bladeHidden(0.35, -0.05, 0.05, w)).toBe(false);
    expect(bladeHidden(-0.3, -0.06, 0.06, w)).toBe(true);
    expect(bladeHidden(Math.PI, -0.1, 0.1, w)).toBe(false);
    expect(bladeHidden(2 * Math.PI + 0.2, -0.01, 0.01, w)).toBe(true);
    expect(bladeHidden(1, -0.1, 0.1, cutawayWedge(0, 0, 0.5))).toBe(false);
  });
});
