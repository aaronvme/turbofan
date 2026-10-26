import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import {
  AIR_MOLE_FRACTIONS,
  GAS_TABLES,
  PRODUCT_MOLE_FRACTIONS,
  STOICH_FAR,
  T_MAX_K,
  T_MIN_K,
  cp,
  enthalpy,
  entropyFunction,
  gamma,
  gasConstant,
  productsMassFraction,
  temperatureFromEnthalpy,
  temperatureFromEntropy,
  isentropicTemperature,
  INVERSE_TOLERANCE_K,
} from '../../../src/thermo/gas';
import { MOLAR_MASS, R_UNIVERSAL, SPECIES } from '../../../src/thermo/species';

/**
 * Reference cp, J/(mol K), from the NIST-JANAF Thermochemical Tables (M. W. Chase, 4th ed.,
 * J. Phys. Chem. Ref. Data Monograph 9, 1998), fetched 2026-10-25 from
 * https://janaf.nist.gov/tables/{N-023,O-029,Ar-001,C-095,H-064}.txt.
 */
const JANAF_CP: Record<string, Record<number, number>> = {
  N2: { 300: 29.125, 500: 29.58, 1000: 32.697, 1500: 34.843, 2000: 35.971 },
  O2: { 300: 29.385, 500: 31.091, 1000: 34.87, 1500: 36.544, 2000: 37.741 },
  Ar: { 300: 20.786, 500: 20.786, 1000: 20.786, 1500: 20.786, 2000: 20.786 },
  CO2: { 300: 37.221, 500: 44.627, 1000: 54.308, 1500: 58.379, 2000: 60.35 },
  H2O: { 300: 33.596, 500: 35.226, 1000: 41.268, 1500: 47.09, 2000: 51.18 },
};
/** JANAF H(T) - H(298.15 K), kJ/mol, same tables. */
const JANAF_DH: Record<string, Record<number, number>> = {
  N2: { 500: 5.911, 1000: 21.463, 1500: 38.405, 2000: 56.137 },
  O2: { 500: 6.084, 1000: 22.703, 1500: 40.599, 2000: 59.175 },
  Ar: { 500: 4.196, 1000: 14.589, 1500: 24.982, 2000: 35.375 },
  CO2: { 500: 8.305, 1000: 33.397, 1500: 61.705, 2000: 91.439 },
  H2O: { 500: 6.925, 1000: 26.0, 1500: 48.151, 2000: 72.79 },
};

/**
 * A frozen ideal mixture, mass basis, J/(kg K): sum x_i cp_i / sum x_i M_i. This is how NASA
 * CEA forms a frozen mixture cp (Gordon & McBride, NASA RP-1311, 1994, eq. 2.59 with frozen
 * composition); the species values are the JANAF ones above, the data CEA's thermo.inp fits
 * for these five species.
 */
function referenceMixture(
  x: Readonly<Record<string, number>>,
  table: Record<string, Record<number, number>>,
  t: number,
  scale: number,
): number {
  let num = 0;
  let mass = 0;
  for (const [s, xi] of Object.entries(x)) {
    const v = table[s]?.[t];
    const m = MOLAR_MASS[s as keyof typeof MOLAR_MASS];
    if (v === undefined) throw new Error(`no reference for ${s} at ${t}`);
    num += xi * v * scale;
    mass += (xi * m) / 1000;
  }
  return num / mass;
}

const T1 = THRESHOLDS.T1.values;
const T3 = THRESHOLDS.T3.values;
const AIR_TEMPS = [T1.temperature1K, T1.temperature2K, T1.temperature3K, T1.temperature4K].map(
  (v) => v.value,
);
const PRODUCT_TEMPS = [T3.temperature1K, T3.temperature2K, T3.temperature3K].map((v) => v.value);

describe('T1: cp of air vs NIST-JANAF', () => {
  for (const t of AIR_TEMPS) {
    it(`${t} K within ${T1.maxRelativeError.token}`, () => {
      const ref = referenceMixture(AIR_MOLE_FRACTIONS, JANAF_CP, t, 1);
      const err = Math.abs(cp(t, 0) / ref - 1);
      expect(err).toBeLessThan(T1.maxRelativeError.value);
    });
  }
});

describe('T2: gamma of air vs NIST-JANAF', () => {
  for (const t of AIR_TEMPS) {
    it(`${t} K within ${THRESHOLDS.T2.values.maxRelativeError.token}`, () => {
      const ref = referenceMixture(AIR_MOLE_FRACTIONS, JANAF_CP, t, 1);
      const r = gasConstant(0);
      const refGamma = ref / (ref - r);
      expect(Math.abs(gamma(t, 0) / refGamma - 1)).toBeLessThan(
        THRESHOLDS.T2.values.maxRelativeError.value,
      );
    });
  }
  it('is 1.40 at 300 K and falls with temperature', () => {
    expect(gamma(300, 0)).toBeCloseTo(1.4, 2);
    expect(gamma(1500, 0)).toBeLessThan(gamma(1000, 0));
  });
});

