// The model's own wiring of a held gas path, fast, on solver doubles (gasPathSolver): what only the
// slow suites (heldFrame, heldRecovery, the ISA+30 sweep) reached before cycle-hold round 3.
// - W2H-N6 / hand mutant B4: a walk that converges on the state it set out for, while the state
//   has moved on, moves the model's anchor and its held point there (model.ts `reached`).
// - W2H-I3: a surge starts only from a solved gas path. The detected start skips a held snapshot,
//   and an injected surge waits on one until the solve recovers.
// - D4-92 (a): while held the spools follow the held power balance, but never past their redlines.
// - D4-92 (c): a held episode escalates once, after ESCALATE_AFTER_S, to D4-13's whole walk.
// - D4-84: the retry options are checked (moved here from heldFrame.test.ts, the slow file).
import { describe, expect, it, vi } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  type CycleInputs,
  type CycleState,
} from '../../../src/contracts/cycle';
import { solveGasPath, type GasPathSolution } from '../../../src/cycle/engine';
import { ESCALATE_AFTER_S, UNBOUNDED_RETRY } from '../../../src/cycle/heldRetry';
import { SUBIDLE_N2_PERCENT, createCycleModel } from '../../../src/cycle/model';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';

const TIMEOUT_MS = 120_000;
const inputs = (over: Partial<CycleInputs> = {}): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  ...over,
});
const slam = inputs({ throttleLever: 1 });
/** A frame step shorter than one HPC Helmholtz period at idle (the surge-start test). */
const SURGE_DT_S = 0.005;
/** A solve the model must refuse: the reference root with its residual above the acceptance. */
const diverged = (s: GasPathSolution): GasPathSolution => ({
  ...s,
  converged: false,
  maxResidual: 1e-3,
});

function quiet<T>(f: () => T): T {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    return f();
  } finally {
    warn.mockRestore();
  }
}

describe('W2H-N6: a walk that reaches its own (older) target moves the anchor and the held point', () => {
  /**
   * The reference solver. Once `lose` is set, the first call (the direct solve at the state the
   * episode starts at, T0) is refused, and so is every later call except the walk toward T0: a
   * point strictly between the last accepted point (the anchor, A) and T0 in N2, or T0 itself. The
   * accelerating state's later direct solves lie beyond T0, so they are refused. The meter counts
   * calls, charged after each, so a budget of 2 lets a step make two whole solves.
   */
  function towardT0() {
    const ctl = {
      lose: false,
      calls: 0,
      a: null as { n2Rpm: number } | null,
      t0: null as { n2Rpm: number } | null,
      t0Solution: null as GasPathSolution | null,
      guesses: [] as (readonly number[])[],
    };
    let last = { n2Rpm: NaN };
    const solver: typeof solveGasPath = (...args) => {
      const n2Rpm = args[3];
      ctl.guesses.push(args[5]);
      const s = solveGasPath(...args);
      ctl.calls++;
      if (!ctl.lose) {
        last = { n2Rpm };
        return s;
      }
      if (ctl.t0 === null) {
        ctl.a = last;
        ctl.t0 = { n2Rpm };
        return diverged(s);
      }
      const a = ctl.a?.n2Rpm ?? NaN;
      const t0 = ctl.t0.n2Rpm;
      if (n2Rpm === t0) {
        ctl.t0Solution = s;
        return s;
      }
      return (n2Rpm - a) * (n2Rpm - t0) < 0 ? s : diverged(s);
    };
    const m = createCycleModel({
      gasPathSolver: solver,
      heldRetry: { budget: 2, meter: () => ctl.calls },
    });
    return { m, ctl };
  }

  it(
    'held, the state is the anchor until the walk reaches T0, then T0, and the next solves start from it',
    { timeout: TIMEOUT_MS },
    () => {
      quiet(() => {
        const { m, ctl } = towardT0();
        m.reset('groundIdle', ISA_SLS);
        let before: CycleState = m.state();
        for (let i = 0; i < 40; i++) before = m.step(0.05, slam);
        expect(before.gasPathSolve).toEqual({ status: 'matched', lostSolves: 0 });
        ctl.lose = true;
        // the episode's first step: the walk sets out for T0 and pauses half way (the budget)
        const first = m.step(0.05, slam);
        expect(first.gasPathSolve.status).toBe('held');
        expect(first.stations).toEqual(before.stations);
        expect(ctl.t0).not.toBeNull();
        expect(ctl.t0Solution).toBeNull();
        // the next step: the walk ends on T0, which the state has passed, so the model still holds,
        // now T0's gas path, and T0 is the anchor the next solves start from
        const second = m.step(0.05, slam);
        expect(second.gasPathSolve.status).toBe('held');
        expect(second.n2Rpm).toBeGreaterThan(ctl.t0?.n2Rpm ?? Infinity);
        const t0 = ctl.t0Solution;
        expect(t0, 'the walk converged on T0').not.toBeNull();
        expect(second.stations).toEqual(t0?.point.stations);
        expect(second.stations).not.toEqual(before.stations);
        ctl.guesses.length = 0;
        expect(m.step(0.05, slam).gasPathSolve.status).toBe('held');
        expect(ctl.guesses[0]).toEqual(t0?.x);
      });
    },
  );
});

