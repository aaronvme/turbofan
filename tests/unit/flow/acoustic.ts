// Fully discrete linear (von Neumann) stability of the tracking iteration on the acoustic family
// at rest (decision D4-30, docs/SOLVER.md section 10): the case where SLAU2's velocity dissipation
// q_bar (beta+ + beta- - 1) rho_bar c_bar is second order and vanishes, so the pseudo-acoustic pair
// is damped only by the mass-flux pressure diffusion chi dp / (2 c_bar f_a) (and, if added, an
// AUSM+-up velocity diffusion K_u f_a c_bar rho_bar dvn / 2). Linearised at rest with c = rho = 1
// and unit cells: MUSCL with central slopes (van Albada in smooth data), face states q +- sigma / 2,
// dimension-split; preconditioning multiplies the pressure increment by beta^2, the local step is
// CFL / lambda with lambda = beta (1 + aspect) (the preconditioned spectral radius at vn = 0 of the
// x faces plus aspect x that of the r faces). The 3-stage scheme alpha = (a1, a2, 1) then maps each
// eigenvalue z of the step's Fourier symbol to G(z) = 1 + z + a2 z^2 + a1 a2 z^3.
// Cross-check: critic probe w2r-l8-vonneumann (Python) gives 0.972 for the matched 1D case, 1.413
// with K_u = 0.5, and D4-8's 1.541 for advection.

export type C = readonly [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const sub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const scale = (s: number, a: C): C => [s * a[0], s * a[1]];
const expi = (t: number): C => [Math.cos(t), Math.sin(t)];

/** The central-slope MUSCL symbols of one direction: the face average and jump, differenced. */
function symbols(t: number): { avg: C; jump: C } {
  const sL = add([1, 0], scale(0.25, sub(expi(t), expi(-t))));
  const sR = sub(expi(t), scale(0.25, sub(expi(2 * t), [1, 0])));
  const d = sub([1, 0], expi(-t));
  return { avg: mul(scale(0.5, add(sL, sR)), d), jump: mul(sub(sR, sL), d) };
}

/** Roots of the monic cubic x^3 + c2 x^2 + c1 x + c0 (Durand-Kerner). */
function cubicRoots(c2: C, c1: C, c0: C): C[] {
  const f = (x: C) => add(mul(add(mul(add(x, c2), x), c1), x), c0);
  let r: C[] = [
    [0.4, 0.9],
    [-0.65, 0.72],
    [0.23, -0.81],
  ];
  for (let it = 0; it < 500; it++) {
    r = r.map((x, i) => {
      let den: C = [1, 0];
      r.forEach((y, j) => {
        if (j !== i) den = mul(den, sub(x, y));
      });
      return sub(x, div(f(x), den));
    });
  }
  return r;
}

export interface AcousticCase {
  /** beta of the preconditioner (1: none). */
  readonly beta: number;
  /** f_a of the mass-flux pressure diffusion (D4-20; 1: unscaled). */
  readonly fa: number;
  /** AUSM+-up velocity diffusion coefficient K_u (0: none). */
  readonly ku: number;
  /** r-face area / x-face area of the cell (0: 1D). */
  readonly aspect: number;
}

/** Eigenvalues z (per unit CFL) of the step's symbol at wave numbers (tx, tr). */
export function stepEigenvalues(k: AcousticCase, tx: number, tr: number): C[] {
  const x = symbols(tx);
  const r = symbols(tr);
  const a = k.aspect;
  const dp = 1 / (2 * k.fa);
  const b2 = k.beta * k.beta;
  const tau = 1 / (k.beta * (1 + a));
  // d(p, u, v)/dtau = M (p, u, v)
  const m11 = scale(b2 * dp, add(x.jump, scale(a, r.jump)));
  const m12 = scale(-b2, x.avg);
  const m13 = scale(-b2 * a, r.avg);
  const m21 = scale(-1, x.avg);
  const m22 = scale(0.5 * k.ku * k.fa, x.jump);
  const m31 = scale(-a, r.avg);
  const m33 = scale(0.5 * k.ku * k.fa * a, r.jump);
  // det(lambda I - M) for M = [[m11, m12, m13], [m21, m22, 0], [m31, 0, m33]]
  const c2 = scale(-1, add(add(m11, m22), m33));
  const c1 = sub(
    add(add(mul(m11, m22), mul(m11, m33)), mul(m22, m33)),
    add(mul(m12, m21), mul(m13, m31)),
  );
  const c0 = scale(
    -1,
    sub(sub(mul(mul(m11, m22), m33), mul(mul(m12, m21), m33)), mul(mul(m13, m31), m22)),
  );
  return cubicRoots(c2, c1, c0).map((z) => scale(tau, z));
}

/** Every step eigenvalue (per unit CFL) over the wave numbers: n x (n + 1) in 2D, n in 1D. */
export function allEigenvalues(k: AcousticCase, n = 96): C[] {
  const out: C[] = [];
  const nr = k.aspect > 0 ? n : 0;
  for (let i = 1; i <= n; i++)
    for (let j = 0; j <= nr; j++)
      out.push(...stepEigenvalues(k, (Math.PI * i) / n, nr > 0 ? (Math.PI * j) / n : 0));
  // the wave numbers (0, j) of the r direction alone
  for (let j = 1; j <= nr; j++) out.push(...stepEigenvalues(k, 0, (Math.PI * j) / n));
  return out;
}

/** max |G(cfl z)| of the 3-stage scheme alpha = (a1, a2, 1) over the eigenvalues z. */
export function maxGainOf(alpha: readonly number[], zs: readonly C[], cfl: number): number {
  const [a1, a2] = alpha as [number, number];
  let worst = 0;
  for (const z1 of zs) {
    const z = scale(cfl, z1);
    const z2 = mul(z, z);
    const g = add(add([1, 0], z), add(scale(a2, z2), scale(a1 * a2, mul(z2, z))));
    worst = Math.max(worst, Math.hypot(g[0], g[1]));
  }
  return worst;
}

/** max |G(cfl z)| over the wave numbers and the eigenvalues. */
export function maxGain(alpha: readonly number[], k: AcousticCase, cfl: number, n = 96): number {
  return maxGainOf(alpha, allEigenvalues(k, n), cfl);
}

/**
 * The largest CFL with max |G| <= 1 + 1e-9 (bisection to 3e-9 on [0.05, 3]; 0 if unstable at
 * CFL 0.05). The eigenvalues are computed once.
 */
export function acousticLimit(alpha: readonly number[], k: AcousticCase, n = 96): number {
  const zs = allEigenvalues(k, n);
  let lo = 0.05;
  let hi = 3;
  if (maxGainOf(alpha, zs, lo) > 1 + 1e-9) return 0;
  for (let it = 0; it < 30; it++) {
    const mid = 0.5 * (lo + hi);
    if (maxGainOf(alpha, zs, mid) <= 1 + 1e-9) lo = mid;
    else hi = mid;
  }
  return lo;
}
