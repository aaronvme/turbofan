// Box-bounded nonlinear least squares (pure, deterministic): minimise 0.5 |r(x)|^2 subject to
// lo <= x <= hi, by a projected Levenberg-Marquardt method. Used by the D3-11 part-power fit
// (src/cycle/partPower.ts, tools/cycle/fit-part-power.ts).
//
// - Variables are scaled to u = (x - lo) / (hi - lo) in [0, 1], so every bound has the same size.
// - The Jacobian is a forward difference in u with a fixed step (backward at the upper bound): no
//   randomness, so the same start always gives the same answer.
// - A variable sitting on a bound whose gradient pushes it outward is held there (the active set);
//   the step on the others solves (J^T J + lambda diag(J^T J)) du = -J^T r, then clips to [0, 1].
// - A step is accepted only if it lowers the cost; lambda shrinks by 3 on success, grows by 3 on
//   failure. A residual function may return null where it cannot be evaluated (a solve that does
//   not converge); that step counts as a failure.
// - Converged: the projected gradient (in u) falls below gradientTolerance, or a successful step
//   lowers the cost by less than costTolerance (relative).

export interface BoundedLsqOptions {
  readonly maxIterations: number;
  /** Finite-difference step in the scaled variable u. */
  readonly step: number;
  readonly gradientTolerance: number;
  readonly costTolerance: number;
  readonly initialLambda: number;
  /** Called after every accepted step (progress output for the fit script). */
  readonly onStep?: (iteration: number, cost: number, x: readonly number[]) => void;
}

export const DEFAULT_LSQ_OPTIONS: BoundedLsqOptions = {
  maxIterations: 50,
  step: 1e-3,
  gradientTolerance: 1e-4,
  costTolerance: 1e-9,
  initialLambda: 1e-2,
};

export interface BoundedLsqResult {
  readonly x: readonly number[];
  readonly residuals: readonly number[];
  /** 0.5 |r|^2 */
  readonly cost: number;
  readonly iterations: number;
  readonly converged: boolean;
  /** Gradient of the cost in the scaled variables u at the answer (J_u^T r). */
  readonly gradient: readonly number[];
  /** -1: held on the lower bound, +1: held on the upper bound, 0: free. */
  readonly active: readonly (-1 | 0 | 1)[];
}

export type ResidualFunction = (x: readonly number[]) => readonly number[] | null;

const cost = (r: readonly number[]): number => 0.5 * r.reduce((a, v) => a + v * v, 0);

function checkBounds(x0: readonly number[], lo: readonly number[], hi: readonly number[]): void {
  if (x0.length !== lo.length || x0.length !== hi.length) {
    throw new Error('boundedLeastSquares: x0, lo and hi must have the same length');
  }
  for (let i = 0; i < x0.length; i++) {
    const [l, h] = [lo[i] ?? NaN, hi[i] ?? NaN];
    if (!(l < h)) throw new Error(`boundedLeastSquares: bound ${i} is empty (${l}, ${h})`);
  }
}