describe('W2H-I3: a surge starts only from a solved gas path', () => {
  type Mode = 'none' | 'lose' | 'beyondSurgeLine' | 'beyondSurgeLineOnce';
  /** The reference root moved beyond the HPC surge line: its pressure ratio doubled. */
  const beyondSurgeLine = (s: GasPathSolution): GasPathSolution => {
    const hpc = { ...s.point.hpc, point: { ...s.point.hpc.point } };
    hpc.point.pressureRatio *= 2;
    return { ...s, point: { ...s.point, hpc } };
  };
  /**
   * The reference solver. 'lose' refuses every solve; 'beyondSurgeLine' gives every solve a matched
   * point beyond the surge line (a negative HPC margin); 'beyondSurgeLineOnce' gives the next solve
   * one, then refuses every solve after it.
   */
  function switchable() {
    const ctl = { mode: 'none' as Mode };
    const solver: typeof solveGasPath = (...args) => {
      const s = solveGasPath(...args);
      if (ctl.mode === 'none') return s;
      if (ctl.mode === 'lose') return diverged(s);
      if (ctl.mode === 'beyondSurgeLineOnce') ctl.mode = 'lose';
      return beyondSurgeLine(s);
    };
    return { ctl, m: createCycleModel({ gasPathSolver: solver }) };
  }

  it(
    'the detected start skips a held snapshot beyond the surge line; a solved one starts it',
    { timeout: TIMEOUT_MS },
    () => {
      quiet(() => {
        const held = switchable();
        held.m.reset('groundIdle', ISA_SLS);
        // A 5 ms step is two snapshots: the step's own, which the model never checks for a surge
        // (matched here, beyond the surge line), and the substep's (held at that point). It is
        // shorter than one Helmholtz period (about 10 ms at idle), so an episode that starts is
        // still running at the step's end.
        held.ctl.mode = 'beyondSurgeLineOnce';
        for (let i = 0; i < 10; i++) {
          const s = held.m.step(SURGE_DT_S, inputs());
          expect(s.gasPathSolve.status).toBe('held');
          expect(s.n2Percent).toBeGreaterThan(SUBIDLE_N2_PERCENT);
          expect(s.hpc.surgeMarginFraction).toBeLessThan(0);
          expect(s.flags.surge, `a surge started held at ${s.timeS.toFixed(2)} s`).toBe(false);
        }
        // recovered onto the reference root (inside the surge line): the held snapshots left no
        // surge behind them
        held.ctl.mode = 'none';
        const back = held.m.step(SURGE_DT_S, inputs());
        expect(back.gasPathSolve.status).toBe('matched');
        expect(back.hpc.surgeMarginFraction).toBeGreaterThan(0);
        expect(back.flags.surge).toBe(false);
        // the same point solved at the substep too: the surge starts there
        const solved = switchable();
        solved.m.reset('groundIdle', ISA_SLS);
        solved.ctl.mode = 'beyondSurgeLine';
        const s = solved.m.step(SURGE_DT_S, inputs());
        expect(s.gasPathSolve.status).toBe('matched');
        expect(s.hpc.surgeMarginFraction).toBeLessThan(0);
        expect(s.flags.surge).toBe(true);
      });
    },
  );

  it(
    'an injected surge on a held snapshot waits, and starts at the first solved one',
    { timeout: TIMEOUT_MS },
    () => {
      quiet(() => {
        const { ctl, m } = switchable();
        m.reset('groundIdle', ISA_SLS);
        ctl.mode = 'lose';
        expect(m.step(0.02, inputs()).gasPathSolve.status).toBe('held');
        m.injectFault('surge');
        for (let i = 0; i < 10; i++) {
          const s = m.step(0.02, inputs());
          expect(s.gasPathSolve.status).toBe('held');
          expect(s.flags.surge, `a surge started held at ${s.timeS.toFixed(2)} s`).toBe(false);
        }
        ctl.mode = 'none';
        const back = m.step(0.02, inputs());
        expect(back.gasPathSolve.status).toBe('matched');
        // the fault was kept, not dropped: the episode starts from the solved point
        expect(back.flags.surge).toBe(true);
      });
    },
  );

  it('below the sub-idle speed an injected surge is dropped', { timeout: TIMEOUT_MS }, () => {
    quiet(() => {
      const { m } = switchable();
      m.reset('shutdown', ISA_SLS);
      const crank = inputs({ starter: true, fuelLever: 'cutoff' });
      for (let i = 0; i < 10; i++) m.step(0.1, crank);
      expect(m.state().n2Percent).toBeLessThan(SUBIDLE_N2_PERCENT);
      m.injectFault('surge');
      for (let i = 0; i < 5; i++) {
        const s = m.step(0.1, crank);
        expect(s.gasPathSolve.status).toBe('subIdle');
        expect(s.flags.surge).toBe(false);
      }
    });
  });

  it('a matched point inside the surge line starts no surge', { timeout: TIMEOUT_MS }, () => {
    quiet(() => {
      const { m } = switchable();
      m.reset('groundIdle', ISA_SLS);
      for (let i = 0; i < 10; i++) {
        const s = m.step(SURGE_DT_S, inputs());
        expect(s.gasPathSolve.status).toBe('matched');
        expect(s.hpc.surgeMarginFraction).toBeGreaterThan(0);
        expect(s.flags.surge).toBe(false);
      }
    });
  });
});

