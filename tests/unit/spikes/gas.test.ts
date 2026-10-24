import { describe, expect, it } from 'vitest';
import { GAS_R, T_MID, cpH, freestream, tempFromE } from '../../../spikes/lib/gas';

describe('placeholder thermally perfect gas (shape of the NASA-7 form, not real data)', () => {
  it('is continuous in cp and h at the range boundary', () => {
    for (const y of [0, 0.5, 1]) {
      const lo = cpH(T_MID - 1e-6, y);
      const hi = cpH(T_MID + 1e-6, y);
      expect(Math.abs(lo.cp - hi.cp)).toBeLessThan(1e-3);
      expect(Math.abs(lo.h - hi.h)).toBeLessThan(1e-3);
    }
  });

  it('cp is dh/dT in both ranges', () => {
    for (const T of [300, 800, 1400, 2000]) {
      const d = (cpH(T + 1e-3, 0.3).h - cpH(T - 1e-3, 0.3).h) / 2e-3;
      expect(d).toBeCloseTo(cpH(T, 0.3).cp, 4);
    }
  });

  it('has air-like magnitudes (cp about 1000 J/kg/K at 300 K)', () => {
    expect(cpH(300, 0).cp).toBeGreaterThan(950);
    expect(cpH(300, 0).cp).toBeLessThan(1050);
    expect(GAS_R).toBe(287.05);
  });

  it('tempFromE inverts e(T) = h(T) - R T with a few Newton steps', () => {
    for (const T of [250, 288.15, 950, 1600]) {
      const e = cpH(T, 0.2).h - GAS_R * T;
      expect(tempFromE(e, 0.2, 288.15, 717)).toBeCloseTo(T, 6);
    }
  });

  it('freestream: rho = p / (R T), h0 = h + q^2 / 2, c from gamma', () => {
    const f = freestream(288.15, 101325, 100);
    expect(f.rho).toBeCloseTo(101325 / (287.05 * 288.15), 12);
    expect(f.h0).toBeCloseTo(cpH(288.15, 0).h + 5000, 9);
    expect(f.e).toBeCloseTo(cpH(288.15, 0).h - 287.05 * 288.15, 9);
    expect(f.c).toBeCloseTo(Math.sqrt(f.gamma * 287.05 * 288.15), 12);
    expect(f.cv).toBeCloseTo(cpH(288.15, 0).cp - 287.05, 12);
  });
});
