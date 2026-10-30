// The flow-field link (w2/flowviz round 3, W2V-I6 and D4-82): which field the visuals draw, the
// live solver's or the MOCK, and the runtime MOCK fallback when the solver is unavailable, lost
// or diverged. The fallback is visible (the state carries the reason the badge shows) and never
// silent (it is also warned). Fakes only: no GPU.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../../src/contracts/ambient';
import {
  FIELD_EXTENTS,
  fieldReferenceFromAmbient,
  type CpuFlowField,
  type FlowField,
} from '../../../../src/contracts/flow';
import type { FlowRunStatus, FlowStatus } from '../../../../src/contracts/sim';
import { createFlowFieldLink, type LinkedSolver } from '../../../../src/flow/viz/fieldLink';

const ref = fieldReferenceFromAmbient(ISA_SLS);
const tex = (label: string) => ({ label }) as unknown as GPUTexture;
const textures = (k: number) => ({ state: tex(`state ${k}`), velocity: tex(`velocity ${k}`) });

function cpuField(version: number): CpuFlowField {
  const t = { extent: FIELD_EXTENTS.near, state: new Uint16Array(0), velocity: new Uint16Array(0) };
  return { source: 'mock', coupling: 'mock', reference: ref, near: t, far: t, ...{ version } };
}

function solverField(k = 0): FlowField {
  return {
    source: 'solver',
    coupling: 'uncoupled',
    reference: ref,
    extents: FIELD_EXTENTS,
    near: textures(k),
    far: textures(k),
    version: 0,
  };
}

class FakeSolver implements LinkedSolver {
  run: FlowRunStatus = 'running';
  error: string | null = null;
  residual: number | null = 1e-3;
  field = solverField();
  steps = 0;
  disposed = false;
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
    return (
      this.status().stats ?? {
        iterationsThisStep: 0,
        totalIterations: 0,
        gpuTimeMs: null,
        residualDensityL2: null,
        physicalTimeS: 0,
      }
    );
  }
  dispose(): void {
    this.disposed = true;
  }
}

function sink() {
  const calls: { kind: 'cpu' | 'solver'; field: CpuFlowField | FlowField }[] = [];
  return {
    calls,
    setFlowField(field: CpuFlowField) {
      calls.push({ kind: 'cpu', field });
    },
    setFlowSolverField(field: FlowField) {
      calls.push({ kind: 'solver', field });
    },
  };
}

const budget = { gpuTimeBudgetMs: 4, maxIterations: 100 };

