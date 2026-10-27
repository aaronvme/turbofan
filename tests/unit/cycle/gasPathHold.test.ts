// D4-13: a lost matched gas-path solve above the sub-idle switch holds the last converged gas path
// and says so in the state (gasPathSolve), never a silent switch to the sub-idle similarity model,
// which engages only in genuine sub-idle states (a start, a windmill, a shutdown). Fast: a couple
// of seconds of simulation, with the reference solver made to fail on purpose through the
// gasPathSolver test hook.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  validateCycleState,
  type CycleInputs,
  type CycleModel,
  type CycleState,
} from '../../../src/contracts/cycle';
import { solveGasPath } from '../../../src/cycle/engine';
import { SUBIDLE_N2_PERCENT, createCycleModel } from '../../../src/cycle/model';
import { factValue } from '../../../src/engine/facts';

const TIMEOUT_MS = 120_000;
const refs = { n1Rpm: factValue('n1ReferenceRpm'), n2Rpm: factValue('n2ReferenceRpm') };
const inputs = (over: Partial<CycleInputs> = {}): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  ...over,
});

type Loss = 'none' | 'diverged' | 'nonPhysical';

/** The reference solver; while `lose` is set it reports a lost solve or a non-physical root. */
function switchableSolver() {
  const ctl: { lose: Loss; calls: number } = { lose: 'none', calls: 0 };
  const solver: typeof solveGasPath = (...args) => {
    ctl.calls++;
    const s = solveGasPath(...args);
    if (ctl.lose === 'diverged') return { ...s, converged: false, maxResidual: 1e-3 };
    // converged, but on a root with the bypass ratio (unknown 1) below 1
    if (ctl.lose === 'nonPhysical') return { ...s, x: s.x.map((v, i) => (i === 1 ? 0.5 : v)) };
    return s;
  };
  return { ctl, solver };
}

function run(m: CycleModel, seconds: number, dt: number, f: () => CycleInputs): CycleState[] {
  const out: CycleState[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) out.push(m.step(dt, f()));
  return out;
}

const last = (s: readonly CycleState[]): CycleState => {
  const x = s[s.length - 1];
  if (x === undefined) throw new Error('no states');
  return x;
};

describe('D4-13: a lost gas-path solve is held and flagged', { timeout: TIMEOUT_MS }, () => {
  /** 2 s into a ground-idle slam: N2 well above the switch, the gas path far from the idle anchor. */
  function accelerating(loss: Loss) {
    const { ctl, solver } = switchableSolver();
    const m = createCycleModel({ gasPathSolver: solver });
    const idle = m.reset('groundIdle', ISA_SLS);
    const before = last(run(m, 2, 0.05, () => inputs({ throttleLever: 1 })));
    ctl.lose = loss;
    ctl.calls = 0;
    const held = m.step(0.1, inputs({ throttleLever: 1 }));
    return { m, ctl, idle, before, held };
  }

  it('a converged run reports the matched solve and no lost solves', () => {
    const { idle, before } = accelerating('none');
    expect(idle.gasPathSolve).toEqual({ status: 'matched', lostSolves: 0 });
    expect(before.gasPathSolve).toEqual({ status: 'matched', lostSolves: 0 });
    expect(before.n2Percent).toBeGreaterThan(idle.n2Percent + 5);
  });

  it('holds the last converged gas path, counts every lost solve, and never uses the sub-idle model', () => {
    const { ctl, before, held } = accelerating('diverged');
    expect(held.n2Percent).toBeGreaterThan(SUBIDLE_N2_PERCENT);
    expect(held.combustorLit).toBe(true);
    expect(held.gasPathSolve.status).toBe('held');
    expect(held.gasPathSolve.lostSolves).toBeGreaterThan(0);
    // each lost solve is the direct try and the continuation's steps from 1/2 down to 1/256
    expect(ctl.calls).toBe(9 * held.gasPathSolve.lostSolves);
    // the gas path is the last converged one, exactly: not re-modelled by the similarity model
    expect(held.stations).toEqual(before.stations);
    expect(held.netThrustN).toBe(before.netThrustN);
    expect(held.hpc).toEqual(before.hpc);
    expect(validateCycleState(held, refs)).toEqual([]);
  });

  it('resumes the matched solve once it converges again; the count stays until a reset', () => {
    const { m, ctl, before, held } = accelerating('diverged');
    ctl.lose = 'none';
    const back = m.step(0.1, inputs({ throttleLever: 1 }));
    expect(back.gasPathSolve).toEqual({
      status: 'matched',
      lostSolves: held.gasPathSolve.lostSolves,
    });
    expect(back.stations['3'].ptPa).not.toBe(before.stations['3'].ptPa);
    expect(m.reset('groundIdle', ISA_SLS).gasPathSolve).toEqual({
      status: 'matched',
      lostSolves: 0,
    });
  });

  it('a converged root that is not physical (bypass ratio below 1) is a lost solve too', () => {
    const { ctl, before, held } = accelerating('nonPhysical');
    expect(held.gasPathSolve.status).toBe('held');
    expect(held.gasPathSolve.lostSolves).toBeGreaterThan(0);
    expect(ctl.calls).toBe(9 * held.gasPathSolve.lostSolves);
    expect(held.stations).toEqual(before.stations);
  });

  it('a reset to ground idle whose first solve is lost holds the converged steady idle point', () => {
    const { ctl, solver } = switchableSolver();
    const ref = createCycleModel().reset('groundIdle', ISA_SLS);
    ctl.lose = 'diverged';
    const s = createCycleModel({ gasPathSolver: solver }).reset('groundIdle', ISA_SLS);
    expect(s.gasPathSolve).toEqual({ status: 'held', lostSolves: 1 });
    // the held gas path is the steady idle solution, which a normal reset's matched solve matches
    for (const id of ['2', '3', '4', '49.5'] as const) {
      expect(s.stations[id].ptPa).toBeCloseTo(ref.stations[id].ptPa, 0);
      expect(s.stations[id].ttK).toBeCloseTo(ref.stations[id].ttK, 3);
    }
  });
});

