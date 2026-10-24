// One-dimensional node distributions. Fractions run 0..1 with t[0] = 0 and t[n] = 1 exactly; a
// caller maps them onto a curve by arc length. Stretching ratio = ratio of adjacent spacings.
//
// Two-sided stretching follows Vinokur, "On one-dimensional stretching functions for
// finite-difference calculations", J. Comput. Phys. 50 (1983) 215-234: the tanh family when the end
// slopes are below uniform, the tan family when above, with the discrete end spacings then made
// exact by a Newton correction of the two end slopes.

function checkCount(n: number): void {
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`cell count must be a positive integer, got ${n}`);
}

export function uniform(n: number): Float64Array {
  checkCount(n);
  const t = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) t[k] = k / n;
  t[n] = 1;
  return t;
}

/** Normalise cumulative positions so that t[0] = 0 and t[n] = 1 exactly. */
function normalise(t: Float64Array): Float64Array {
  const n = t.length - 1;
  const total = t[n] ?? 1;
  for (let k = 1; k < n; k++) t[k] = (t[k] ?? 0) / total;
  t[0] = 0;
  t[n] = 1;
  return t;
}

function geometricSum(ds0: number, q: number, n: number): number {
  return Math.abs(q - 1) < 1e-12 ? ds0 * n : (ds0 * (q ** n - 1)) / (q - 1);
}

/** Geometric progression with first spacing `ds0` (fraction of the length) and constant ratio. */
export function geometric(n: number, ds0: number): Float64Array {
  checkCount(n);
  if (!(ds0 > 0 && ds0 < 1) && n > 1) throw new Error(`first spacing ${ds0} must be in (0, 1)`);
  if (Math.abs(ds0 * n - 1) < 1e-13) return uniform(n);
  // ds0 (q^n - 1) / (q - 1) = 1 is monotone increasing in q; bracket and bisect.
  let lo = ds0 * n < 1 ? 1 : 1e-9;
  let hi = ds0 * n < 1 ? 2 : 1;
  while (geometricSum(ds0, hi, n) < 1) hi *= 2;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi);
    if (geometricSum(ds0, mid, n) < 1) lo = mid;
    else hi = mid;
  }
  const q = 0.5 * (lo + hi);
  const t = new Float64Array(n + 1);
  let d = ds0;
  for (let k = 1; k <= n; k++) {
    t[k] = (t[k - 1] ?? 0) + d;
    d *= q;
  }
  return normalise(t);
}

/** Root of sinh(y)/y = b for b > 1, y > 0. */
function solveSinhOverY(b: number): number {
  let lo = 0;
  let hi = 1;
  while (Math.sinh(hi) / hi < b) hi *= 2;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi);
    if (Math.sinh(mid) / mid < b) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Root of sin(y)/y = b for 0 < b < 1, 0 < y < pi. */
function solveSinOverY(b: number): number {
  let lo = 0;
  let hi = Math.PI;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (lo + hi);
    if (Math.sin(mid) / mid > b) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Vinokur's continuous two-sided function with end slopes s'(0) = slope0, s'(1) = slope1. */
function vinokurContinuous(n: number, slope0: number, slope1: number): Float64Array {
  const A = Math.sqrt(slope1 / slope0);
  const B = 1 / Math.sqrt(slope0 * slope1);
  let u: (xi: number) => number;
  if (Math.abs(B - 1) < 1e-12) {
    u = (xi) => xi;
  } else if (B > 1) {
    const dy = solveSinhOverY(B);
    const th = Math.tanh(dy / 2);
    u = (xi) => 0.5 * (1 + Math.tanh(dy * (xi - 0.5)) / th);
  } else {
    const dy = solveSinOverY(B);
    const tn = Math.tan(dy / 2);
    u = (xi) => 0.5 * (1 + Math.tan(dy * (xi - 0.5)) / tn);
  }
  const t = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const uk = u(k / n);
    t[k] = uk / (A + (1 - A) * uk);
  }
  return normalise(t);
}

function endResiduals(t: Float64Array, ds0: number, ds1: number): [number, number] {
  const n = t.length - 1;
  return [
    Math.log(((t[1] ?? 0) - (t[0] ?? 0)) / ds0),
    Math.log(((t[n] ?? 0) - (t[n - 1] ?? 0)) / ds1),
  ];
}

