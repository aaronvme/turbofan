// W2F-I1: a lost matched solve keeps its cause, so the app's diagnostics can tell a physical loss
// (no converged root, a non-physical root, a thermo range error) from a programming error, which
// used to reach the app as an anonymous `held`. The contract field is unchanged; the cause is the
// model's diagnostic (lostSolveCause), logged once per held episode.
import { describe, expect, it, vi } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../../../src/contracts/cycle';
import { solveGasPath } from '../../../src/cycle/engine';
import { createCycleModel } from '../../../src/cycle/model';

const inputs: CycleInputs = {
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  throttleLever: 1,
};

type Loss = 'none' | 'diverged' | 'nonPhysical' | 'typeError';

function model() {
  const ctl: { lose: Loss } = { lose: 'none' };
  const solver: typeof solveGasPath = (...args) => {
    if (ctl.lose === 'typeError') throw new TypeError('cannot read properties of undefined');
    const s = solveGasPath(...args);
    if (ctl.lose === 'diverged') return { ...s, converged: false, maxResidual: 1e-3 };
    if (ctl.lose === 'nonPhysical') return { ...s, x: s.x.map((v, i) => (i === 1 ? 0.5 : v)) };
    return s;
  };
  const m = createCycleModel({ gasPathSolver: solver });
  m.reset('groundIdle', ISA_SLS);
  for (let k = 0; k < 20; k++) m.step(0.1, inputs);
  return { m, ctl };
}

describe('W2F-I1: the lost-solve cause', { timeout: 120_000 }, () => {
  it('is null while no solve was lost', () => {
    const { m } = model();
    expect(m.lostSolveCause()).toBeNull();
  });

  it('names a programming error by its type and message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { m, ctl } = model();
    ctl.lose = 'typeError';
    const s = m.step(0.1, inputs);
    expect(s.gasPathSolve.status).toBe('held');
    expect(m.lostSolveCause()).toMatch(/TypeError: cannot read properties of undefined/);
    // logged once per held episode, not once per step
    m.step(0.1, inputs);
    m.step(0.1, inputs);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('tells a residual above the acceptance from a non-physical root', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = model();
    a.ctl.lose = 'diverged';
    a.m.step(0.1, inputs);
    expect(a.m.lostSolveCause()).toMatch(/residual 0\.001 .*1e-6/);
    const b = model();
    b.ctl.lose = 'nonPhysical';
    b.m.step(0.1, inputs);
    expect(b.m.lostSolveCause()).toMatch(/non-physical root \(BPR 0\.5/);
    // a new episode after a recovery logs again; a reset clears the cause
    b.ctl.lose = 'none';
    b.m.step(0.1, inputs);
    b.ctl.lose = 'nonPhysical';
    b.m.step(0.1, inputs);
    expect(warn).toHaveBeenCalledTimes(3);
    b.m.reset('groundIdle', ISA_SLS);
    expect(b.m.lostSolveCause()).toBeNull();
    warn.mockRestore();
  });
});
