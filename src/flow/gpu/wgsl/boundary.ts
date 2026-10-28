// WGSL of the ghost fill (docs/SOLVER.md section 5; the oracle's src/flow/reference/boundary.ts):
// one thread per ghost, from the primitive records of its source cell(s), written after the cells
// in the same buffer (extended index nCells + g). An interface ghost is a bitwise copy of the
// neighbour block's cell, so both sides of an interface reconstruct from the same bits.

export const BOUNDARY_WGSL = /* wgsl */ `
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

// tau = T - t0 on the t0 isentrope at speed sigma: h(t0 + tau) - h(t0) = -sigma^2 / 2
fn stagnationOffset(sigma: f32) -> f32 {
  let dh = -0.5 * sigma * sigma;
  var tau = dh / P.cpaT0;
  for (var k = 0u; k < NEWTON_STEPS; k++) {
    tau -= (enthalpyDelta(P.t0, tau, 0.0) - dh) / cpMix(P.t0 + tau, 0.0);
  }
  return tau;
}

// the ghost's gauge pressure on the isentrope (exact zero at sigma = 0 with p0 = p_inf)
fn isentropePressure(tau: f32) -> f32 {
  return P.dp0 + P.p0 * expm1f(entropyDelta(P.t0, tau, 0.0) / R_AIR);
}

fn inflow(s: Prim, n: vec2f) -> Prim {
  if (P.supersonicInflow == 1u) {
    return Prim(vec4f(0.0), vec4f(0.0, 0.0, 0.0, P.cInf));
  }
  let un = (P.uInf + s.a.y) * n.x + s.a.z * n.y;
  let rc = (P.rhoInf + s.a.x) * s.b.w;
  let w = s.b.x + rc * un;
  var sigma = max(0.0, -un);
  for (var k = 0u; k < NEWTON_STEPS; k++) {
    let tau = stagnationOffset(sigma);
    let pb = isentropePressure(tau);
    let rhoB = (P.pInf + pb) / (R_AIR * (P.t0 + tau));
    sigma = max(0.0, sigma + (pb - rc * sigma - w) / (rhoB * sigma + rc));
  }
  let tau = stagnationOffset(sigma);
  let pP = isentropePressure(tau);
  let tb = P.t0 + tau;
  let dT = P.dT0 + tau;
  return Prim(vec4f((pP - P.rhoInf * R_AIR * dT) / (R_AIR * tb), -n.x * sigma - P.uInf,
                    -n.y * sigma, 0.0),
              vec4f(pP, 0.0, dT, soundSpeed(tb, 0.0)));
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

@compute @workgroup_size(64)
fn ghostMain(@builtin(global_invocation_id) gid: vec3u) {
  let g = gid.x;
  if (g >= P.nGhosts) { return; }
  let r0 = topoAt(GHOSTS + 2u * g);
  let r1 = topoAt(GHOSTS + 2u * g + 1u);
  let n = vec2f(bitcast<f32>(r1.x), bitcast<f32>(r1.y));
  let s = Prim(prim[2u * r0.x], prim[2u * r0.x + 1u]);
  var o = s;
  switch r0.z {
    case 1u: { o = wallGhost(s, Prim(prim[2u * r0.y], prim[2u * r0.y + 1u]), n, r0.w); }
    case 2u: { o.a.z = -s.a.z; }
    case 3u: { o = farField(s, n); }
    case 4u: { o = inflow(s, n); }
    case 5u: { if ((P.uInf + s.a.y) * n.x + s.a.z * n.y < s.b.w) { o.b.x = P.pOutGauge; } }
    default: {}
  }
  let e = P.nCells + g;
  prim[2u * e] = o.a;
  prim[2u * e + 1u] = o.b;
}
`;
