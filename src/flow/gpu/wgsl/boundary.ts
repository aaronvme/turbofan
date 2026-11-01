// WGSL of the ghost fill (docs/SOLVER.md section 5; the oracle's src/flow/reference/boundary.ts).
// BOUNDARY_FNS: a ghost's primitives from its source cell(s) and its BC (ghostPrim). The stage
// kernel calls it in its halo load on primitives it computes from U itself (D4-54: no prim or
// ghost pass per stage); BOUNDARY_WGSL adds the ghost pass, one thread per ghost from the primitive
// records of the prim pass, written after the cells (extended index nCells + g), which the read-back
// of the primitives (readPrimitives) still uses. An interface ghost is the neighbour block's cell,
// computed by the same code from the same bits, so both sides of an interface reconstruct alike.

export const BOUNDARY_FNS = /* wgsl */ `
fn farField(s: Prim, n: vec2f) -> Prim {
  let rhoC = P.rhoInf * P.cInf;
  let du = s.a.y;
  let dv = s.a.z;
  let pP = s.b.x;
  let dun = du * n.x + dv * n.y;
  let dut = -du * n.y + dv * n.x;
  let vnInf = P.uInf * n.x;
  let beta2 = P.farBeta2;
  var pb: f32;
  var unb: f32;
  if (beta2 < 1.0) {
    let d = 1.0 - beta2;
    let root = sqrt(d * d * vnInf * vnInf + 4.0 * beta2 * P.cInf * P.cInf);
    let lPlus = 0.5 * ((1.0 + beta2) * vnInf + root);
    let lMinus = 0.5 * ((1.0 + beta2) * vnInf - root);
    let aPlus = P.rhoInf * (lPlus - beta2 * vnInf);
    let aMinus = P.rhoInf * (lMinus - beta2 * vnInf);
    let wPlus = select(0.0, pP + aPlus * dun, lPlus > 0.0);
    let wMinus = select(0.0, pP + aMinus * dun, lMinus > 0.0);
    unb = (wPlus - wMinus) / (aPlus - aMinus);
    pb = wPlus - aPlus * unb;
  } else {
    let wPlus = select(0.0, pP + rhoC * dun, vnInf + P.cInf > 0.0);
    let wMinus = select(0.0, pP - rhoC * dun, vnInf - P.cInf > 0.0);
    pb = 0.5 * (wPlus + wMinus);
    unb = (wPlus - wMinus) / (2.0 * rhoC);
  }
  let outflow = vnInf + unb >= 0.0;
  let c2 = P.cInf * P.cInf;
  let ws = select(0.0, pP - c2 * s.a.x, outflow);
  let utb = select(0.0, dut, outflow);
  return Prim(
    vec4f((pb - ws) / c2, unb * n.x - utb * n.y, unb * n.y + utb * n.x,
          select(0.0, s.a.w, outflow)),
    vec4f(pb, select(0.0, s.b.y, outflow), s.b.z, s.b.w));
}

// the total conditions (p0, t0) of a subsonic inflow ghost: the inflow BC's, or the ambient's
// beyond an outflow face that the flow enters (section 5, W2S-B1). dp0 = p0 - p_inf and
// dT0 = t0 - T_inf in f64 before rounding, cpa = cp of air at t0.
struct Totals { p0: f32, dp0: f32, t0: f32, dT0: f32, cpa: f32 }

// tau = T - t0 on the t0 isentrope at speed sigma: h(t0 + tau) - h(t0) = -sigma^2 / 2
fn stagnationOffset(sigma: f32, tt: Totals) -> f32 {
  let dh = -0.5 * sigma * sigma;
  var tau = dh / tt.cpa;
  for (var k = 0u; k < NEWTON_STEPS; k++) {
    tau -= (enthalpyDelta(tt.t0, tau, 0.0) - dh) / cpMix(tt.t0 + tau, 0.0);
  }
  return tau;
}

// the ghost's gauge pressure on the isentrope (exact zero at sigma = 0 with p0 = p_inf)
fn isentropePressure(tau: f32, tt: Totals) -> f32 {
  return tt.dp0 + tt.p0 * expm1f(entropyDelta(tt.t0, tau, 0.0) / R_AIR);
}

fn subsonicInflow(s: Prim, n: vec2f, tt: Totals) -> Prim {
  let un = (P.uInf + s.a.y) * n.x + s.a.z * n.y;
  let rc = (P.rhoInf + s.a.x) * s.b.w;
  let w = s.b.x + rc * un;
  var sigma = max(0.0, -un);
  for (var k = 0u; k < NEWTON_STEPS; k++) {
    let tau = stagnationOffset(sigma, tt);
    let pb = isentropePressure(tau, tt);
    let rhoB = (P.pInf + pb) / (R_AIR * (tt.t0 + tau));
    sigma = max(0.0, sigma + (pb - rc * sigma - w) / (rhoB * sigma + rc));
  }
  let tau = stagnationOffset(sigma, tt);
  let pP = isentropePressure(tau, tt);
  let tb = tt.t0 + tau;
  let dT = tt.dT0 + tau;
  return Prim(vec4f((pP - P.rhoInf * R_AIR * dT) / (R_AIR * tb), -n.x * sigma - P.uInf,
                    -n.y * sigma, 0.0),
              vec4f(pP, 0.0, dT, soundSpeed(tb, 0.0)));
}

fn inflow(s: Prim, n: vec2f) -> Prim {
  if (P.supersonicInflow == 1u) {
    return Prim(vec4f(0.0), vec4f(0.0, 0.0, 0.0, P.cInf));
  }
  return subsonicInflow(s, n, Totals(P.p0, P.dp0, P.t0, P.dT0, P.cpaT0));
}

// outflow (section 5): the static p_out while subsonic, a copy when supersonic; a face the flow
// enters (vn < 0) takes the inflow ghost at the ambient's totals beyond it, (p_out, T_inf), never
// the cell's own state copied back in (W2S-B1)
fn outflow(s: Prim, n: vec2f) -> Prim {
  let vn = (P.uInf + s.a.y) * n.x + s.a.z * n.y;
  if (vn < 0.0) {
    return subsonicInflow(s, n, Totals(P.pOut, P.pOutGauge, P.tInf, 0.0, P.cpaInf));
  }
  var o = s;
  if (vn < s.b.w) { o.b.x = P.pOutGauge; }
  return o;
}

// slip-wall ghost of layer 1 or 2 from the wall cell q0 and the next cell inwards q1
fn wallGhost(q0: Prim, q1: Prim, n: vec2f, layer: u32) -> Prim {
  let a = select(3.0, 2.0, layer == 1u);
  let b = a - 1.0;
  let u0 = P.uInf + q0.a.y;
  let v0 = q0.a.z;
  let u1 = P.uInf + q1.a.y;
  let v1 = q1.a.z;
  let vt = a * (-u0 * n.y + v0 * n.x) - b * (-u1 * n.y + v1 * n.x);
  let vn = -select(u1 * n.x + v1 * n.y, u0 * n.x + v0 * n.y, layer == 1u);
  return Prim(
    vec4f(a * q0.a.x - b * q1.a.x, (vn * n.x - vt * n.y) - P.uInf, vn * n.y + vt * n.x,
          a * q0.a.w - b * q1.a.w),
    vec4f(a * q0.b.x - b * q1.b.x, a * q0.b.y - b * q1.b.y, q0.b.z, q0.b.w));
}

// the ghost of record (r0, r1) (layout.ts GHOSTS: sources, BC code, layer; the normal's bits) from
// its source cell's primitives s and, for a slip wall, the next cell inwards s1
fn ghostPrim(r0: vec4u, r1: vec4u, s: Prim, s1: Prim) -> Prim {
  let n = vec2f(bitcast<f32>(r1.x), bitcast<f32>(r1.y));
  var o = s;
  switch r0.z {
    case 1u: { o = wallGhost(s, s1, n, r0.w); }
    case 2u: { o.a.z = -s.a.z; }
    case 3u: { o = farField(s, n); }
    case 4u: { o = inflow(s, n); }
    case 5u: { o = outflow(s, n); }
    default: {}
  }
  return o;
}
`;

export const BOUNDARY_WGSL = /* wgsl */ `${BOUNDARY_FNS}
@compute @workgroup_size(64)
fn ghostMain(@builtin(global_invocation_id) gid: vec3u) {
  let g = gid.x;
  if (g >= P.nGhosts) { return; }
  let r0 = topoAt(GHOSTS + 2u * g);
  let r1 = topoAt(GHOSTS + 2u * g + 1u);
  let s = Prim(prim[2u * r0.x], prim[2u * r0.x + 1u]);
  var s1 = s;
  if (r0.z == 1u) { s1 = Prim(prim[2u * r0.y], prim[2u * r0.y + 1u]); }
  let o = ghostPrim(r0, r1, s, s1);
  let e = P.nCells + g;
  prim[2u * e] = o.a;
  prim[2u * e + 1u] = o.b;
}
`;
