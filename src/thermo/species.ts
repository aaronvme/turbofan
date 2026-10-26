// NASA 7-coefficient polynomials (cp/R = a1 + a2 T + a3 T^2 + a4 T^3 + a5 T^4, two ranges split
// at 1000 K) for the five species of dry air and its Jet-A combustion products.
//
// Sources:
// - O2, Ar, CO2 and H2O: the GRI-Mech 3.0 thermodynamic data file thermo30.dat (G. P. Smith et al.,
//   UC Berkeley, http://combustion.berkeley.edu/gri-mech/version30/files30/thermo30.dat), NASA-format
//   polynomials valid from 200 K (Ar: constant cp, exact at any T).
// - N2: B. J. McBride, S. Gordon and M. A. Reno, "Coefficients for Calculating Thermodynamic and
//   Transport Properties of Individual Species", NASA TM-4513, 1993, entry TPIS78, 200-1000-6000 K,
//   as distributed in Cantera 3.2.0's nasa_gas.yaml. GRI's own N2 entry (dated 1986) is valid only
//   from 300 K and ran 0.8 % low in cp at 200 K against JANAF (W1C-N1); ISA SLS (288.15 K) and any
//   cold day or altitude far field sit below 300 K.
// a6 and a7 are not used:
// enthalpy and entropy are integrated from cp with continuity at the range break (src/thermo/gas.ts),
// so h(T) is exactly the integral of cp(T) (threshold T4).
//
// Molar masses from the IUPAC 2013 standard atomic weights (C 12.0107, H 1.00794, O 15.9994,
// N 14.0067, Ar 39.948), as NASA CEA uses.

/** CODATA 2018 molar gas constant, J/(mol K). */
export const R_UNIVERSAL = 8.314462618;

export type SpeciesId = 'N2' | 'O2' | 'Ar' | 'CO2' | 'H2O';

export interface Nasa7Species {
  /** 200 to 1000 K: a1..a7. */
  readonly low: readonly number[];
  /** 1000 to 3500 (6000 for N2, any T for Ar) K: a1..a7. */
  readonly high: readonly number[];
}

export const SPECIES: Readonly<Record<SpeciesId, Nasa7Species>> = {
  N2: {
    low: [
      3.53100528, -1.23660987e-4, -5.02999437e-7, 2.43530612e-9, -1.40881235e-12, -1046.97628,
      2.96747468,
    ],
    high: [
      2.95257626, 1.39690057e-3, -4.92631691e-7, 7.86010367e-11, -4.60755321e-15, -923.948645,
      5.87189252,
    ],
  },
  O2: {
    low: [
      3.78245636, -2.99673416e-3, 9.84730201e-6, -9.68129509e-9, 3.24372837e-12, -1063.94356,
      3.65767573,
    ],
    high: [
      3.28253784, 1.48308754e-3, -7.57966669e-7, 2.09470555e-10, -2.16717794e-14, -1088.45772,
      5.45323129,
    ],
  },
  Ar: {
    low: [2.5, 0, 0, 0, 0, -745.375, 4.366],
    high: [2.5, 0, 0, 0, 0, -745.375, 4.366],
  },
  CO2: {
    low: [
      2.35677352, 8.98459677e-3, -7.12356269e-6, 2.45919022e-9, -1.43699548e-13, -48371.9697,
      9.90105222,
    ],
    high: [
      3.85746029, 4.41437026e-3, -2.21481404e-6, 5.23490188e-10, -4.72084164e-14, -48759.166,
      2.27163806,
    ],
  },
  H2O: {
    low: [
      4.19864056, -2.0364341e-3, 6.52040211e-6, -5.48797062e-9, 1.77197817e-12, -30293.7267,
      -0.849032208,
    ],
    high: [
      3.03399249, 2.17691804e-3, -1.64072518e-7, -9.7041987e-11, 1.68200992e-14, -30004.2971,
      4.9667701,
    ],
  },
};

const C = 12.0107;
const H = 1.00794;
const O = 15.9994;
const N = 14.0067;

/** g/mol. */
export const MOLAR_MASS: Readonly<Record<SpeciesId, number>> = {
  N2: 2 * N,
  O2: 2 * O,
  Ar: 39.948,
  CO2: C + 2 * O,
  H2O: 2 * H + O,
};

/** Jet-A as NASA CEA's "Jet-A(g)": C12H23 (Gordon & McBride, NASA RP-1311, 1994). */
export const JET_A = { carbon: 12, hydrogen: 23, molarMass: 12 * C + 23 * H } as const;
