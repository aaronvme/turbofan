// WGSL of the reconstruction (docs/SOLVER.md section 6) and the SLAU2 face flux (section 7).
//
// Bitwise symmetry in f32 (section 12.1): the two blocks of an interface compute the same face,
// one as F(L, R, S), the other as F(R, L, -S), and their fluxes must be bitwise negations. WGSL
// lets the GPU compiler fuse a * b + c into one fma, which would make a sum like
// rho_L |vn_L| + rho_R |vn_R| depend on which side comes first. Every such L/R sum goes through
// sadd(a, b) = max(a, b) + min(a, b): commutative bitwise, and its operands are not products, so
// nothing can be fused into it. The limiter's denominator sorts the magnitudes for the same reason.
import { f32Lit } from './gas';

/** The limiter (section 6). Only the sharp van Albada switch exists until D4-33 is decided. */
export type LimiterKind = 'vanAlbadaSharp';
export const DEFAULT_LIMITER: LimiterKind = 'vanAlbadaSharp';

export function fluxWgsl(limiter: LimiterKind = DEFAULT_LIMITER): string {
  // the smooth form (D4-25, an oracle option, not the contract: D4-33) is the next LimiterKind
  const known: readonly string[] = ['vanAlbadaSharp'];
  if (!known.includes(limiter)) throw new Error(`limiter ${limiter} is not implemented`);
  return /* wgsl */ `
fn sadd(a: f32, b: f32) -> f32 { return max(a, b) + min(a, b); }
fn sadd4(a: vec4f, b: vec4f) -> vec4f { return max(a, b) + min(a, b); }

// van Albada (1982), the sharp ab > 0 switch: symmetric and odd bitwise
fn vanAlbada4(a: vec4f, b: vec4f) -> vec4f {
  let ab = a * b;
  let hi = max(abs(a), abs(b));
  let lo = min(abs(a), abs(b));
  let r = (ab * (a + b)) / (hi * hi + lo * lo + vec4f(${f32Lit(1e-30)}));
  return select(vec4f(0.0), r, ab > vec4f(0.0));
}

// Limited slopes (sa: rho', u, v, rw; sb.xy: p', Z) of the cell c between m and p, with the
// per-cell positivity fallback: all slopes 0 if q - |sigma|/2 has rho <= 0 or p <= 0 (NaN too).
struct Slope { a: vec4f, b: vec2f }

fn limitedSlopes(ma: vec4f, mb: vec2f, ca: vec4f, cb: vec2f, pa: vec4f, pb: vec2f) -> Slope {
  let sa = vanAlbada4(ca - ma, pa - ca);
  let sb4 = vanAlbada4(vec4f(cb - mb, 0.0, 0.0), vec4f(pb - cb, 0.0, 0.0));
  let rho = P.rhoInf + ca.x;
  let p = P.pInf + cb.x;
  let halfRho = 0.5 * abs(sa.x);
  let halfP = 0.5 * abs(sb4.x);
  if (!(rho - halfRho > 0.0 && p - halfP > 0.0)) { return Slope(vec4f(0.0), vec2f(0.0)); }
  return Slope(sa, sb4.xy);
}

struct Side { rho: f32, vn: f32, q2: f32, c: f32, dh0: f32 }

fn sideOf(a: vec4f, b: vec2f, n: vec2f, rf: f32) -> Side {
  let rhoP = a.x;
  let u = a.y;
  let v = a.z;
  let w = a.w / rf;
  let phi = productsFraction(b.y);
  let tP = temperatureFromPressure(rhoP, b.x, phi);
  let t = P.tInf + tP;
  let cp = cpMix(t, phi);
  let r = gasR(phi);
  var s: Side;
  s.rho = P.rhoInf + rhoP;
  s.vn = u * n.x + v * n.y;
  s.q2 = u * u + v * v + w * w;
  s.c = sqrt((cp * r * t) / (cp - r));
  s.dh0 = deltaH(tP, phi) + 0.5 * dq2(u, v, w);
  return s;
}

fn betaPlus(m: f32) -> f32 {
  if (abs(m) >= 1.0) { return 0.5 * (1.0 + sign(m)); }
  return 0.25 * (2.0 - m) * (m + 1.0) * (m + 1.0);
}

fn betaMinus(m: f32) -> f32 {
  if (abs(m) >= 1.0) { return 0.5 * (1.0 - sign(m)); }
  return 0.25 * (2.0 + m) * (m - 1.0) * (m - 1.0);
}

struct Flux { a: vec4f, b: vec2f }

// SLAU2 (Kitamura & Shima 2013) through a face of unit normal n, per-radian area, radius rf,
// between face states L = (la, lb) and R = (ra, rb); already times the area. machCut < 1: the
// D4-20 low-Mach scaling of the mass-flux pressure diffusion (fa = 1 bitwise at machCut = 1).
fn slau2(la: vec4f, lb: vec2f, ra: vec4f, rb: vec2f, n: vec2f, area: f32, rf: f32,
         machCut: f32) -> Flux {
  if (!(area > 0.0)) { return Flux(vec4f(0.0), vec2f(0.0)); }
  let l = sideOf(la, lb, n, rf);
  let r = sideOf(ra, rb, n, rf);
  let pL = lb.x;
  let pR = rb.x;
  let cbar = 0.5 * sadd(l.c, r.c);
  let mL = l.vn / cbar;
  let mR = r.vn / cbar;
  let qAvg = sqrt(0.5 * sadd(l.q2, r.q2));
  let mHat = min(1.0, qAvg / cbar);
  let chi = (1.0 - mHat) * (1.0 - mHat);
  let g = -max(min(mL, 0.0), -1.0) * min(max(mR, 0.0), 1.0);
  let rhoSum = sadd(l.rho, r.rho);
  let vbar = sadd(l.rho * abs(l.vn), r.rho * abs(r.vn)) / rhoSum;
  let vbarP = (1.0 - g) * vbar + g * abs(l.vn);
  let vbarM = (1.0 - g) * vbar + g * abs(r.vn);
  let mRef = min(1.0, max(qAvg / cbar, machCut));
  let fa = mRef * (2.0 - mRef);
  let mdot = 0.5 * (sadd(l.rho * (l.vn + vbarP), r.rho * (r.vn - vbarM))
    - (chi / (cbar * fa)) * (pR - pL));
  let bp = betaPlus(mL);
  let bm = betaMinus(mR);
  let pt = 0.5 * sadd(pL, pR) + 0.5 * (bp - bm) * (pL - pR)
    + qAvg * (bp + bm - 1.0) * 0.5 * rhoSum * cbar;
  let mp = 0.5 * (mdot + abs(mdot));
  let mm = 0.5 * (mdot - abs(mdot));
  let mom = sadd4(mp * vec4f(1.0, la.y, la.z, la.w), mm * vec4f(1.0, ra.y, ra.z, ra.w));
  let fa4 = vec4f(mp + mm, mom.y + pt * n.x, mom.z + pt * n.y, mom.w);
  let fb = vec2f(sadd(mp * l.dh0, mm * r.dh0), sadd(mp * lb.y, mm * rb.y));
  return Flux(area * fa4, area * fb);
}
`;
}
