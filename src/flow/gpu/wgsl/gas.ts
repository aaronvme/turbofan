// WGSL of the solver's gas model and gauge state (docs/SOLVER.md sections 3-4), generated from
// the same GasModel the oracle uses (src/flow/reference/gas.ts, built on src/thermo GAS_TABLES):
// the polynomial coefficients are never written by hand. Every function mirrors the oracle's
// expression order; the ambient gives exact zeros in f32 as in f64.
//
// f32 notes: WGSL's log has an absolute error of 2^-21 near 1, far above f32 rounding for the
// small arguments the inflow isentrope needs, so log1p and expm1 use series where |x| is small.
import type { GasModel } from '../../reference/gas';
import { NEWTON_STEPS } from '../../reference/gas';
import type { GasSegment } from '../../../thermo/gas';

/** A WGSL f32 literal of x rounded to f32 (printed exactly, so the shader does no rounding). */
export function f32Lit(x: number): string {
  const v = Math.fround(x);
  if (!Number.isFinite(v)) throw new Error(`${x} is not a finite f32`);
  const s = Object.is(v, -0) ? '-0.0' : String(v);
  return /[.eE]/.test(s) ? `${s}f` : `${s}.0f`;
}

const vec4 = (a: readonly number[]): string => `vec4f(${a.map(f32Lit).join(', ')})`;

/** Per segment: cp coefficients, enthalpy-secant c_k/(k+1), entropy-secant c_k/k (k >= 1). */
function segmentConsts(name: string, seg: GasSegment): string {
  const [c0, c1, c2, c3, c4] = seg.cp;
  return [
    `const ${name}_CP: vec4f = ${vec4([c0, c1, c2, c3])};`,
    `const ${name}_CP4: f32 = ${f32Lit(c4)};`,
    `const ${name}_H: vec4f = ${vec4([c0, c1 / 2, c2 / 3, c3 / 4])};`,
    `const ${name}_H4: f32 = ${f32Lit(c4 / 5)};`,
    `const ${name}_S: vec4f = ${vec4([c1, c2 / 2, c3 / 3, c4 / 4])};`,
    `const ${name}_C0: f32 = ${f32Lit(c0)};`,
  ].join('\n');
}

function speciesFns(sp: 'AIR' | 'PRD'): string {
  const lo = `${sp}_LO`;
  const hi = `${sp}_HI`;
  const low = sp.toLowerCase();
  return /* wgsl */ `
fn cp_${low}(t: f32) -> f32 {
  if (t < T_BREAK) { return segCp(${lo}_CP, ${lo}_CP4, t); }
  return segCp(${hi}_CP, ${hi}_CP4, t);
}

// h(t0 + tau) - h(t0) as divided differences, across the range break if needed
fn dh_${low}(t0: f32, tau: f32) -> f32 {
  let t = t0 + tau;
  if (t0 < T_BREAK) {
    if (t < T_BREAK) { return tau * secantCp(${lo}_H, ${lo}_H4, t, t0); }
    return (T_BREAK - t0) * secantCp(${lo}_H, ${lo}_H4, T_BREAK, t0)
      + (t - T_BREAK) * secantCp(${hi}_H, ${hi}_H4, t, T_BREAK);
  }
  if (t >= T_BREAK) { return tau * secantCp(${hi}_H, ${hi}_H4, t, t0); }
  return (T_BREAK - t0) * secantCp(${hi}_H, ${hi}_H4, T_BREAK, t0)
    + (t - T_BREAK) * secantCp(${lo}_H, ${lo}_H4, t, T_BREAK);
}

fn ds_${low}(t0: f32, tau: f32) -> f32 {
  let t = t0 + tau;
  if (t0 < T_BREAK) {
    if (t < T_BREAK) { return segDs(${lo}_C0, ${lo}_S, t0, tau); }
    return segDs(${lo}_C0, ${lo}_S, t0, T_BREAK - t0) + segDs(${hi}_C0, ${hi}_S, T_BREAK, t - T_BREAK);
  }
  if (t >= T_BREAK) { return segDs(${hi}_C0, ${hi}_S, t0, tau); }
  return segDs(${hi}_C0, ${hi}_S, t0, T_BREAK - t0) + segDs(${lo}_C0, ${lo}_S, T_BREAK, t - T_BREAK);
}
`;
}

