// The app's drawn-field switch (src/shell/fieldSwitch.ts; D4-82 in the shell): the viewer picks
// the MOCK or the live solver, the solver is drawn through flowviz's field link, and a solver that
// cannot start, is lost or diverged is replaced by the MOCK at once, visibly (the reason is in the
// state the badge shows) and never silently (warned). Fakes only: no GPU.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  FIELD_EXTENTS,
  fieldReferenceFromAmbient,
  type CpuFlowField,
  type FlowField,
} from '../../../src/contracts/flow';
import type { FlowRunStatus, FlowStatus } from '../../../src/contracts/sim';
import type { LinkedSolver } from '../../../src/flow/viz/fieldLink';
import { createFieldSwitch } from '../../../src/shell/fieldSwitch';

const ref = fieldReferenceFromAmbient(ISA_SLS);
const tex = (label: string) => ({ label }) as unknown as GPUTexture;

function cpuField(version: number): CpuFlowField {
  const t = { extent: FIELD_EXTENTS.near, state: new Uint16Array(0), velocity: new Uint16Array(0) };
  return { source: 'mock', coupling: 'mock', reference: ref, near: t, far: t, ...{ version } };
}

class FakeSolver implements LinkedSolver {
  run: FlowRunStatus = 'running';
  error: string | null = null;
  residual = 1e-3;
  steps = 0;
  disposed = false;
  readonly field: FlowField = {
    source: 'solver',
    coupling: 'uncoupled',
    reference: ref,
    extents: FIELD_EXTENTS,
    near: { state: tex('near state'), velocity: tex('near velocity') },
    far: { state: tex('far state'), velocity: tex('far velocity') },
    version: 0,
  };
  fields(): FlowField {
    return this.field;
  }
  status(): FlowStatus {
    return {
      status: this.run,
      error: this.error,
      mode: 'tracking',
      stats: {
        iterationsThisStep: 0,
        totalIterations: this.steps,
        gpuTimeMs: null,
        residualDensityL2: this.residual,
        physicalTimeS: 0,
      },
      reduction: null,
    };
  }
  step() {
    this.steps++;
    return {
      iterationsThisStep: 1,
      totalIterations: this.steps,
      gpuTimeMs: null,
      residualDensityL2: this.residual,
      physicalTimeS: 0,
    };
  }
  dispose(): void {
    this.disposed = true;
  }
}

function sink() {
  const calls: { kind: 'cpu' | 'solver'; field: CpuFlowField | FlowField }[] = [];
  return {
    calls,
    kinds: () => calls.map((c) => c.kind),
    setFlowField(field: CpuFlowField) {
      calls.push({ kind: 'cpu', field });
    },
    setFlowSolverField(field: FlowField) {
      calls.push({ kind: 'solver', field });
    },
  };
}

const budget = { gpuTimeBudgetMs: 4, maxIterations: 100 };

function setup(start: () => Promise<LinkedSolver>) {
  const s = sink();
  const warned: string[] = [];
  let starts = 0;
  const sw = createFieldSwitch({
    sink: s,
    mock: cpuField(0),
    solver: () => {
      starts++;
      return start();
    },
    warn: (m) => warned.push(m),
  });
  return { s, warned, sw, starts: () => starts };
}