describe(
  'D4-13: the sub-idle model only in genuine sub-idle states',
  { timeout: TIMEOUT_MS },
  () => {
    it('a dry crank from a stop never tries the matched solve: sub-idle, nothing lost', () => {
      const { ctl, solver } = switchableSolver();
      ctl.lose = 'diverged';
      const m = createCycleModel({ gasPathSolver: solver });
      expect(m.reset('shutdown', ISA_SLS).gasPathSolve).toEqual({
        status: 'subIdle',
        lostSolves: 0,
      });
      const states = run(m, 3, 0.1, () => inputs({ starter: true, fuelLever: 'cutoff' }));
      for (const s of states) expect(s.gasPathSolve).toEqual({ status: 'subIdle', lostSolves: 0 });
      expect(last(states).n2Percent).toBeGreaterThan(5);
      expect(ctl.calls).toBe(0);
    });

    it('a fuel cutoff from idle is a shutdown: the sub-idle model at once, even above the switch', () => {
      const { ctl, solver } = switchableSolver();
      const m = createCycleModel({ gasPathSolver: solver });
      m.reset('groundIdle', ISA_SLS);
      // the step's first snapshot is still the lit engine; the cutoff takes effect in its substep
      const cut = m.step(0.05, inputs({ fuelLever: 'cutoff' }));
      expect(cut.n2Percent).toBeGreaterThan(SUBIDLE_N2_PERCENT);
      expect(cut.combustorLit).toBe(false);
      expect(cut.gasPathSolve).toEqual({ status: 'subIdle', lostSolves: 0 });
      ctl.lose = 'diverged';
      ctl.calls = 0;
      const states = run(m, 1, 0.05, () => inputs({ fuelLever: 'cutoff' }));
      for (const s of states) expect(s.gasPathSolve).toEqual({ status: 'subIdle', lostSolves: 0 });
      expect(last(states).n2Percent).toBeGreaterThan(SUBIDLE_N2_PERCENT - 10);
      expect(ctl.calls).toBe(0);
    });

    it('a flameout at idle (unlit, the spools running down) is sub-idle, nothing lost', () => {
      const { ctl, solver } = switchableSolver();
      const m = createCycleModel({ gasPathSolver: solver });
      m.reset('groundIdle', ISA_SLS);
      m.injectFault('flameout');
      expect(m.step(0.05, inputs()).combustorLit).toBe(false);
      ctl.lose = 'diverged';
      ctl.calls = 0;
      // the light-off delay is 3 s: the whole second is unlit
      const unlit = run(m, 1, 0.05, () => inputs());
      expect(unlit.every((s) => !s.combustorLit)).toBe(true);
      for (const s of unlit) expect(s.gasPathSolve).toEqual({ status: 'subIdle', lostSolves: 0 });
      expect(ctl.calls).toBe(0);
    });
  },
);
