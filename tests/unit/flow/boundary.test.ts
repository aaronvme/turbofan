// Ghost-cell boundary conditions (docs/SOLVER.md section 5).
import { describe, expect, it } from 'vitest';
import { BC } from '../../../tools/mesh/types';
import { boundaryParams, ghostPrimitive, wallGhost } from '../../../src/flow/reference/boundary';
import {
  THERMALLY_PERFECT,
  caloricallyPerfectGas,
  referenceState,
} from '../../../src/flow/reference/gas';
import { NP, physicalToPrim } from '../../../src/flow/reference/state';

const ambient = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});
const cruise = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 170,
});

function ghost(
  ref: typeof ambient,
  code: number,
  q: Float64Array,
  nx: number,
  nr: number,
  params = boundaryParams(ref),
): Float64Array {
  const out = new Float64Array(NP);
  ghostPrimitive(ref, params, code, q, 0, nx, nr, out, 0);
  return out;
}

const NORMALS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0.6, -0.8],
];

describe('boundary conditions', () => {
  it('interface: a plain copy', () => {
    const q = physicalToPrim(ambient, { rho: 0.9, u: 30, v: -4, w: 7, p: 9e4, z: 0.01 }, 1);
    expect(Array.from(ghost(ambient, BC.INTERFACE, q, 1, 0))).toEqual(Array.from(q));
  });

  it('slip wall: reflects the normal velocity, keeps the tangential one and the scalars', () => {
    const q = physicalToPrim(ambient, { rho: 0.9, u: 30, v: -4, w: 7, p: 9e4, z: 0.01 }, 1);
    for (const [nx, nr] of NORMALS) {
      const P2 = new Float64Array(2 * NP);
      P2.set(q, 0);
      P2.set(q, NP);
      const g = new Float64Array(NP);
      wallGhost(P2, 0, NP, nx, nr, 1, g, 0);
      const vn = (q[1] ?? 0) * nx + (q[2] ?? 0) * nr;
      const vt = -(q[1] ?? 0) * nr + (q[2] ?? 0) * nx;
      expect((g[1] ?? 0) * nx + (g[2] ?? 0) * nr).toBeCloseTo(-vn, 12);
      expect(-(g[1] ?? 0) * nr + (g[2] ?? 0) * nx).toBeCloseTo(vt, 12);
      for (const k of [0, 3, 4, 5]) expect(g[k]).toBeCloseTo(q[k] ?? NaN, 9);
    }
    expect(() => ghost(ambient, BC.SLIP_WALL, q, 1, 0)).toThrow(/wallGhost/);
  });

  it('axis: negates the radial velocity only', () => {
    const q = physicalToPrim(ambient, { rho: 0.9, u: 30, v: -4, w: 7, p: 9e4, z: 0.01 }, 0.01);
    const g = ghost(ambient, BC.AXIS, q, 0, -1);
    expect(g[2]).toBe(-(q[2] ?? NaN));
    for (const k of [0, 1, 3, 4, 5]) expect(g[k]).toBe(q[k]);
  });

  it('far field: returns the free stream exactly for a free-stream cell', () => {
    for (const ref of [ambient, cruise]) {
      const q = physicalToPrim(ref, { rho: ref.rho, u: ref.u, v: 0, w: 0, p: ref.p, z: 0 }, 2);
      for (const [nx, nr] of NORMALS) {
        const g = ghost(ref, BC.FARFIELD, q, nx, nr);
        expect(g[0] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0).toBe(true);
        expect(g[1]).toBe(ref.u);
      }
    }
  });

  it('far field: lets an outgoing acoustic wave through and removes an incoming one', () => {
    const { rho, c } = ambient;
    const pP = 50;
    // outgoing along +r (outward normal +r): p' = rho c u_n, rho' = p'/c^2
    const out = physicalToPrim(
      ambient,
      { rho: rho + pP / c ** 2, u: 0, v: pP / (rho * c), w: 0, p: ambient.p + pP, z: 0 },
      1,
    );
    const g = ghost(ambient, BC.FARFIELD, out, 0, 1);
    expect(g[4]).toBeCloseTo(pP, 9);
    expect(g[2]).toBeCloseTo(pP / (rho * c), 12);
    expect(g[0]).toBeCloseTo(pP / c ** 2, 12);
    // incoming (moving inwards with p' = -rho c u_n): the boundary keeps nothing of it
    const inc = physicalToPrim(
      ambient,
      { rho: rho + pP / c ** 2, u: 0, v: -pP / (rho * c), w: 0, p: ambient.p + pP, z: 0 },
      1,
    );
    const h = ghost(ambient, BC.FARFIELD, inc, 0, 1);
    expect(Math.abs(h[4] ?? NaN)).toBeLessThan(1e-9);
    expect(Math.abs(h[2] ?? NaN)).toBeLessThan(1e-12);
  });

  it('far field: takes swirl and fuel from inside on outflow and the free stream’s on inflow', () => {
    const q = physicalToPrim(
      cruise,
      { rho: cruise.rho, u: cruise.u, v: 0, w: 20, p: cruise.p, z: 0.01 },
      1,
    );
    const downstream = ghost(cruise, BC.FARFIELD, q, 1, 0);
    expect(downstream[3]).toBe(q[3]);
    expect(downstream[5]).toBe(q[5]);
    const upstream = ghost(cruise, BC.FARFIELD, q, -1, 0);
    expect(upstream[3]).toBe(0);
    expect(upstream[5]).toBe(0);
  });

  it('inflow: total pressure and temperature from the parameters, the outgoing characteristic from inside', () => {
    const gas = caloricallyPerfectGas(1.4, 287.05287);
    const ref = referenceState(gas, { pressure: 1e5, temperature: 300, velocity: 0 });
    const params = boundaryParams(ref, { inflowTotal: { p0: 1.5e5, t0: 400 } });
    const q = physicalToPrim(ref, { rho: 1, u: 10, v: 3, w: 9, p: 1.2e5, z: 0.02 }, 1);
    const g = ghost(ref, BC.INFLOW, q, -1, 0, params);
    // p' + rho c u_n of the cell (u_n = -u along the outward normal -x) is carried to the ghost
    const rc = (ref.rho + (q[0] ?? NaN)) * (q[7] ?? NaN);
    const wCell = (q[4] ?? NaN) - rc * (q[1] ?? NaN);
    // 3 Newton steps from the cell's speed (here 10 against the ghost's 230 m/s): 1e-7 relative
    expect(Math.abs((g[4] ?? NaN) - rc * (g[1] ?? NaN) - wCell)).toBeLessThan(
      1e-6 * Math.abs(wCell),
    );
    const rho = ref.rho + (g[0] ?? NaN);
    const p = ref.p + (g[4] ?? NaN);
    const T = p / (rho * 287.05287);
    const cp = (1.4 * 287.05287) / 0.4;
    const u = g[1] ?? NaN;
    expect(T + (u * u) / (2 * cp)).toBeCloseTo(400, 8);
    expect(p * (400 / T) ** 3.5).toBeCloseTo(1.5e5, 4);
    expect(u).toBeGreaterThan(0);
    expect(g[2] === 0 && g[3] === 0 && g[5] === 0).toBe(true);
  });

  it('inflow at the free-stream totals reproduces the free stream (thermally perfect)', () => {
    const q = physicalToPrim(
      cruise,
      { rho: cruise.rho, u: cruise.u, v: 0, w: 0, p: cruise.p, z: 0 },
      1,
    );
    const g = ghost(cruise, BC.INFLOW, q, -1, 0);
    expect(Math.abs(g[0] ?? NaN)).toBeLessThan(1e-12);
    expect(g[1]).toBeCloseTo(cruise.u, 9);
    const q0 = physicalToPrim(
      ambient,
      { rho: ambient.rho, u: 0, v: 0, w: 0, p: ambient.p, z: 0 },
      1,
    );
    const g0 = ghost(ambient, BC.INFLOW, q0, -1, 0);
    for (let k = 0; k < 6; k++) expect(g0[k] === 0).toBe(true);
  });

  it('outflow: ambient (or given) static pressure when subsonic, a copy when supersonic', () => {
    const sub = physicalToPrim(ambient, { rho: 1.1, u: 100, v: 0, w: 4, p: 1.1e5, z: 0.01 }, 1);
    const g = ghost(ambient, BC.OUTFLOW, sub, 1, 0);
    expect(g[4] === 0).toBe(true);
    expect(g[1]).toBe(sub[1]);
    const given = ghost(
      ambient,
      BC.OUTFLOW,
      sub,
      1,
      0,
      boundaryParams(ambient, { outflowPressure: 9e4 }),
    );
    expect(given[4]).toBeCloseTo(9e4 - ambient.p, 9);
    const sup = physicalToPrim(ambient, { rho: 1.1, u: 600, v: 0, w: 0, p: 1.1e5, z: 0 }, 1);
    expect(Array.from(ghost(ambient, BC.OUTFLOW, sup, 1, 0))).toEqual(Array.from(sup));
    // the face at rest (vn = 0) is still an outflow face: the copy at p_out
    const still = physicalToPrim(ambient, { rho: 0.7, u: 0, v: 0, w: 4, p: 1.1e5, z: 0.01 }, 1);
    const g0 = ghost(ambient, BC.OUTFLOW, still, 1, 0);
    expect(g0[4] === 0 && g0[5] === still[5] && g0[3] === still[3]).toBe(true);
  });

  it('outflow with backflow (W2S-B1): the inflow ghost at the ambient totals (p_out, T_inf)', () => {
    // hot, fuelled, swirling gas flowing back in through the face (vn < 0): the ghost does not
    // copy it; what enters comes from the ambient beyond the boundary, at rest at p_out and T_inf
    const back = physicalToPrim(ambient, { rho: 0.6, u: -40, v: 6, w: 25, p: 1.02e5, z: 0.02 }, 1);
    for (const pOut of [ambient.p, 9e4]) {
      const params = boundaryParams(ambient, { outflowPressure: pOut });
      const g = ghost(ambient, BC.OUTFLOW, back, 1, 0, params);
      const totals = boundaryParams(ambient, { inflowTotal: { p0: pOut, t0: ambient.t } });
      const asInflow = ghost(ambient, BC.INFLOW, back, 1, 0, totals);
      expect(Array.from(g)).toEqual(Array.from(asInflow));
      // along the inward normal (-x here), no swirl, no fuel; at p_out 9e4, below the cell's
      // characteristic, the outside cannot push gas in: the ghost is at rest (sigma clamps at 0)
      if (pOut === ambient.p) expect(g[1]).toBeLessThan(0);
      else expect(g[1] === 0 && g[4] === pOut - ambient.p).toBe(true);
      expect(g[2] === 0 && g[3] === 0 && g[5] === 0).toBe(true);
      // the static temperature at most the ambient's (total T_inf)
      expect(g[6]).toBeLessThanOrEqual(0);
    }
    // a slanted face: only the normal component decides (vn = -40 * 0.6 + 6 * -0.8 < 0)
    const slant = ghost(ambient, BC.OUTFLOW, back, 0.6, -0.8);
    expect(slant[3] === 0 && slant[5] === 0).toBe(true);
    // a backflow cell at the ambient's own state gives back the ambient
    const rest = physicalToPrim(
      ambient,
      { rho: ambient.rho, u: 0, v: 0, w: 0, p: ambient.p, z: 0 },
      1,
    );
    rest[1] = -1e-30;
    const g = ghost(ambient, BC.OUTFLOW, rest, 1, 0);
    for (let k = 0; k < 6; k++) expect(Math.abs(g[k] ?? NaN)).toBeLessThan(1e-12);
  });
});

