// The look-dev flow panel's field link in the installed Chrome (w2/flowviz round 3; D4-82,
// W2V-I1, W2V-I6): the badge says "solver (uncoupled until W3)" over the solver's field, and a
// solver that cannot start or is lost mid-run is replaced by the MOCK at once, with the reason on
// the badge and the legend, and the page keeps running (round 2 threw out of createFlowPanel).
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../src/contracts/ambient';
import {
  FIELD_EXTENTS,
  fieldReferenceFromAmbient,
  type FieldExtent,
  type FlowField,
} from '../../src/contracts/flow';
import type { FlowRunStatus, FlowStatus } from '../../src/contracts/sim';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import type { LinkedSolver } from '../../src/flow/viz/fieldLink';
import { createFlowPanel } from '../../src/lookdev/flowPanel';
import { createEngineView, type EngineView } from '../../src/render/engineView';

const W = 640;
const H = 360;

/** A stand-in solver on the view's device: blank textures, a status the test sets. */
function fakeSolver(device: GPUDevice) {
  const textures: GPUTexture[] = [];
  const pair = (e: FieldExtent) => {
    const t = () => {
      const tex = device.createTexture({
        size: [e.width, e.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      textures.push(tex);
      return tex;
    };
    return { state: t(), velocity: t() };
  };
  const field: FlowField = {
    source: 'solver',
    coupling: 'uncoupled',
    reference: fieldReferenceFromAmbient(ISA_SLS),
    extents: FIELD_EXTENTS,
    near: pair(FIELD_EXTENTS.near),
    far: pair(FIELD_EXTENTS.far),
    version: 0,
  };
  const s = {
    run: 'running' as FlowRunStatus,
    error: null as string | null,
    steps: 0,
    disposed: false,
  };
  const solver: LinkedSolver = {
    fields: () => field,
    status: (): FlowStatus => ({
      status: s.run,
      error: s.error,
      mode: 'tracking',
      stats: null,
      reduction: null,
    }),
    step: () => {
      s.steps++;
      return {
        iterationsThisStep: 0,
        totalIterations: s.steps,
        gpuTimeMs: null,
        residualDensityL2: null,
        physicalTimeS: 0,
      };
    },
    dispose: () => {
      s.disposed = true;
      for (const t of textures) t.destroy();
    },
  };
  return { solver, s };
}

const text = (sel: string): string => document.querySelector(sel)?.textContent ?? '';

describe('flow panel field link (D4-82, W2V-I6)', () => {
  const views: EngineView[] = [];
  afterEach(() => {
    for (const id of ['flow', 'legend']) document.getElementById(id)?.remove();
  });
  afterAll(async () => {
    for (const v of views) await v.dispose();
  });

  async function view(): Promise<EngineView> {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    document.body.appendChild(c);
    const v = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
    });
    views.push(v);
    return v;
  }

  it('falls back to the MOCK, with the reason on the badge, when the solver cannot start', async () => {
    const v = await view();
    const panel = await createFlowPanel(v, new URLSearchParams('field=solver&flow=data'), () =>
      Promise.reject(new Error('the device lacks FLOW_SOLVER_LIMITS')),
    );
    for (let k = 0; k < 5; k++) {
      panel.beforeFrame();
      v.frame(1 / 60);
    }
    const st = panel.linkState();
    expect(st).toMatchObject({ asked: 'solver', coupling: 'mock' });
    expect(st.fallback).toMatch(/solver unavailable: the device lacks FLOW_SOLVER_LIMITS/);
    expect(v.stats().flow.coupling).toBe('mock');
    expect(text('#flow-src-t')).toMatch(/^MOCK fallback/);
    expect(text('#flow-src-t')).toContain('FLOW_SOLVER_LIMITS');
    expect(document.querySelector('#flow-src')?.classList.contains('fallback')).toBe(true);
    expect(text('#legend .badge')).toMatch(/^MOCK fallback/);
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
  });

  it("labels the solver's field uncoupled until W3, then falls back when it is lost mid-run", async () => {
    const v = await view();
    const fake = fakeSolver(v.device.device);
    const panel = await createFlowPanel(v, new URLSearchParams('field=solver&flow=cutaway'), () =>
      Promise.resolve(fake.solver),
    );
    for (let k = 0; k < 5; k++) {
      panel.beforeFrame();
      v.frame(1 / 60);
    }
    expect(panel.linkState()).toEqual({ asked: 'solver', coupling: 'uncoupled', fallback: null });
    expect(v.stats().flow.coupling).toBe('uncoupled');
    expect(text('#flow-src-t')).toMatch(/solver \(uncoupled until W3\)/);
    expect(text('#legend .badge')).toMatch(/solver \(uncoupled until W3\)/);
    expect(fake.s.steps).toBe(5);
    fake.s.run = 'lost';
    fake.s.error = 'GPU device lost: the test removed it';
    for (let k = 0; k < 5; k++) {
      panel.beforeFrame();
      v.frame(1 / 60);
    }
    expect(panel.linkState().coupling).toBe('mock');
    expect(panel.linkState().fallback).toMatch(/solver lost: GPU device lost/);
    expect(v.stats().flow.coupling).toBe('mock');
    expect(text('#flow-src-t')).toMatch(/^MOCK fallback/);
    expect(document.querySelector('#legend .badge')?.classList.contains('fallback')).toBe(true);
    expect(fake.s.steps).toBe(5);
    expect(fake.s.disposed).toBe(true);
    await v.device.device.queue.onSubmittedWorkDone();
    expect(v.stats().errors).toEqual([]);
  });
});