describe('createFlowFieldLink', () => {
  it('draws the MOCK when the MOCK is asked for, labelled mock, and follows a new raster', async () => {
    const s = sink();
    const link = await createFlowFieldLink({ sink: s, mock: cpuField(0) });
    expect(link.state()).toEqual({ asked: 'mock', coupling: 'mock', fallback: null });
    expect(s.calls.map((c) => c.kind)).toEqual(['cpu']);
    link.setMock(cpuField(1));
    expect(s.calls.at(-1)?.field).toMatchObject({ version: 1 });
    link.beforeFrame(budget);
    expect(s.calls).toHaveLength(2);
  });

  it("draws the solver's textures, labelled with the field's coupling (uncoupled until W3)", async () => {
    const s = sink();
    const solver = new FakeSolver();
    const link = await createFlowFieldLink({
      sink: s,
      mock: cpuField(0),
      solver: () => Promise.resolve(solver),
    });
    expect(link.state()).toEqual({ asked: 'solver', coupling: 'uncoupled', fallback: null });
    expect(s.calls.map((c) => c.kind)).toEqual(['solver']);
    link.beforeFrame(budget);
    expect(solver.steps).toBe(1);
    // the MOCK follows the throttle only while it is drawn
    link.setMock(cpuField(1));
    expect(s.calls).toHaveLength(1);
  });

  it('falls back to the MOCK, visibly and with the reason, when the solver cannot start', async () => {
    const s = sink();
    const warned: string[] = [];
    const link = await createFlowFieldLink({
      sink: s,
      mock: cpuField(0),
      solver: () => Promise.reject(new Error('no 130k mesh')),
      warn: (m) => warned.push(m),
    });
    const st = link.state();
    expect(st.asked).toBe('solver');
    expect(st.coupling).toBe('mock');
    expect(st.fallback).toMatch(/unavailable/);
    expect(st.fallback).toMatch(/no 130k mesh/);
    expect(s.calls.map((c) => c.kind)).toEqual(['cpu']);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('no 130k mesh');
    expect(link.solver).toBeNull();
  });

  it.each(['lost', 'diverged'] as const)(
    'falls back to the MOCK when the solver is %s, and stops stepping it',
    async (run) => {
      const s = sink();
      const warned: string[] = [];
      const solver = new FakeSolver();
      const link = await createFlowFieldLink({
        sink: s,
        mock: cpuField(0),
        solver: () => Promise.resolve(solver),
        warn: (m) => warned.push(m),
      });
      link.beforeFrame(budget);
      solver.run = run;
      solver.error = `${run}: the test says so`;
      link.beforeFrame(budget);
      expect(link.state().coupling).toBe('mock');
      expect(link.state().fallback).toContain(run);
      expect(link.state().fallback).toContain('the test says so');
      expect(s.calls.map((c) => c.kind)).toEqual(['solver', 'cpu']);
      expect(solver.steps).toBe(1);
      expect(solver.disposed).toBe(true);
      expect(warned).toHaveLength(1);
      link.beforeFrame(budget);
      expect(solver.steps).toBe(1);
      expect(s.calls).toHaveLength(2);
    },
  );

  it('treats a non-finite readback as divergence (the NaN never reaches the blend)', async () => {
    const s = sink();
    const solver = new FakeSolver();
    const link = await createFlowFieldLink({
      sink: s,
      mock: cpuField(0),
      solver: () => Promise.resolve(solver),
      warn: () => undefined,
    });
    solver.residual = Number.NaN;
    link.beforeFrame(budget);
    expect(link.state().coupling).toBe('mock');
    expect(link.state().fallback).toMatch(/diverged/);
    expect(solver.steps).toBe(0);
  });

  it('falls back when a step throws', async () => {
    const s = sink();
    const solver = new FakeSolver();
    solver.step = () => {
      throw new Error('queue gone');
    };
    const link = await createFlowFieldLink({
      sink: s,
      mock: cpuField(0),
      solver: () => Promise.resolve(solver),
      warn: () => undefined,
    });
    link.beforeFrame(budget);
    expect(link.state().fallback).toContain('queue gone');
    expect(s.calls.at(-1)?.kind).toBe('cpu');
  });

  // W2V-N19: the contract keeps the textures for the solver's lifetime; a solver that re-created
  // them would leave destroyed views bound, so the link rebinds instead of drawing them
  it('rebinds when the solver hands out new textures', async () => {
    const s = sink();
    const solver = new FakeSolver();
    const link = await createFlowFieldLink({
      sink: s,
      mock: cpuField(0),
      solver: () => Promise.resolve(solver),
    });
    link.beforeFrame(budget);
    expect(s.calls).toHaveLength(1);
    solver.field = solverField(1);
    link.beforeFrame(budget);
    expect(s.calls.map((c) => c.kind)).toEqual(['solver', 'solver']);
    expect(s.calls[1]?.field).toBe(solver.field);
  });

  it('falls back when the bind itself throws (a solver field the visuals cannot draw)', async () => {
    const s = sink();
    const solver = new FakeSolver();
    const link = await createFlowFieldLink({
      sink: {
        ...s,
        setFlowSolverField: () => {
          throw new Error('the solver near extent differs');
        },
      },
      mock: cpuField(0),
      solver: () => Promise.resolve(solver),
      warn: () => undefined,
    });
    expect(link.state().fallback).toContain('near extent differs');
    expect(solver.disposed).toBe(true);
    expect(s.calls.map((c) => c.kind)).toEqual(['cpu']);
  });

  it('disposes the solver with the link', async () => {
    const solver = new FakeSolver();
    const link = await createFlowFieldLink({
      sink: sink(),
      mock: cpuField(0),
      solver: () => Promise.resolve(solver),
    });
    link.dispose();
    expect(solver.disposed).toBe(true);
  });
});
