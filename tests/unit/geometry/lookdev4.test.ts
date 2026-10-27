// The look-dev round 4 kinematics: the cutaway keeps the fan blades at the cut faces
// (W1V-I1 fix: only a blade wholly inside the wedge is hidden), and the exploded view eases
// the spools to a stop over about 1 s (D4-4).
import { describe, expect, it } from 'vitest';
import { bladeHidden, cutawayWedge } from '../../../src/geometry/cutaway';
import { SPOOL_STOP_S, spoolDisplayFactor } from '../../../src/geometry/motion';

describe('bladeHidden, rule "inside" (the fan row)', () => {
  const w = cutawayWedge(1, 0, 0.5); // (-0.25, 0.25)
  it('hides a blade wholly inside the wedge', () => {
    expect(bladeHidden(0, -0.05, 0.05, w, 'inside')).toBe(true);
    expect(bladeHidden(0.19, -0.05, 0.05, w, 'inside')).toBe(true); // [0.14, 0.24]
  });
  it('keeps a blade that crosses a cut face (its profile carries the shot)', () => {
    expect(bladeHidden(0.22, -0.05, 0.05, w, 'inside')).toBe(false); // [0.17, 0.27]
    expect(bladeHidden(-0.22, -0.05, 0.05, w, 'inside')).toBe(false);
    // the default rule still hides it whole
    expect(bladeHidden(0.22, -0.05, 0.05, w)).toBe(true);
  });
  it('keeps every blade when the cut is closed, and wider than the wedge', () => {
    expect(bladeHidden(0, -0.05, 0.05, cutawayWedge(0, 0, 0.5), 'inside')).toBe(false);
    expect(bladeHidden(0, -0.3, 0.3, w, 'inside')).toBe(false);
  });
});

describe('spoolDisplayFactor (D4-4: the exploded engine stops)', () => {
  const run = (from: number, stopped: boolean, seconds: number) => {
    let f = from;
    const out: number[] = [];
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      f = spoolDisplayFactor(f, stopped, 1 / 60);
      out.push(f);
    }
    return out;
  };
  it('eases from running to a stop over SPOOL_STOP_S (about 1 s), monotonically', () => {
    expect(SPOOL_STOP_S).toBeGreaterThanOrEqual(0.8);
    expect(SPOOL_STOP_S).toBeLessThanOrEqual(1.2);
    const f = run(1, true, SPOOL_STOP_S);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeLessThanOrEqual(f[i - 1] ?? 1);
    expect(f.at(-1)).toBeCloseTo(0, 9);
    // eased: the first frame slows by less than a linear ramp would
    expect(1 - (f[0] ?? 0)).toBeLessThan(1 / 60 / SPOOL_STOP_S);
  });
  it('spins back up the same way, and holds at the ends', () => {
    const f = run(0, false, SPOOL_STOP_S);
    expect(f.at(-1)).toBeCloseTo(1, 9);
    expect(spoolDisplayFactor(1, false, 1 / 60)).toBe(1);
    expect(spoolDisplayFactor(0, true, 1 / 60)).toBe(0);
  });
  it('is independent of the frame step (dt 1/60 against 1/30)', () => {
    let a = 1;
    let b = 1;
    for (let i = 0; i < 20; i++) a = spoolDisplayFactor(a, true, 1 / 60);
    for (let i = 0; i < 10; i++) b = spoolDisplayFactor(b, true, 1 / 30);
    expect(a).toBeCloseTo(b, 9);
  });
});
