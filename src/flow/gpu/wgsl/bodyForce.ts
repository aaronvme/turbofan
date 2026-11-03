// WGSL transcription of the blade-row body force (src/flow/coupling/bodyForce.ts cellForce, the
// f64 form of record; PHYSICS.md 3.3 CP1): the same formulas in the same order, in f32. Per cell
// two coefficient vec4s, k0 = (omega, kappa, cN, cP), k1 = (deltaStall, cf2, kRev, kind).
import { BODY_FORCE_KIND, MACH_CAP } from '../../coupling/bodyForce';

const f = (x: number): string => {
  const s = String(x);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

export const BODY_FORCE_WGSL = `
struct BodyForce { f: vec3f, d: vec3f }
const BF_PI = 3.141592653589793;
const BF_MACH_CAP2 = ${f(MACH_CAP * MACH_CAP)};
fn bfWrap(a: f32) -> f32 { return a - 2.0 * BF_PI * floor((a + BF_PI) / (2.0 * BF_PI)); }
fn bfStall(delta: f32, ds: f32) -> f32 {
  let a = abs(delta);
  if (a <= ds) { return delta; }
  let c = cos((0.5 * BF_PI * (a - ds)) / (BF_PI - ds));
  return sign(delta) * ds * c * c;
}
// the force per unit mass (f) and its point-implicit damping (d) at the absolute velocity (u, v, w)
fn bodyForce(u: f32, v: f32, w: f32, r: f32, c: f32, k0: vec4f, k1: vec4f) -> BodyForce {
  var o: BodyForce;
  o.f = vec3f(0.0);
  o.d = vec3f(0.0);
  let kind = k1.w;
  if (kind == ${f(BODY_FORCE_KIND.none)}) { return o; }
  let wt = w - k0.x * r;
  let w2 = u * u + v * v + wt * wt;
  if (w2 == 0.0) { return o; }
  let wm = sqrt(w2);
  let rev = max(0.0, -u / wm);
  var loss = k1.y + k1.z * rev * rev;
  var fx = 0.0;
  var ft = 0.0;
  var dx = 0.0;
  var dt = 0.0;
  if (kind == ${f(BODY_FORCE_KIND.compressor)}) {
    let ds = k1.x;
    let km = 1.0 / sqrt(1.0 - min(w2 / (c * c), BF_MACH_CAP2));
    let delta = bfWrap(atan2(wt, u) - k0.y);
    let dl = min(abs(delta), ds);
    loss += 2.0 * BF_PI * km * dl * dl;
    let a = sqrt(u * u + wt * wt);
    if (a > 0.0) {
      let fnm = k0.z * km * w2 * bfStall(delta, ds);
      fx = (fnm * wt) / a;
      ft = (-fnm * u) / a;
      let dn = (k0.z * km * w2) / a;
      dx = dn;
      dt = dn;
    }
  } else {
    let sk = sin(k0.y);
    let ck = cos(k0.y);
    let rate = k0.z * wm;
    let wn = -u * sk + wt * ck;
    fx = rate * wn * sk;
    ft = -rate * wn * ck;
    dx = rate;
    dt = rate;
  }
  let fp = k0.w * w2 * loss;
  let dp = 2.0 * k0.w * wm * loss;
  o.f = vec3f(fx - (fp * u) / wm, (-fp * v) / wm, ft - (fp * wt) / wm);
  o.d = vec3f(dx + dp, dp, dt + dp);
  return o;
}
`;