/**
 * Two-sided stretching with exact discrete end spacings `ds0` (first cell) and `ds1` (last cell),
 * both as fractions of the length. Newton iteration in log space on the two end slopes.
 */
export function vinokur(n: number, ds0: number, ds1: number): Float64Array {
  checkCount(n);
  if (n === 1) return uniform(1);
  if (!(ds0 > 0 && ds1 > 0) || ds0 + ds1 >= 1) {
    throw new Error(`end spacings ${ds0}, ${ds1} are impossible for ${n} cells`);
  }
  let a = Math.log(ds0 * n);
  let b = Math.log(ds1 * n);
  let t = vinokurContinuous(n, Math.exp(a), Math.exp(b));
  let [f0, f1] = endResiduals(t, ds0, ds1);
  for (let it = 0; it < 60 && Math.max(Math.abs(f0), Math.abs(f1)) > 1e-13; it++) {
    const h = 1e-7;
    const [fa0, fa1] = endResiduals(vinokurContinuous(n, Math.exp(a + h), Math.exp(b)), ds0, ds1);
    const [fb0, fb1] = endResiduals(vinokurContinuous(n, Math.exp(a), Math.exp(b + h)), ds0, ds1);
    const j00 = (fa0 - f0) / h;
    const j10 = (fa1 - f1) / h;
    const j01 = (fb0 - f0) / h;
    const j11 = (fb1 - f1) / h;
    const det = j00 * j11 - j01 * j10;
    let da = -(j11 * f0 - j01 * f1) / det;
    let db = -(-j10 * f0 + j00 * f1) / det;
    // Damp the step until the residual decreases (keeps extreme requests stable).
    for (let damp = 0; damp < 30; damp++) {
      const trial = vinokurContinuous(n, Math.exp(a + da), Math.exp(b + db));
      const [g0, g1] = endResiduals(trial, ds0, ds1);
      if (Math.max(Math.abs(g0), Math.abs(g1)) < Math.max(Math.abs(f0), Math.abs(f1))) {
        a += da;
        b += db;
        t = trial;
        f0 = g0;
        f1 = g1;
        break;
      }
      da *= 0.5;
      db *= 0.5;
    }
  }
  if (Math.max(Math.abs(f0), Math.abs(f1)) > 1e-10) {
    throw new Error(`vinokur(${n}, ${ds0}, ${ds1}) did not converge`);
  }
  return t;
}

/**
 * Node positions s[0..n] on [0, length] whose spacing follows the target spacing function h(s)
 * (metres). The cell count is round(integral of ds / h) unless `n` is given, in which case the
 * spacing is scaled uniformly to fit. Adjacent-cell ratios are ~ 1 + h'(s), so a smooth h with
 * |h'| <= 0.14 keeps the stretching ratio below 1.15.
 */
export function bySpacing(length: number, h: (s: number) => number, n?: number): Float64Array {
  const M = 8192;
  const G = new Float64Array(M + 1);
  const ds = length / M;
  let prev = 1 / h(0);
  for (let m = 1; m <= M; m++) {
    const cur = 1 / h(m * ds);
    G[m] = (G[m - 1] ?? 0) + 0.5 * (prev + cur) * ds;
    prev = cur;
  }
  const total = G[M] ?? 0;
  const N = n ?? Math.max(1, Math.round(total));
  checkCount(N);
  const s = new Float64Array(N + 1);
  let m = 0;
  for (let k = 1; k < N; k++) {
    const g = (k * total) / N;
    while ((G[m + 1] ?? Infinity) < g) m++;
    const g0 = G[m] ?? 0;
    const g1 = G[m + 1] ?? g0;
    s[k] = (m + (g1 > g0 ? (g - g0) / (g1 - g0) : 0)) * ds;
  }
  s[N] = length;
  return s;
}

/** Largest ratio of adjacent spacings, taken >= 1 in either direction. */
export function maxRatio(t: ArrayLike<number>): number {
  let worst = 1;
  for (let k = 2; k < t.length; k++) {
    const a = (t[k - 1] ?? 0) - (t[k - 2] ?? 0);
    const b = (t[k] ?? 0) - (t[k - 1] ?? 0);
    worst = Math.max(worst, a > b ? a / b : b / a);
  }
  return worst;
}