describe('D4-92 (c): a held episode escalates once, after ESCALATE_AFTER_S, to the whole walk', () => {
  /** The reference solver, every solve refused while `lose` is set; its calls counted. */
  function losing(opts: Parameters<typeof createCycleModel>[0] = {}) {
    const ctl = { lose: false, calls: 0 };
    const solver: typeof solveGasPath = (...args) => {
      ctl.calls++;
      const s = solveGasPath(...args);
      return ctl.lose ? diverged(s) : s;
    };
    const m = createCycleModel({ ...opts, gasPathSolver: solver });
    m.reset('groundIdle', ISA_SLS);
    return { ctl, m };
  }

  it(
    'once per episode, no earlier than 0.25 s held; a second episode escalates again',
    { timeout: TIMEOUT_MS },
    () => {
      quiet(() => {
        const { ctl, m } = losing();
        const run = (steps: number) => {
          const out: { s: CycleState; escalations: number }[] = [];
          for (let i = 0; i < steps; i++) {
            const s = m.step(0.05, inputs());
            out.push({ s, escalations: m.heldRetryEscalations() });
          }
          return out;
        };
        // matched: never
        expect(run(10).every((k) => k.escalations === 0)).toBe(true);
        expect(ESCALATE_AFTER_S).toBe(0.25);
        ctl.lose = true;
        const first = run(20);
        expect(first.every((k) => k.s.gasPathSolve.status === 'held')).toBe(true);
        // the episode starts at the first step's first snapshot, one step before its end time
        const heldFrom = (first[0]?.s.timeS ?? NaN) - 0.05;
        const at = first.find((k) => k.escalations === 1);
        expect(at, 'an escalation').toBeDefined();
        expect((at?.s.timeS ?? 0) - heldFrom).toBeGreaterThanOrEqual(ESCALATE_AFTER_S);
        expect((at?.s.timeS ?? 0) - heldFrom).toBeLessThan(ESCALATE_AFTER_S + 0.1);
        // once: the episode goes on held, with no second escalation
        expect(first[first.length - 1]?.escalations).toBe(1);
        ctl.lose = false;
        expect(run(1)[0]?.s.gasPathSolve.status).toBe('matched');
        ctl.lose = true;
        expect(
          run(20)
            .map((k) => k.escalations)
            .pop(),
        ).toBe(2);
      });
    },
  );

  it("the escalated step runs D4-13's whole walk: the direct try and 8 halvings", () => {
    quiet(() => {
      const { ctl, m } = losing({ heldRetry: { budget: 1 } });
      m.step(0.05, inputs());
      ctl.lose = true;
      let escalations = 0;
      for (let i = 0; i < 20 && escalations === 0; i++) {
        const c0 = ctl.calls;
        m.step(0.05, inputs());
        escalations = m.heldRetryEscalations();
        // a budget of one evaluation lets the bounded retry make one solve a step at most; the
        // escalated step adds the whole walk
        if (escalations === 1) expect(ctl.calls - c0).toBeGreaterThanOrEqual(9);
        else expect(ctl.calls - c0).toBeLessThanOrEqual(2);
      }
      expect(escalations).toBe(1);
    });
  });

  it('heldRetry.escalateAfterS: Infinity never escalates', { timeout: TIMEOUT_MS }, () => {
    quiet(() => {
      const { ctl, m } = losing({ heldRetry: { escalateAfterS: Infinity } });
      m.step(0.05, inputs());
      ctl.lose = true;
      for (let i = 0; i < 20; i++) m.step(0.05, inputs());
      expect(m.state().gasPathSolve.status).toBe('held');
      expect(m.heldRetryEscalations()).toBe(0);
    });
  });
});

