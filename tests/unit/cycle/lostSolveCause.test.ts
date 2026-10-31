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

type Loss = 'none' | 'diverged' | 'nonPhysical' | 'coolingBooster' | 'typeError';

function model() {
  const ctl: { lose: Loss } = { lose: 'none' };
  const solver: typeof solveGasPath = (...args) => {
    if (ctl.lose === 'typeError') throw new TypeError('cannot read properties of undefined');
    const s = solveGasPath(...args);
    if (ctl.lose === 'diverged') return { ...s, converged: false, maxResidual: 1e-3 };
    if (ctl.lose === 'nonPhysical') return { ...s, x: s.x.map((v, i) => (i === 1 ? 0.5 : v)) };
    if (ctl.lose === 'coolingBooster') {
      // D4-94: W2H-B1's branch, the booster exit 61 K below the engine inlet
      const st = s.point.stations;
      const cold = { ...st['25'], ttK: st['2'].ttK - 61 };
      const stations = { ...st, '24': { ...st['24'], ttK: cold.ttK }, '25': cold };
      return { ...s, point: { ...s.point, stations } };
    }
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
    // (the reset's own first snapshot solves the gas path, so the solver must work again)
    b.ctl.lose = 'none';
    b.m.reset('groundIdle', ISA_SLS);
    expect(b.m.lostSolveCause()).toBeNull();
    warn.mockRestore();
  });

  it('D4-94: a root on which the booster cools the flow is held, with its cause named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { m, ctl } = model();
    ctl.lose = 'coolingBooster';
    const s = m.step(0.1, inputs);
    expect(s.gasPathSolve.status).toBe('held');
    expect(m.lostSolveCause()).toMatch(/^non-physical root \(booster total-temperature rise -\d/);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('W2A-N6: a held episode ends in the sub-idle model, so the relight holding again logs again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { m, ctl } = model();
    ctl.lose = 'diverged';
    expect(m.step(0.1, inputs).gasPathSolve.status).toBe('held');
    expect(warn).toHaveBeenCalledTimes(1);
    // a flameout while held: unlit, the sub-idle model; the auto igniters relight it after 3 s
    m.injectFault('flameout');
    const idle = { ...inputs, throttleLever: 0 };
    let s = m.step(0.1, idle);
    for (let k = 0; k < 150 && s.gasPathSolve.status !== 'subIdle'; k++) s = m.step(0.1, idle);
    expect(s.gasPathSolve.status).toBe('subIdle');
    for (let k = 0; k < 150 && s.gasPathSolve.status !== 'held'; k++) s = m.step(0.1, idle);
    // lit again above the switch, its first matched solve lost: a new held episode, logged
    expect(s.combustorLit).toBe(true);
    expect(s.gasPathSolve.status).toBe('held');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('W2A-N6: a held episode, then sub-idle (a flameout) and a relight into a second held episode, logs it again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { m, ctl } = model();
    ctl.lose = 'typeError';
    expect(m.step(0.1, inputs).gasPathSolve.status).toBe('held');
    expect(warn).toHaveBeenCalledTimes(1);
    // the fuel cut: the burner goes out and the model takes the sub-idle path (no matched solve)
    let s = m.step(0.1, { ...inputs, fuelLever: 'cutoff' });
    for (let k = 0; k < 20 && s.gasPathSolve.status !== 'subIdle'; k++)
      s = m.step(0.1, { ...inputs, fuelLever: 'cutoff' });
    expect(s.gasPathSolve.status).toBe('subIdle');
    // a restart (starter, fuel at idle) brings it back above sub-idle, where the solve is lost again
    const restart = { ...inputs, throttleLever: 0, starter: true };
    for (let k = 0; k < 1500 && s.gasPathSolve.status === 'subIdle'; k++) s = m.step(0.1, restart);
    expect(s.gasPathSolve.status).toBe('held');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