describe('createFieldSwitch (D4-82 in the shell)', () => {
  it('starts on the labelled MOCK and does not start the solver for it', async () => {
    const t = setup(() => Promise.resolve(new FakeSolver()));
    const sw = await t.sw;
    expect(sw.state()).toEqual({ asked: 'mock', coupling: 'mock', fallback: null });
    expect(sw.drawn()).toBe('mock');
    expect(t.s.kinds()).toEqual(['cpu']);
    expect(t.starts()).toBe(0);
    sw.setMock(cpuField(1));
    expect(t.s.calls.at(-1)?.field).toMatchObject({ version: 1 });
  });

  it("draws the solver's field labelled uncoupled (until W3) and steps it only with a budget", async () => {
    const solver = new FakeSolver();
    const t = setup(() => Promise.resolve(solver));
    const sw = await t.sw;
    await sw.choose('solver');
    expect(sw.state()).toEqual({ asked: 'solver', coupling: 'uncoupled', fallback: null });
    expect(sw.drawn()).toBe('solver');
    expect(t.s.kinds()).toEqual(['cpu', 'solver']);
    sw.beforeFrame(budget);
    sw.beforeFrame(null);
    expect(solver.steps).toBe(1);
    // the MOCK raster follows the throttle but is not drawn over the solver
    sw.setMock(cpuField(2));
    expect(t.s.kinds()).toEqual(['cpu', 'solver']);
    expect(t.warned).toEqual([]);
  });

  it('falls back to the MOCK, with the reason and a warning, when the solver cannot start', async () => {
    const t = setup(() => Promise.reject(new Error('the device lacks FLOW_SOLVER_LIMITS')));
    const sw = await t.sw;
    await sw.choose('solver');
    const st = sw.state();
    expect(st.asked).toBe('solver');
    expect(st.coupling).toBe('mock');
    expect(st.fallback).toMatch(/solver unavailable: the device lacks FLOW_SOLVER_LIMITS/);
    expect(sw.drawn()).toBe('mock');
    expect(t.s.kinds()).toEqual(['cpu', 'cpu']);
    expect(t.warned).toHaveLength(1);
    expect(t.warned[0]).toContain('FLOW_SOLVER_LIMITS');
  });

  it('a solver lost mid-run falls back at the next frame (the MOCK bound first) and stays gone', async () => {
    const solver = new FakeSolver();
    const t = setup(() => Promise.resolve(solver));
    const sw = await t.sw;
    await sw.choose('solver');
    sw.beforeFrame(budget);
    solver.run = 'lost';
    solver.error = 'GPU device lost: the test removed it';
    sw.beforeFrame(budget);
    expect(solver.steps).toBe(1);
    expect(sw.state().coupling).toBe('mock');
    expect(sw.state().fallback).toMatch(/solver lost: GPU device lost/);
    expect(sw.drawn()).toBe('mock');
    expect(t.s.kinds()).toEqual(['cpu', 'solver', 'cpu']);
    expect(solver.disposed).toBe(true);
    expect(t.warned).toHaveLength(1);
    // asking again does not resurrect a disposed solver: the fallback says why
    await sw.choose('solver');
    expect(sw.state().fallback).toMatch(/solver unavailable: .*solver lost/);
    expect(t.starts()).toBe(1);
    expect(t.warned).toHaveLength(2);
  });

  it('a diverged solver (a non-finite residual) falls back with the reason', async () => {
    const solver = new FakeSolver();
    const t = setup(() => Promise.resolve(solver));
    const sw = await t.sw;
    await sw.choose('solver');
    solver.residual = Number.NaN;
    sw.beforeFrame(budget);
    expect(sw.state().coupling).toBe('mock');
    expect(sw.state().fallback).toMatch(/solver diverged/);
    expect(solver.disposed).toBe(true);
  });

  it('back to the MOCK keeps the solver alive and idle; the solver again reuses it', async () => {
    const solver = new FakeSolver();
    const t = setup(() => Promise.resolve(solver));
    const sw = await t.sw;
    await sw.choose('solver');
    await sw.choose('mock');
    expect(sw.state()).toEqual({ asked: 'mock', coupling: 'mock', fallback: null });
    sw.beforeFrame(budget);
    expect(solver.steps).toBe(0);
    expect(solver.disposed).toBe(false);
    await sw.choose('solver');
    expect(sw.state().coupling).toBe('uncoupled');
    expect(t.starts()).toBe(1);
    expect(t.s.kinds()).toEqual(['cpu', 'solver', 'cpu', 'solver']);
  });

  it('the latest choice wins: a slow solver start cannot bind over a later MOCK choice', async () => {
    const solver = new FakeSolver();
    let release: (s: LinkedSolver) => void = () => undefined;
    const t = setup(
      () =>
        new Promise<LinkedSolver>((r) => {
          release = r;
        }),
    );
    const sw = await t.sw;
    const slow = sw.choose('solver');
    // the MOCK keeps following the throttle while the solver starts
    sw.setMock(cpuField(3));
    expect(t.s.calls.at(-1)?.field).toMatchObject({ version: 3 });
    await sw.choose('mock');
    release(solver);
    await slow;
    expect(sw.state()).toEqual({ asked: 'mock', coupling: 'mock', fallback: null });
    expect(t.s.kinds()).not.toContain('solver');
    expect(sw.drawn()).toBe('mock');
  });
});