/** Solves the small dense system A x = b by Gaussian elimination with partial pivoting. */
export function solveLinear(a: readonly (readonly number[])[], b: readonly number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(m[r]?.[c] ?? 0) > Math.abs(m[p]?.[c] ?? 0)) p = r;
    }
    const pivotRow = m[p];
    const top = m[c];
    if (pivotRow === undefined || top === undefined) throw new Error('solveLinear: bad shape');
    const pivot = pivotRow[c] ?? 0;
    if (Math.abs(pivot) < 1e-300) throw new Error('solveLinear: singular matrix');
    m[p] = top;
    m[c] = pivotRow;
    for (let r = c + 1; r < n; r++) {
      const row = m[r];
      if (row === undefined) continue;
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

/** A variable on a bound is held there when the gradient pushes it outward. */
function activeSet(u: readonly number[], grad: readonly number[]): (-1 | 0 | 1)[] {
  return u.map((ui, i) => {
    const g = grad[i] ?? 0;
    if (ui <= 0 && g > 0) return -1;
    if (ui >= 1 && g < 0) return 1;
    return 0;
  });
}

export function boundedLeastSquares(
  f: ResidualFunction,
  x0: readonly number[],
  lo: readonly number[],
  hi: readonly number[],
  options: Partial<BoundedLsqOptions> = {},
): BoundedLsqResult {
  checkBounds(x0, lo, hi);
  const o = { ...DEFAULT_LSQ_OPTIONS, ...options };
  const n = x0.length;
  const span = lo.map((l, i) => (hi[i] ?? 0) - l);
  const toX = (u: readonly number[]) => u.map((v, i) => (lo[i] ?? 0) + v * (span[i] ?? 0));
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  let u = x0.map((v, i) => clip((v - (lo[i] ?? 0)) / (span[i] ?? 1)));
  const r0 = f(toX(u));
  if (r0 === null) throw new Error('boundedLeastSquares: the residuals fail at the start point');
  let r = r0;
  let c = cost(r);
  let lambda = o.initialLambda;
  let iterations = 0;
  let converged = false;
  let grad: number[] = new Array<number>(n).fill(0);
  let active: (-1 | 0 | 1)[] = new Array<-1 | 0 | 1>(n).fill(0);

  const jacobian = (): number[][] | null => {
    const cols: number[][] = [];
    for (let i = 0; i < n; i++) {
      const ui = u[i] ?? 0;
      // forward where the bound allows, else backward; the other side if a solve fails there
      const first = ui + o.step <= 1 ? o.step : -o.step;
      let h = first;
      let ri: readonly number[] | null = null;
      for (const tryH of [first, -first]) {
        if (ui + tryH < 0 || ui + tryH > 1) continue;
        const up = [...u];
        up[i] = ui + tryH;
        ri = f(toX(up));
        h = tryH;
        if (ri !== null) break;
      }
      if (ri === null) return null;
      const rr = ri;
      cols.push(rr.map((v, k) => (v - (r[k] ?? 0)) / h));
    }
    return cols; // cols[i][k] = d r_k / d u_i
  };

  for (; iterations < o.maxIterations; iterations++) {
    const jc = jacobian();
    if (jc === null) break;
    grad = jc.map((col) => col.reduce((a, v, k) => a + v * (r[k] ?? 0), 0));
    active = activeSet(u, grad);
    const free = active.map((a, i) => (a === 0 ? i : -1)).filter((i) => i >= 0);
    const projected = Math.hypot(...free.map((i) => grad[i] ?? 0));
    if (free.length === 0 || projected < o.gradientTolerance) {
      converged = true;
      break;
    }
    const jtj = free.map((i) =>
      free.map((j) => (jc[i] ?? []).reduce((a, v, k) => a + v * (jc[j]?.[k] ?? 0), 0)),
    );
    let accepted = false;
    for (let tries = 0; tries < 20 && !accepted; tries++) {
      const a = jtj.map((row, p) =>
        row.map((v, q) => (p === q ? v + lambda * Math.max(v, 1e-12) : v)),
      );
      const du = solveLinear(
        a,
        free.map((i) => -(grad[i] ?? 0)),
      );
      const trial = [...u];
      free.forEach((i, p) => {
        trial[i] = clip((u[i] ?? 0) + (du[p] ?? 0));
      });
      const rt = f(toX(trial));
      const ct = rt === null ? Infinity : cost(rt);
      if (rt !== null && ct < c) {
        const drop = (c - ct) / Math.max(c, 1e-300);
        u = trial;
        r = rt;
        c = ct;
        lambda = Math.max(lambda / 3, 1e-12);
        o.onStep?.(iterations, c, toX(u));
        accepted = true;
        if (drop < o.costTolerance) converged = true;
      } else {
        lambda *= 3;
      }
    }
    if (!accepted) {
      // no descent step at any damping: a (numerical) stationary point
      converged = true;
      iterations++;
      break;
    }
    if (converged) {
      iterations++;
      break;
    }
  }
  // the gradient and the active set at the answer itself (the loop's are one step behind)
  const jEnd = jacobian();
  if (jEnd !== null) {
    grad = jEnd.map((col) => col.reduce((a, v, k) => a + v * (r[k] ?? 0), 0));
    active = activeSet(u, grad);
  }
  return { x: toX(u), residuals: r, cost: c, iterations, converged, gradient: grad, active };
}