describe('T3: cp of stoichiometric Jet-A products vs a frozen CEA-style mixture', () => {
  for (const t of PRODUCT_TEMPS) {
    it(`${t} K within ${T3.maxRelativeError.token}`, () => {
      const ref = referenceMixture(PRODUCT_MOLE_FRACTIONS, JANAF_CP, t, 1);
      expect(Math.abs(cp(t, STOICH_FAR) / ref - 1)).toBeLessThan(T3.maxRelativeError.value);
    });
  }
});

describe('sensible enthalpy vs JANAF H - H(298.15)', () => {
  for (const t of [500, 1000, 1500, 2000]) {
    it(`air and products at ${t} K within 0.5 %`, () => {
      const air = referenceMixture(AIR_MOLE_FRACTIONS, JANAF_DH, t, 1000);
      const prod = referenceMixture(PRODUCT_MOLE_FRACTIONS, JANAF_DH, t, 1000);
      expect(Math.abs(enthalpy(t, 0) / air - 1)).toBeLessThan(0.005);
      expect(Math.abs(enthalpy(t, STOICH_FAR) / prod - 1)).toBeLessThan(0.005);
    });
  }
  it('is zero at the 298.15 K reference for any FAR', () => {
    expect(enthalpy(298.15, 0)).toBeCloseTo(0, 9);
    expect(enthalpy(298.15, 0.03)).toBeCloseTo(0, 9);
  });
});

/** Composite Gauss-Legendre (5 points) on n equal panels split at the 1000 K break. */
function integrate(f: (t: number) => number, a: number, b: number, n: number): number {
  const xs = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
  const ws = [
    0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908,
    0.23692688505618908,
  ];
  const cuts = [a, ...[GAS_TABLES.tBreakK].filter((c) => c > a && c < b), b];
  let sum = 0;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const lo = cuts[k] ?? a;
    const hi = cuts[k + 1] ?? b;
    const h = (hi - lo) / n;
    for (let i = 0; i < n; i++) {
      const mid = lo + (i + 0.5) * h;
      xs.forEach((x, j) => {
        sum += (ws[j] ?? 0) * f(mid + (x * h) / 2) * (h / 2);
      });
    }
  }
  return sum;
}

describe('T4: h(T) integrates cp(T)', () => {
  const tol = THRESHOLDS.T4.values.maxRelativeError.value;
  const cases: [number, number, number][] = [
    [300, 900, 0],
    [400, 1600, 0],
    [700, 2000, 0.025],
    [1100, 1900, STOICH_FAR],
    [250, 3000, 0.01],
  ];
  for (const [a, b, far] of cases) {
    it(`h(${b}) - h(${a}) at FAR ${far} within ${tol}`, () => {
      const exact = integrate((t) => cp(t, far), a, b, 64);
      const dh = enthalpy(b, far) - enthalpy(a, far);
      expect(Math.abs(dh / exact - 1)).toBeLessThan(tol);
    });
  }
  it('the entropy function integrates cp/T the same way', () => {
    const exact = integrate((t) => cp(t, 0.02) / t, 350, 1800, 64);
    const ds = entropyFunction(1800, 0.02) - entropyFunction(350, 0.02);
    expect(Math.abs(ds / exact - 1)).toBeLessThan(tol);
  });
});

describe('mixtures by FAR (frozen composition)', () => {
  it('products mass fraction is 0 at FAR 0 and 1 at stoichiometric', () => {
    expect(productsMassFraction(0)).toBe(0);
    expect(productsMassFraction(STOICH_FAR)).toBeCloseTo(1, 12);
    expect(productsMassFraction(STOICH_FAR / 2)).toBeGreaterThan(0.45);
  });
  it('cp, h and R are mass-weighted between air and products', () => {
    const f = 0.025;
    const phi = productsMassFraction(f);
    const mix = (g: (far: number) => number) => (1 - phi) * g(0) + phi * g(STOICH_FAR);
    expect(cp(1200, f)).toBeCloseTo(
      mix((x) => cp(1200, x)),
      9,
    );
    expect(enthalpy(1200, f)).toBeCloseTo(
      mix((x) => enthalpy(1200, x)),
      6,
    );
    expect(gasConstant(f)).toBeCloseTo(
      mix((x) => gasConstant(x)),
      9,
    );
  });
  it('stoichiometric FAR of C12H23 in air is 0.0682 (CEA Jet-A formula)', () => {
    expect(STOICH_FAR).toBeCloseTo(0.0682, 4);
  });
  it('air R matches the ISA value to 1e-4', () => {
    expect(Math.abs(gasConstant(0) / 287.05287 - 1)).toBeLessThan(1e-4);
  });
  it('rejects FAR outside [0, stoichiometric] and T outside the polynomial range', () => {
    expect(() => cp(1000, -0.001)).toThrow(/FAR/);
    expect(() => cp(1000, STOICH_FAR * 1.01)).toThrow(/FAR/);
    expect(() => cp(T_MIN_K - 1, 0)).toThrow(/range/);
    expect(() => enthalpy(T_MAX_K + 1, 0)).toThrow(/range/);
    expect(() => entropyFunction(Number.NaN, 0)).toThrow(/range/);
  });
});

