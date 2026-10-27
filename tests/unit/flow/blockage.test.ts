// W2R-6 (handoff, critic pass 7 W2R-B1, decision D4-29): with blockage, the plain scheme is
// linearly unstable about its own steady state, in tracking (3-stage RK, local steps) and in
// physical time (SSP-RK3, the default global dt). The duct of precondition.test.ts (24 x 3 cells,
// b_min 0.85, throat M 0.06) is converged with the preconditioner (machCut 1, so R = 0 is the plain
// scheme's equation) and then iterated with the plain scheme. A stable scheme stays at its
// convergence level (the b = 1 control does, in both modes: 1e-12 of the state); with blockage the
// drift grows to about 1 % of the state (absolute max |dU| 1e-11 -> 0.5 in tracking and 0.8 in
// physical time over 1000 iterations, as critic probe w2r-blockage measured).
// Pinned as KNOWN-FAIL (it.fails) until D4-29's investigation fixes it: when these pass, flip them.
import { describe, expect, it } from 'vitest';
import { caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { NU } from '../../../src/flow/reference/state';
import { converge } from '../../ladder/common';
import { BC, rectangle, singleBlock, solverMesh } from './helpers';

const duct = solverMesh(
  singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, 24, 3), {
    imin: BC.INFLOW,
    imax: BC.OUTFLOW,
    jmin: BC.SLIP_WALL,
    jmax: BC.SLIP_WALL,
  }),
);
const gas = caloricallyPerfectGas(1.4, 287.05287);
const opts = (outflow: number) => ({
  gas,
  freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
  inflowTotal: { p0: 101325, t0: 288.15 },
  outflowPressure: 101325 * outflow,
});
const blocked = Float64Array.from(duct.cellX, (x) =>
  Math.abs(x) < 0.1 ? 1 - 0.15 * Math.cos((Math.PI * x) / 0.2) ** 2 : 1,
);
const open = new Float64Array(duct.nCells).fill(1);

const steadyStates = new Map<string, { U: Float64Array; converged: boolean }>();

/**
 * The preconditioned steady state (machCut 1: the plain scheme's R = 0) of the duct, computed once
 * per set-up. Its convergence is asserted by a passing test, so an expected failure below can only
 * come from the drift, not from the set-up.
 */
function steady(b: Float64Array, outflow: number): { U: Float64Array; converged: boolean } {
  const key = `${b === open ? 'open' : 'blocked'} ${outflow}`;
  const hit = steadyStates.get(key);
  if (hit !== undefined) return hit;
  const s = new ReferenceSolver(duct, {
    ...opts(outflow),
    lowMachPreconditioning: { minMach: 0.01, machCut: 1 },
  });
  s.setBlockage(b);
  const conv = converge(s, 1e-11, 8000);
  const out = { U: Float64Array.from(s.U), converged: conv.converged };
  steadyStates.set(key, out);
  return out;
}

/**
 * The largest drift of the plain scheme from the steady state U0 over n iterations, per component
 * relative to its scale (rho', eta: max |U0_k|; rho u and rho v share max |(rho u, rho v)|, as
 * SOLVER.md 12.2's velocity components do; rho r w and rho Z are 0 here).
 */
function drift(
  b: Float64Array,
  outflow: number,
  U0: Float64Array,
  mode: 'tracking' | 'physical',
  n: number,
): number {
  const s = new ReferenceSolver(duct, opts(outflow));
  s.setBlockage(b);
  s.U.set(U0);
  const dt = s.globalDt();
  for (let it = 0; it < n; it++) {
    if (mode === 'tracking') s.iterate(1);
    else s.stepPhysical(dt);
  }
  let worst = 0;
  for (const k of [0, 1, 2, 4]) {
    let scale = 0;
    let d = 0;
    for (let c = 0; c < duct.nCells; c++) {
      const o = NU * c;
      scale = Math.max(
        scale,
        k === 1 || k === 2
          ? Math.hypot(U0[o + 1] as number, U0[o + 2] as number)
          : Math.abs(U0[o + k] as number),
      );
      d = Math.max(d, Math.abs((s.U[NU * c + k] as number) - (U0[NU * c + k] as number)));
    }
    worst = Math.max(worst, d / scale);
  }
  return worst;
}

// Converged to 1e-11 of the first residual, the steady state sits about 1e-12 (relative) from the
// scheme's fixed point; the b = 1 control drifts 6e-12 in 2000 iterations. 1e-8 is far above that
// and far below the measured growth (8e-3 to 1e-2: the mode saturates at about 1 % of the state).
const STAY = 1e-8;

describe('W2R-6: the plain scheme about a steady state with blockage', () => {
  it('the preconditioned steady states of the three set-ups converge to 1e-11', () => {
    expect(steady(open, 0.94).converged).toBe(true);
    expect(steady(blocked, 0.998).converged).toBe(true);
    expect(steady(blocked, 0.94).converged).toBe(true);
  }, 120_000);

  it('control, b = 1: the plain scheme stays at its steady state in both modes', () => {
    const U0 = steady(open, 0.94).U;
    expect(drift(open, 0.94, U0, 'tracking', 1000)).toBeLessThan(STAY);
    expect(drift(open, 0.94, U0, 'physical', 2000)).toBeLessThan(STAY);
  }, 120_000);

  it.fails(
    'KNOWN-FAIL W2R-6 (D4-29): plain tracking leaves the steady state of a blockage duct ' +
      '(throat M 0.06: a linear instability, relative drift 1e-12 -> 8e-3 in 1000 iterations)',
    () => {
      const U0 = steady(blocked, 0.998).U;
      expect(drift(blocked, 0.998, U0, 'tracking', 1000)).toBeLessThan(STAY);
    },
    120_000,
  );

  it.fails(
    'KNOWN-FAIL W2R-6 (D4-29): physical time (SSP-RK3, default dt) leaves the steady state of a ' +
      'blockage duct (throat M 0.06: relative drift 2e-10 at 250 steps -> 1e-2 at 1000)',
    () => {
      const U0 = steady(blocked, 0.998).U;
      expect(drift(blocked, 0.998, U0, 'physical', 1000)).toBeLessThan(STAY);
    },
    120_000,
  );

  it.fails(
    'KNOWN-FAIL W2R-6 (D4-29): physical time leaves the steady state at throat M 0.35 too ' +
      '(slower: relative drift 4e-9 at 1000 steps -> 8e-3 at 2000)',
    () => {
      const U0 = steady(blocked, 0.94).U;
      expect(drift(blocked, 0.94, U0, 'physical', 2000)).toBeLessThan(STAY);
    },
    120_000,
  );
});