describe('D4-84: the retry options', () => {
  it('rejects a budget that is not positive and a walk interval that is negative', () => {
    expect(() => createCycleModel({ heldRetry: { budget: 0 } })).toThrow(
      /^heldRetry.budget 0 must be above 0$/,
    );
    expect(() => createCycleModel({ heldRetry: { budget: Number.NaN } })).toThrow(/budget NaN/);
    expect(() => createCycleModel({ heldRetry: { walkIntervalS: -1 } })).toThrow(
      /^heldRetry.walkIntervalS -1 must be at least 0$/,
    );
    expect(() => createCycleModel({ heldRetry: { walkIntervalS: 0 } })).not.toThrow();
    expect(() => createCycleModel({ heldRetry: UNBOUNDED_RETRY })).not.toThrow();
  });
});

describe('D4-92 (a): held, the spools never pass their redlines', () => {
  it(
    'a solve lost on a point with a large shaft surplus: the held balance drives N1 and N2 to the redline, not past it',
    { timeout: TIMEOUT_MS },
    () => {
      quiet(() => {
        // 2 s into a slam, the next solve's point gets 50 MW more on each shaft (the stale balance
        // W2H-I1's runaway integrated, made fast), then every solve is refused
        const ctl = { mode: 'none' as 'none' | 'surplusOnce' | 'lose' };
        const solver: typeof solveGasPath = (...args) => {
          const s = solveGasPath(...args);
          if (ctl.mode === 'none') return s;
          if (ctl.mode === 'lose') return diverged(s);
          ctl.mode = 'lose';
          const p = s.point;
          const point = {
            ...p,
            netPowerLpW: p.netPowerLpW + 5e7,
            netPowerHpW: p.netPowerHpW + 5e7,
          };
          return { ...s, point };
        };
        const m = createCycleModel({ gasPathSolver: solver });
        m.reset('groundIdle', ISA_SLS);
        for (let i = 0; i < 40; i++) m.step(0.05, slam);
        ctl.mode = 'surplusOnce';
        const lim = ENGINE_DEFINITION.limits;
        const held: CycleState[] = [];
        for (let i = 0; i < 20; i++) held.push(m.step(0.05, slam));
        for (const s of held) {
          expect(s.gasPathSolve.status).toBe('held');
          expect(s.n1Rpm).toBeLessThanOrEqual(lim.n1MaxRpm);
          expect(s.n2Rpm).toBeLessThanOrEqual(lim.n2MaxRpm);
          expect(s.flags.n1Overspeed).toBe(false);
          expect(s.flags.n2Overspeed).toBe(false);
        }
        // the clamp engaged: the surplus took both spools to their limits, and they stay there
        expect(held[held.length - 1]?.n1Rpm).toBe(lim.n1MaxRpm);
        expect(held[held.length - 1]?.n2Rpm).toBe(lim.n2MaxRpm);
      });
    },
  );
});
