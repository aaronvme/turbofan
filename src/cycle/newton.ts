// Damped Newton-Raphson with a forward-difference Jacobian, for the cycle matching (C7).
// Steps are capped per unknown (maxStep, in the unknown's own units) and backtracked by halving
// while the residual 2-norm does not fall; a residual function that throws (a thermo state out of
// range) counts as an infinite residual during the line search.

export interface NewtonOptions {
  /** Converged when max |residual| is below this. */
  readonly tolerance: number;
  readonly maxIterations: number;
  /** Largest allowed change of each unknown per iteration. */
  readonly maxStep: readonly number[];
  /** Relative finite-difference step (default 1e-7, about sqrt of the residual noise). */
  readonly fdStep?: number;
}

export interface NewtonResult {
  readonly x: number[];
  readonly residual: number[];
  readonly maxResidual: number;
  readonly iterations: number;
  readonly converged: boolean;
}

const maxAbs = (v: readonly number[]): number => v.reduce((m, a) => Math.max(m, Math.abs(a)), 0);
const norm2 = (v: readonly number[]): number => Math.sqrt(v.reduce((s, a) => s + a * a, 0));

/** Solves A x = b by Gaussian elimination with partial pivoting; throws if A is singular. */
export function solveLinear(a: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(m[r]?.[c] ?? 0) > Math.abs(m[p]?.[c] ?? 0)) p = r;
    }
    const pivotRow = m[p] ?? [];
    const pivot = pivotRow[c] ?? 0;
    if (!(Math.abs(pivot) > 1e-300)) throw new Error('singular Jacobian');
    [m[c], m[p]] = [pivotRow, m[c] ?? []];
    for (let r = c + 1; r < n; r++) {
      const row = m[r] ?? [];
      const k = (row[c] ?? 0) / pivot;
      for (let j = c; j <= n; j++) row[j] = (row[j] ?? 0) - k * (pivotRow[j] ?? 0);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] ?? [];
    let s = row[n] ?? 0;
    for (let j = r + 1; j < n; j++) s -= (row[j] ?? 0) * (x[j] ?? 0);
    x[r] = s / (row[r] ?? 1);
  }
  return x;
}

function safe(f: (x: number[]) => number[], x: number[]): number[] | null {
  try {
    const r = f(x);
    return r.every(Number.isFinite) ? r : null;
  } catch {
    return null;
  }
}

export function newton(
  f: (x: number[]) => number[],
  x0: readonly number[],
  opts: NewtonOptions,
): NewtonResult {
  const h = opts.fdStep ?? 1e-7;
  let x = [...x0];
  let r = f(x);
  let iterations = 0;
  while (maxAbs(r) >= opts.tolerance && iterations < opts.maxIterations) {
    iterations++;
    const jac: number[][] = r.map(() => []);
    for (let j = 0; j < x.length; j++) {
      const dxj = h * Math.max(1, Math.abs(x[j] ?? 0));
      const xp = [...x];
      xp[j] = (xp[j] ?? 0) + dxj;
      const rp = f(xp);
      rp.forEach((v, i) => ((jac[i] ?? [])[j] = (v - (r[i] ?? 0)) / dxj));
    }
    let dx: number[];
    try {
      dx = solveLinear(
        jac,
        r.map((v) => -v),
      );
    } catch {
      break;
    }
    let lambda = 1;
    dx.forEach((d, j) => {
      const cap = opts.maxStep[j] ?? Infinity;
      if (Math.abs(d) * lambda > cap) lambda = cap / Math.abs(d);
    });
    const base = norm2(r);
    let accepted: { x: number[]; r: number[] } | null = null;
    for (let k = 0; k < 10; k++) {
      const xn = x.map((v, j) => v + lambda * (dx[j] ?? 0));
      const rn = safe(f, xn);
      if (rn !== null && (norm2(rn) < base || k === 9)) {
        accepted = { x: xn, r: rn };
        break;
      }
      lambda /= 2;
    }
    if (accepted === null) break;
    x = accepted.x;
    r = accepted.r;
  }
  const maxResidual = maxAbs(r);
  return { x, residual: r, maxResidual, iterations, converged: maxResidual < opts.tolerance };
}
