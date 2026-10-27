// Analytic references for the CPU ladder: the exact Riemann solution of a gamma-law gas (Toro,
// Riemann Solvers and Numerical Methods for Fluid Dynamics, 3rd ed., ch. 4) and quasi-1D isentropic
// nozzle flow with normal shocks (Anderson, Modern Compressible Flow, 3rd ed., ch. 3 and 5).

export interface GasState {
  readonly rho: number;
  readonly u: number;
  readonly p: number;
}

/** The exact solution of the 1D Riemann problem (L | R at x = 0) sampled at xi = x / t. */
export function exactRiemann(L: GasState, R: GasState, gamma: number) {
  const g = gamma;
  const cL = Math.sqrt((g * L.p) / L.rho);
  const cR = Math.sqrt((g * R.p) / R.rho);
  const f = (p: number, s: GasState, c: number): [number, number] => {
    if (p > s.p) {
      const A = 2 / ((g + 1) * s.rho);
      const B = ((g - 1) / (g + 1)) * s.p;
      const q = Math.sqrt(A / (p + B));
      return [(p - s.p) * q, q * (1 - (p - s.p) / (2 * (p + B)))];
    }
    const pr = p / s.p;
    return [
      ((2 * c) / (g - 1)) * (pr ** ((g - 1) / (2 * g)) - 1),
      (1 / (s.rho * c)) * pr ** (-(g + 1) / (2 * g)),
    ];
  };
  let p = 0.5 * (L.p + R.p);
  for (let k = 0; k < 100; k++) {
    const [fl, dl] = f(p, L, cL);
    const [fr, dr] = f(p, R, cR);
    const step = (fl + fr + R.u - L.u) / (dl + dr);
    p = Math.max(1e-12 * L.p, p - step);
    if (Math.abs(step) < 1e-14 * p) break;
  }
  const uStar = 0.5 * (L.u + R.u) + 0.5 * (f(p, R, cR)[0] - f(p, L, cL)[0]);
  const rhoStar = (s: GasState): number =>
    p > s.p
      ? (s.rho * (p / s.p + (g - 1) / (g + 1))) / (((g - 1) / (g + 1)) * (p / s.p) + 1)
      : s.rho * (p / s.p) ** (1 / g);
  const shockSpeedR = R.u + cR * Math.sqrt(((g + 1) / (2 * g)) * (p / R.p) + (g - 1) / (2 * g));
  const sample = (xi: number): GasState => {
    if (xi < uStar) {
      // left of the contact: left rarefaction (Sod)
      const cStar = cL * (p / L.p) ** ((g - 1) / (2 * g));
      if (xi < L.u - cL) return L;
      if (xi > uStar - cStar) return { rho: rhoStar(L), u: uStar, p };
      const u = (2 / (g + 1)) * (cL + ((g - 1) / 2) * L.u + xi);
      const c = (2 / (g + 1)) * (cL + ((g - 1) / 2) * (L.u - xi));
      const rho = L.rho * (c / cL) ** (2 / (g - 1));
      return { rho, u, p: L.p * (c / cL) ** ((2 * g) / (g - 1)) };
    }
    // right of the contact: right shock (Sod)
    return xi < shockSpeedR ? { rho: rhoStar(R), u: uStar, p } : R;
  };
  return { pStar: p, uStar, rhoStarL: rhoStar(L), rhoStarR: rhoStar(R), shockSpeedR, sample };
}

/** A / A* of isentropic flow at Mach M. */
export function areaRatio(M: number, g: number): number {
  return (1 / M) * ((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M)) ** ((g + 1) / (2 * (g - 1)));
}

/** Mach number of area ratio a = A / A* (>= 1) on the sub- or supersonic branch (bisection). */
export function machFromArea(a: number, g: number, supersonic: boolean): number {
  let lo = supersonic ? 1 : 1e-9;
  let hi = supersonic ? 50 : 1;
  for (let k = 0; k < 200; k++) {
    const m = 0.5 * (lo + hi);
    const f = areaRatio(m, g) - a;
    // A/A* falls with M on the subsonic branch and rises on the supersonic one
    if (f > 0 === supersonic) hi = m;
    else lo = m;
  }
  return 0.5 * (lo + hi);
}

export const pOverP0 = (M: number, g: number): number =>
  (1 + ((g - 1) / 2) * M * M) ** (-g / (g - 1));
export const tOverT0 = (M: number, g: number): number => 1 / (1 + ((g - 1) / 2) * M * M);

/** Normal shock: downstream Mach, static and total pressure ratios. */
export function normalShock(M1: number, g: number): { M2: number; p2p1: number; p02p01: number } {
  const m2 = (1 + ((g - 1) / 2) * M1 * M1) / (g * M1 * M1 - (g - 1) / 2);
  const p2p1 = 1 + ((2 * g) / (g + 1)) * (M1 * M1 - 1);
  const M2 = Math.sqrt(m2);
  const p02p01 = (p2p1 * pOverP0(M2, g) ** -1) / pOverP0(M1, g) ** -1;
  return { M2, p2p1, p02p01 };
}

/** Ideal choked mass flow through area A from (p0, T0): A p0 sqrt(g / (R T0)) (2/(g+1))^((g+1)/(2(g-1))). */
export function chokedMassFlow(A: number, p0: number, t0: number, g: number, r: number): number {
  return A * p0 * Math.sqrt(g / (r * t0)) * (2 / (g + 1)) ** ((g + 1) / (2 * (g - 1)));
}
