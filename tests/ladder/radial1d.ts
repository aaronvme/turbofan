// An independent 1D f64 reference for ladder L3 (cylindrical Sod): the Euler equations in
// cylindrical symmetry, d(rU)/dt + d(rF)/dr = (0, p, 0), finite volume on [0, rMax] with HLLC
// fluxes (Toro, ch. 10, Einfeldt wave speeds), MUSCL on primitives with the minmod limiter and
// SSP-RK3. A different flux, limiter and code from the solver under test, at 10x its resolution.

export interface Radial1DResult {
  readonly r: Float64Array;
  readonly rho: Float64Array;
}

export function radialSod(opts: {
  readonly n: number;
  readonly rMax: number;
  readonly rDiaphragm: number;
  readonly inner: { rho: number; p: number };
  readonly outer: { rho: number; p: number };
  readonly gamma: number;
  readonly tEnd: number;
  readonly cfl: number;
}): Radial1DResult {
  const { n, rMax, gamma: g } = opts;
  const dr = rMax / n;
  const rf = Float64Array.from({ length: n + 1 }, (_, k) => k * dr);
  const rc = Float64Array.from({ length: n }, (_, k) => (k + 0.5) * dr);
  const vol = Float64Array.from(
    { length: n },
    (_, k) => 0.5 * ((rf[k + 1] ?? 0) ** 2 - (rf[k] ?? 0) ** 2),
  );
  const U = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    const s = (rc[k] ?? 0) < opts.rDiaphragm ? opts.inner : opts.outer;
    U[3 * k] = s.rho;
    U[3 * k + 1] = 0;
    U[3 * k + 2] = s.p / (g - 1);
  }
  const prim = (k: number, out: Float64Array, o: number): void => {
    // mirror at the axis (k < 0) and at the wall (k >= n): u odd, rho and p even
    const kk = k < 0 ? -1 - k : k >= n ? 2 * n - 1 - k : k;
    const sign = k < 0 || k >= n ? -1 : 1;
    const rho = U[3 * kk] ?? NaN;
    const u = (U[3 * kk + 1] ?? NaN) / rho;
    out[o] = rho;
    out[o + 1] = sign * u;
    out[o + 2] = (g - 1) * ((U[3 * kk + 2] ?? NaN) - 0.5 * rho * u * u);
  };
  const minmod = (a: number, b: number): number =>
    a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b;
  const Q = new Float64Array(3 * (n + 4));
  const flux = new Float64Array(3 * (n + 1));
  const R = new Float64Array(3 * n);
  const residual = (): void => {
    for (let k = -2; k < n + 2; k++) prim(k, Q, 3 * (k + 2));
    for (let f = 0; f <= n; f++) {
      const qL = [0, 0, 0];
      const qR = [0, 0, 0];
      for (let m = 0; m < 3; m++) {
        const a = Q[3 * (f + 1) + m] ?? NaN;
        const am = Q[3 * f + m] ?? NaN;
        const b = Q[3 * (f + 2) + m] ?? NaN;
        const bp = Q[3 * (f + 3) + m] ?? NaN;
        qL[m] = a + 0.5 * minmod(a - am, b - a);
        qR[m] = b - 0.5 * minmod(b - a, bp - b);
      }
      const [rl = 0, ul = 0, pl = 0] = qL;
      const [rr = 0, ur = 0, pr = 0] = qR;
      const cl = Math.sqrt((g * pl) / rl);
      const cr = Math.sqrt((g * pr) / rr);
      const El = pl / (g - 1) + 0.5 * rl * ul * ul;
      const Er = pr / (g - 1) + 0.5 * rr * ur * ur;
      const sL = Math.min(ul - cl, ur - cr);
      const sR = Math.max(ul + cl, ur + cr);
      const sM =
        (pr - pl + rl * ul * (sL - ul) - rr * ur * (sR - ur)) / (rl * (sL - ul) - rr * (sR - ur));
      const F = (r: number, u: number, p: number, E: number) => [r * u, r * u * u + p, u * (E + p)];
      let out: number[];
      if (sL >= 0) out = F(rl, ul, pl, El);
      else if (sR <= 0) out = F(rr, ur, pr, Er);
      else {
        const star = (r: number, u: number, p: number, E: number, s: number) => {
          const k = (r * (s - u)) / (s - sM);
          return [k, k * sM, k * (E / r + (sM - u) * (sM + p / (r * (s - u))))];
        };
        const [U0, U1, U2] = sM >= 0 ? [rl, rl * ul, El] : [rr, rr * ur, Er];
        const Fs = sM >= 0 ? F(rl, ul, pl, El) : F(rr, ur, pr, Er);
        const s = sM >= 0 ? sL : sR;
        const us = sM >= 0 ? star(rl, ul, pl, El, sL) : star(rr, ur, pr, Er, sR);
        out = [
          (Fs[0] ?? 0) + s * ((us[0] ?? 0) - (U0 ?? 0)),
          (Fs[1] ?? 0) + s * ((us[1] ?? 0) - (U1 ?? 0)),
          (Fs[2] ?? 0) + s * ((us[2] ?? 0) - (U2 ?? 0)),
        ];
      }
      for (let m = 0; m < 3; m++) flux[3 * f + m] = (rf[f] ?? 0) * (out[m] ?? 0);
    }
    for (let k = 0; k < n; k++) {
      const p = Q[3 * (k + 2) + 2] ?? NaN;
      for (let m = 0; m < 3; m++)
        R[3 * k + m] = (flux[3 * (k + 1) + m] ?? 0) - (flux[3 * k + m] ?? 0);
      R[3 * k + 1] = (R[3 * k + 1] ?? 0) - p * dr;
    }
  };
  const U0 = new Float64Array(3 * n);
  let t = 0;
  while (t < opts.tEnd) {
    let smax = 0;
    for (let k = 0; k < n; k++) {
      const rho = U[3 * k] ?? NaN;
      const u = (U[3 * k + 1] ?? NaN) / rho;
      const p = (g - 1) * ((U[3 * k + 2] ?? NaN) - 0.5 * rho * u * u);
      smax = Math.max(smax, Math.abs(u) + Math.sqrt((g * p) / rho));
    }
    const dt = Math.min((opts.cfl * dr) / smax, opts.tEnd - t);
    U0.set(U);
    const stages: [number, number][] = [
      [0, 1],
      [0.75, 0.25],
      [1 / 3, 2 / 3],
    ];
    for (const [a, b] of stages) {
      residual();
      for (let k = 0; k < n; k++) {
        for (let m = 0; m < 3; m++) {
          const e = (U[3 * k + m] ?? NaN) - (dt / (vol[k] ?? NaN)) * (R[3 * k + m] ?? NaN);
          U[3 * k + m] = a === 0 ? e : a * (U0[3 * k + m] ?? NaN) + b * e;
        }
      }
    }
    t += dt;
  }
  const rho = Float64Array.from({ length: n }, (_, k) => U[3 * k] ?? NaN);
  return { r: rc, rho };
}