describe('inverse functions (Newton, stated tolerance)', () => {
  it(`T(h) round-trips within ${INVERSE_TOLERANCE_K} K across the range`, () => {
    for (const far of [0, 0.02, STOICH_FAR]) {
      for (const t of [T_MIN_K, 288.15, 999.9, 1000, 1000.1, 1750, T_MAX_K]) {
        const back = temperatureFromEnthalpy(enthalpy(t, far), far);
        expect(Math.abs(back - t)).toBeLessThan(INVERSE_TOLERANCE_K);
      }
    }
  });
  it('T(s, p) round-trips and isentropic compression matches constant gamma at low T', () => {
    const r = gasConstant(0);
    const s = entropyFunction(600, 0) - r * Math.log(5e5 / 101325);
    expect(Math.abs(temperatureFromEntropy(s, 5e5, 0) - 600)).toBeLessThan(INVERSE_TOLERANCE_K);
    const t2 = isentropicTemperature(288.15, 1.2, 0);
    const ideal = 288.15 * Math.pow(1.2, (gamma(300, 0) - 1) / gamma(300, 0));
    expect(Math.abs(t2 - ideal)).toBeLessThan(0.05);
    expect(isentropicTemperature(1500, 1, 0.02)).toBeCloseTo(1500, 9);
  });
  it('rejects targets outside the tabulated range', () => {
    expect(() => temperatureFromEnthalpy(enthalpy(T_MAX_K, 0) + 1e5, 0)).toThrow(/range/);
    expect(() => temperatureFromEnthalpy(enthalpy(T_MIN_K, 0) - 1e5, 0)).toThrow(/range/);
    expect(() => temperatureFromEntropy(1e9, 101325, 0)).toThrow(/range/);
  });
});

describe('coefficient tables for WGSL code generation', () => {
  it('re-evaluating the exported polynomials reproduces cp, h and the entropy function', () => {
    for (const [name, far] of [
      ['air', 0],
      ['products', STOICH_FAR],
    ] as const) {
      const g = GAS_TABLES.gases[name];
      for (const t of [300, 999, 1001, 2500]) {
        const seg = t < GAS_TABLES.tBreakK ? g.low : g.high;
        const [c0, c1, c2, c3, c4] = seg.cp;
        const cpT = c0 + t * (c1 + t * (c2 + t * (c3 + t * c4)));
        const hT =
          seg.hConst + t * (c0 + t * (c1 / 2 + t * (c2 / 3 + t * (c3 / 4 + (t * c4) / 5))));
        const sT =
          seg.sConst + c0 * Math.log(t) + t * (c1 + t * (c2 / 2 + t * (c3 / 3 + (t * c4) / 4)));
        expect(cpT).toBeCloseTo(cp(t, far), 9);
        expect(hT).toBeCloseTo(enthalpy(t, far), 6);
        expect(sT).toBeCloseTo(entropyFunction(t, far), 9);
      }
      expect(g.rJPerKgK).toBeCloseTo(gasConstant(far), 9);
    }
    expect(GAS_TABLES.stoichiometricFar).toBe(STOICH_FAR);
    expect(GAS_TABLES.tMinK).toBe(T_MIN_K);
    expect(GAS_TABLES.tMaxK).toBe(T_MAX_K);
  });
  it('the species table cites five species with two 7-coefficient ranges each', () => {
    expect(Object.keys(SPECIES).sort()).toEqual(['Ar', 'CO2', 'H2O', 'N2', 'O2']);
    for (const s of Object.values(SPECIES)) {
      expect(s.low).toHaveLength(7);
      expect(s.high).toHaveLength(7);
    }
    expect(R_UNIVERSAL).toBeCloseTo(8.314462618, 9);
  });
});