describe('slip-wall ghosts (extrapolated, docs/SOLVER.md section 5)', () => {
  it('extrapolate scalars and tangential velocity linearly and mirror the normal velocity', () => {
    const q0 = physicalToPrim(ambient, { rho: 1.1, u: 30, v: 4, w: 9, p: 1.02e5, z: 0.01 }, 1);
    const q1 = physicalToPrim(ambient, { rho: 1.3, u: 20, v: -6, w: 12, p: 1.05e5, z: 0.02 }, 1.1);
    const P = new Float64Array(2 * NP);
    P.set(q0, 0);
    P.set(q1, NP);
    const [nx, nr] = [0.6, 0.8];
    const vn = (q: ArrayLike<number>) => (q[1] ?? NaN) * nx + (q[2] ?? NaN) * nr;
    const vt = (q: ArrayLike<number>) => -(q[1] ?? NaN) * nr + (q[2] ?? NaN) * nx;
    for (const layer of [1, 2] as const) {
      const g = new Float64Array(NP);
      wallGhost(P, 0, NP, nx, nr, layer, g, 0);
      const a = layer === 1 ? 2 : 3;
      for (const k of [0, 3, 4, 5]) {
        expect(g[k]).toBeCloseTo(a * (q0[k] ?? NaN) - (a - 1) * (q1[k] ?? NaN), 9);
      }
      expect(vn(g)).toBeCloseTo(-vn(layer === 1 ? q0 : q1), 12);
      expect(vt(g)).toBeCloseTo(a * vt(q0) - (a - 1) * vt(q1), 12);
    }
  });
});