/** Gas constants and functions (needs `P: Params` for the reference state). */
export function gasWgsl(gas: GasModel): string {
  return /* wgsl */ `
// gas: ${gas.name}
const T_BREAK: f32 = ${f32Lit(gas.tBreak)};
const STOICH_FAR: f32 = ${f32Lit(gas.stoichFar)};
const R_AIR: f32 = ${f32Lit(gas.air.r)};
const R_PRD: f32 = ${f32Lit(gas.products.r)};
const NEWTON_STEPS: u32 = ${NEWTON_STEPS}u;
${segmentConsts('AIR_LO', gas.air.low)}
${segmentConsts('AIR_HI', gas.air.high)}
${segmentConsts('PRD_LO', gas.products.low)}
${segmentConsts('PRD_HI', gas.products.high)}

fn segCp(c: vec4f, c4: f32, t: f32) -> f32 {
  return c.x + t * (c.y + t * (c.z + t * (c.w + t * c4)));
}

// (h(t) - h(t0)) / (t - t0) = sum_k c_k/(k+1) P_k, P_0 = 1, P_k = t P_(k-1) + t0^k
fn secantCp(h: vec4f, h4: f32, t: f32, t0: f32) -> f32 {
  let p1 = t + t0;
  let t02 = t0 * t0;
  let p2 = t * p1 + t02;
  let p3 = t * p2 + t02 * t0;
  let p4 = t * p3 + t02 * t02;
  return h.x + h.y * p1 + h.z * p2 + h.w * p3 + h4 * p4;
}

// (phi_s(t) - phi_s(t0) - c0 ln(t / t0)) / (t - t0) = sum_(k>=1) c_k/k P_(k-1)
fn secantS(s: vec4f, t: f32, t0: f32) -> f32 {
  let p1 = t + t0;
  let t02 = t0 * t0;
  let p2 = t * p1 + t02;
  let p3 = t * p2 + t02 * t0;
  return s.x + s.y * p1 + s.z * p2 + s.w * p3;
}

// ln(1 + x): the atanh series where s = x / (2 + x) is small (|s| < 1/3: x in (-1/2, 1)),
// relative error ~1e-10; log elsewhere. Exact zero at x = 0.
fn log1pf(x: f32) -> f32 {
  let s = x / (2.0 + x);
  if (abs(s) < 0.33333334) {
    let s2 = s * s;
    let poly = 1.0 + s2 * (1.0 / 3.0 + s2 * (1.0 / 5.0 + s2 * (1.0 / 7.0 + s2 * (1.0 / 9.0
      + s2 * (1.0 / 11.0 + s2 * (1.0 / 13.0 + s2 * (1.0 / 15.0 + s2 * (1.0 / 17.0))))))));
    return 2.0 * s * poly;
  }
  return log(1.0 + x);
}

// exp(x) - 1: Taylor for |x| < 1/2 (relative error ~1e-10), exp elsewhere. Exact zero at 0.
fn expm1f(x: f32) -> f32 {
  if (abs(x) < 0.5) {
    return x * (1.0 + x * (1.0 / 2.0 + x * (1.0 / 6.0 + x * (1.0 / 24.0 + x * (1.0 / 120.0
      + x * (1.0 / 720.0 + x * (1.0 / 5040.0 + x * (1.0 / 40320.0 + x * (1.0 / 362880.0
      + x * (1.0 / 3628800.0))))))))));
  }
  return exp(x) - 1.0;
}

fn segDs(c0: f32, s: vec4f, t0: f32, tau: f32) -> f32 {
  return c0 * log1pf(tau / t0) + tau * secantS(s, t0 + tau, t0);
}
${speciesFns('AIR')}
${speciesFns('PRD')}

// products mass fraction of fuel-air ratio z (z clamped to [0, f_st])
fn productsFraction(z: f32) -> f32 {
  let zc = clamp(z, 0.0, STOICH_FAR);
  return (zc * (1.0 + STOICH_FAR)) / (STOICH_FAR * (1.0 + zc));
}

fn gasR(phi: f32) -> f32 { return R_AIR + phi * (R_PRD - R_AIR); }

// R(phi) - R_inf. The ambient is air (R_inf = R_AIR), so this is phi (R_p - R_a) exactly; written
// so, not as gasR(phi) - R_inf, because in f32 R_AIR + phi dR keeps only the high bits of a small
// phi dR (at phi 1e-4 a third of it), which put an absolute error of 3e-8 p_inf into every p' and
// 1e-2 into T' of a lean fuel trace (found by the 12.2 oracle comparison). The oracle's f64
// gasConstantMix(phi) - ref.r is the same number to its rounding.
fn gasRDelta(phi: f32) -> f32 { return phi * (R_PRD - R_AIR); }

fn cpMix(t: f32, phi: f32) -> f32 {
  let a = cp_air(t);
  if (phi == 0.0) { return a; }
  return a + phi * (cp_prd(t) - a);
}

// h(t0 + tau, phi) - h(t0, phi)
fn enthalpyDelta(t0: f32, tau: f32, phi: f32) -> f32 {
  let a = dh_air(t0, tau);
  if (phi == 0.0) { return a; }
  return a + phi * (dh_prd(t0, tau) - a);
}

fn entropyDelta(t0: f32, tau: f32, phi: f32) -> f32 {
  let a = ds_air(t0, tau);
  if (phi == 0.0) { return a; }
  return a + phi * (ds_prd(t0, tau) - a);
}

fn soundSpeed(t: f32, phi: f32) -> f32 {
  let cp = cpMix(t, phi);
  let r = gasR(phi);
  return sqrt((cp * r * t) / (cp - r));
}

// Delta h(T', phi) = h(T_inf + T', phi) - h_air(T_inf)
fn deltaH(tP: f32, phi: f32) -> f32 {
  let a = dh_air(P.tInf, tP);
  if (phi == 0.0) { return a; }
  return a + phi * (dh_prd(P.tInf, tP) - a + P.dInf);
}

// Delta e(T', phi) = Delta h - R_inf T' - (R - R_inf) T
fn deltaE(tP: f32, phi: f32) -> f32 {
  let dr = gasRDelta(phi);
  return deltaH(tP, phi) - P.rInf * tP - dr * (P.tInf + tP);
}

// T' with Delta e(T', phi) = de: NEWTON_STEPS Newton steps from the linearised start
fn temperatureGauge(de: f32, phi: f32) -> f32 {
  let r = gasR(phi);
  let dr = gasRDelta(phi);
  let cpInf = P.cpaInf + phi * (P.cppInf - P.cpaInf);
  var tP = (de - phi * P.dInf + dr * P.tInf) / (cpInf - r);
  for (var k = 0u; k < NEWTON_STEPS; k++) {
    tP -= (deltaE(tP, phi) - de) / (cpMix(P.tInf + tP, phi) - r);
  }
  return tP;
}

// T' from the pressure and density gauges: rho R (T_inf + T') = p_inf + p'
fn temperatureFromPressure(rhoP: f32, pP: f32, phi: f32) -> f32 {
  let r = gasR(phi);
  return (pP - rhoP * r * P.tInf - P.rhoInf * P.tInf * gasRDelta(phi)) / ((P.rhoInf + rhoP) * r);
}

fn pressureGauge(rhoP: f32, tP: f32, phi: f32) -> f32 {
  let rho = P.rhoInf + rhoP;
  return rhoP * P.rInf * P.tInf + rho * P.rInf * tP + rho * gasRDelta(phi) * (P.tInf + tP);
}

// q^2 - q_inf^2 from the velocity gauge du = u - u_inf: (u - u_inf)(u + u_inf) + v^2 + w^2
fn dq2(du: f32, v: f32, w: f32) -> f32 {
  return du * (du + 2.0 * P.uInf) + v * v + w * w;
}

// A primitive record: a = (rho', u - u_inf, v, rw), b = (p', Z, T', c)
struct Prim { a: vec4f, b: vec4f }

// conserved (rho', rho u - rho_inf u_inf, rho v, rho r w), (eta, rho Z) of a cell at radius rc ->
// primitives. The momentum and velocity gauges: u - u_inf = ((rho u)' - rho' u_inf) / rho.
fn consToPrim(ua: vec4f, ub: vec2f, rc: f32) -> Prim {
  let rhoP = ua.x;
  let rho = P.rhoInf + rhoP;
  let u = (ua.y - rhoP * P.uInf) / rho;
  let v = ua.z / rho;
  let rw = ua.w / rho;
  let z = ub.y / rho;
  let w = rw / rc;
  let de = (ub.x + rhoP * P.rInf * P.tInf - 0.5 * rho * dq2(u, v, w)) / rho;
  let phi = productsFraction(z);
  let tP = temperatureGauge(de, phi);
  return Prim(vec4f(rhoP, u, v, rw),
              vec4f(pressureGauge(rhoP, tP, phi), z, tP, soundSpeed(P.tInf + tP, phi)));
}
`;
}
