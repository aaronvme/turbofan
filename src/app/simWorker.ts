// The app's sim + render worker (D2-4): the transient cycle model, the live GPU flow solver and
// the engine render run here, on an OffscreenCanvas; the React overlay on the main thread sees
// only what this posts (frozen snapshots with diagnostics and callout anchors) and sends only
// messages (SimCommandMessages, resize/DPR, the orbit event proxy). The spike's three.js
// workarounds hold: no DOM (the view is worker-safe, its studio procedural, so no loader at all
// is needed, not even ImageBitmapLoader), setSize(w, h, false), and DPR and size from the main
// thread.
//
// Each frame: drain the commands, advance the clock and step the cycle model on the wall step
// (src/shell/simCore.ts), hand the state to the view (spools, glow), run the solver at D4-2's
// budget, min(5 ms, 15 ms - measured render - measured flow visuals) with a floor of 2
// iterations (src/flow/gpu/scheduler.ts), render, and every third frame publish a snapshot whose
// sources come from the models (W1F-N1). Device loss and GPU errors are posted as they happen,
// never swallowed.

import { createCycleModel } from '../cycle/model';
import { ENGINE_DEFINITION } from '../engine/definition';
import { GpuFlowSolver } from '../flow/gpu/device/flowSolver';
import { solverBudgetMs } from '../flow/gpu/scheduler';
import { loadMeshAsset, parseMeshManifest } from '../flow/mesh/loader';
import type { FlowVizModeId } from '../flow/viz/modes';
import { FLOW_SOLVER_LIMITS, type GpuErrorReport } from '../gpu/device';
import { anchorWorld, componentAnchors, projectPoint } from '../hud/anchors';
import { createMockFlowField } from '../mocks/mockFlowField';
import { createEngineView, type EngineView } from '../render/engineView';
import { LOOK_PRESETS } from '../render/presets';
import type { FlowSource, FlowStatus } from '../contracts/sim';
import type { RenderState } from '../contracts/ui';
import type { CycleState } from '../contracts/cycle';
import { createSimCore, type SimCore } from '../shell/simCore';
import { applyOrbit, orbitFromPose, orbitPose, type OrbitState } from '../shell/orbit';
import type { AppDiagnostics, FieldChoice, FromWorker, ToWorker } from '../shell/protocol';
import type { Anchor } from '../hud/callouts';

interface Scope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker): void;
  requestAnimationFrame(cb: (t: number) => void): number;
}
const scope = globalThis as unknown as Scope;
const post = (m: FromWorker) => {
  scope.postMessage(m);
};

/** A snapshot every this many frames (20 Hz at 60 fps: D2-9's realistic React load is 15 Hz). */
const PUBLISH_EVERY = 3;
/** stats() walks the scene to count draws: read the timings this often (as P1 does). */
const TIMINGS_EVERY = 15;
/** The MOCK field is re-rasterized from the cycle state when N1 moved this far, %, or after 2 s. */
const MOCK_FIELD_N1_STEP = 1.5;
const MOCK_FIELD_MAX_AGE_MS = 2000;
const MAX_ERRORS = 8;

const anchors = componentAnchors(ENGINE_DEFINITION);

class Rolling {
  private readonly xs: number[] = [];
  push(x: number) {
    this.xs.push(x);
    if (this.xs.length > 30) this.xs.shift();
  }
  median(): number {
    if (this.xs.length === 0) return 0;
    const s = [...this.xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  }
}

interface App {
  view: EngineView;
  core: SimCore;
  cycle: ReturnType<typeof createCycleModel>;
  flow: GpuFlowSolver;
  flowReady: boolean;
  flowInitError: string | null;
  field: FieldChoice;
  boundField: FlowSource;
  mockAt: { n1: number; t: number } | null;
  orbit: OrbitState;
  size: { width: number; height: number };
  appliedView: RenderState | null;
  errors: string[];
  refused: string[];
  lost: boolean;
  simFailed: boolean;
}

let app: App | null = null;
const pending: ToWorker[] = [];

function pushError(a: App, message: string) {
  a.errors.push(message);
  if (a.errors.length > MAX_ERRORS) a.errors.shift();
}

function flowModeFor(v: RenderState): FlowVizModeId | null {
  switch (v.viewMode) {
    case 'realistic':
      return v.overlays.particles ? 'realistic' : null;
    case 'cutaway':
      return 'cutaway';
    case 'schlieren':
      return 'schlieren';
    case 'data':
      return 'data';
    case 'exploded':
      return null;
  }
}

/** Applies the render state the core holds to the view (only what changed). */
function applyView(a: App) {
  const v = a.core.view;
  const was = a.appliedView;
  if (was === v) return;
  a.appliedView = v;
  if (was?.viewMode !== v.viewMode || was.overlays.particles !== v.overlays.particles) {
    const fm = flowModeFor(v);
    a.view.setFlowMode(fm);
    if (fm === null) a.view.setMode(v.viewMode === 'exploded' ? 'exploded' : 'realistic');
  }
  if (was?.quality !== v.quality)
    a.view.setProfile(v.quality === 'low' || v.quality === 'medium' ? 'performance' : 'quality');
  if (was?.particleTimeDilation !== v.particleTimeDilation)
    a.view.setFlowTimeScale(Math.min(1, 1 / v.particleTimeDilation));
}

function bindField(a: App, state: CycleState, nowMs: number) {
  if (a.field === 'solver' && a.flowReady) {
    if (a.boundField !== 'solver') {
      a.view.setFlowSolverField(a.flow.fields());
      a.boundField = 'solver';
    }
    return;
  }
  // the labelled MOCK, scaled by the cycle's own state (sources.flow says 'mock')
  const stale =
    a.mockAt === null ||
    a.boundField !== 'mock' ||
    Math.abs(state.n1Percent - a.mockAt.n1) > MOCK_FIELD_N1_STEP ||
    nowMs - a.mockAt.t > MOCK_FIELD_MAX_AGE_MS;
  if (!stale) return;
  a.view.setFlowField(createMockFlowField(ENGINE_DEFINITION, state, a.core.inputs.ambient));
  a.mockAt = { n1: state.n1Percent, t: nowMs };
  a.boundField = 'mock';
}

function flowStatus(a: App): FlowStatus {
  if (a.flowInitError !== null)
    return {
      status: 'unavailable',
      error: `solver init failed: ${a.flowInitError}`,
      mode: a.core.solverMode,
      stats: null,
      reduction: null,
    };
  return a.flow.status();
}

function projectAnchors(a: App): Anchor[] {
  const cam = a.view.camera;
  cam.updateMatrixWorld();
  const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
  const theta = Math.atan2(cam.position.z, cam.position.y);
  const shown = a.core.view.viewMode !== 'exploded' && a.core.view.overlays.callouts;
  return anchors.map((w) => {
    const p = projectPoint(vp, anchorWorld(w, theta), a.size.width, a.size.height);
    return { id: w.id, x: p.x, y: p.y, visible: shown && p.visible, priority: w.priority };
  });
}

async function startSolver(a: App) {
  try {
    const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
    const entry = manifest.specs['130k'];
    if (entry === undefined) throw new Error('the mesh manifest has no 130k entry');
    const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
    const { asset } = await loadMeshAsset(bytes, entry);
    await a.flow.init({ device: a.view.device.device, mesh: asset, definition: ENGINE_DEFINITION });
    a.flowReady = true;
  } catch (e) {
    a.flowInitError = e instanceof Error ? e.message : String(e);
    pushError(a, `flow solver: ${a.flowInitError}`);
  }
}

function loop(a: App) {
  let last: number | null = null;
  let frame = 0;
  let renderMs: number | null = null;
  let flowVisualsMs: number | null = null;
  let iterations = 0;
  let budget = 0;
  const cycleMs = new Rolling();
  const frameMs = new Rolling();
  const stamps: number[] = [];
  let stats = a.view.stats();
  const tick = (t: number) => {
    if (a.lost) return;
    const t0 = performance.now();
    const dt = last === null ? 1 / 60 : (t - last) / 1000;
    last = t;
    stamps.push(t);
    while (stamps.length > 0 && t - (stamps[0] ?? t) > 1000) stamps.shift();
    applyView(a);
    if (!a.simFailed) {
      const c0 = performance.now();
      try {
        a.core.advance(dt);
      } catch (e) {
        // a throwing model is a bug: stop the sim, keep rendering, say so (never silent)
        a.simFailed = true;
        const msg = `cycle step failed: ${e instanceof Error ? e.message : String(e)}`;
        pushError(a, msg);
        post({ type: 'fatal', message: msg });
      }
      cycleMs.push(performance.now() - c0);
    }
    const state = a.core.state();
    a.view.setCycleState(state, a.cycle.source);
    bindField(a, state, t);
    if (a.flowReady) {
      budget = solverBudgetMs({ renderMs, flowVisualsMs });
      iterations = a.flow.step({ gpuTimeBudgetMs: budget, maxIterations: 1000 }).iterationsThisStep;
    }
    const pose = orbitPose(a.orbit);
    a.view.setCameraPose(pose.position, pose.target);
    a.view.frame(Math.min(dt, 0.1));
    if (frame % TIMINGS_EVERY === 0) {
      stats = a.view.stats();
      const m = stats.timings;
      renderMs = m.frames > 0 && Number.isFinite(m.gpuTotal) ? m.gpuTotal : null;
      flowVisualsMs = stats.flow.mode === null ? null : stats.flow.visualsMs;
    }
    frameMs.push(performance.now() - t0);
    if (frame % PUBLISH_EVERY === 0) {
      const flow = flowStatus(a);
      const diagnostics: AppDiagnostics = {
        budget: {
          renderGpuMs: renderMs,
          flowVisualsGpuMs: flowVisualsMs ?? 0,
          solverGpuMs: flow.stats?.gpuTimeMs ?? null,
          solverBudgetMs: budget,
          solverIterations: iterations,
          msPerIteration: a.flow.msPerIteration,
          cycleCpuMs: cycleMs.median(),
          frameCpuMs: frameMs.median(),
          fps: stamps.length,
        },
        lostSolveCause: a.cycle.lostSolveCause(),
        errors: [...a.errors],
        adapter: `${a.view.device.info.vendor} ${a.view.device.info.architecture}`.trim(),
        triangles: stats.triangles,
        renderScale: stats.renderScale,
      };
      try {
        post({
          type: 'snapshot',
          snapshot: a.core.snapshot({ flow, flowSource: a.boundField }),
          diagnostics,
          anchors: projectAnchors(a),
          refused: a.refused.splice(0),
        });
      } catch (e) {
        pushError(a, `snapshot: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    frame++;
    scope.requestAnimationFrame(tick);
  };
  scope.requestAnimationFrame(tick);
}

function handle(a: App, m: ToWorker) {
  switch (m.type) {
    case 'init':
      return;
    case 'resize':
      a.size = { width: m.width, height: m.height };
      a.view.setSize(m.width, m.height, m.dpr);
      return;
    case 'command': {
      const problems = a.core.command(m.message);
      if (problems.length > 0) a.refused.push(...problems);
      if (m.message.command.type === 'setSolverMode') a.flow.setMode(a.core.solverMode);
      return;
    }
    case 'orbit':
      a.orbit = applyOrbit(a.orbit, m.input);
      return;
    case 'camera': {
      const p = LOOK_PRESETS[m.preset];
      a.view.camera.fov = p.fovDeg;
      a.view.camera.updateProjectionMatrix();
      a.orbit = orbitFromPose(p.camera, p.target);
      return;
    }
    case 'field':
      a.field = m.source;
      a.mockAt = null;
      return;
  }
}

async function init(m: Extract<ToWorker, { type: 'init' }>) {
  let appRef: App | null = null;
  const onError = (r: GpuErrorReport) => {
    const message = `${r.kind}: ${r.message}`;
    if (appRef !== null) {
      pushError(appRef, message);
      appRef.flow.reportGpuError(message);
    }
    if (r.kind === 'device-lost') {
      if (appRef !== null) appRef.lost = true;
      post({
        type: 'device-lost',
        message: r.message === '' ? 'the GPU device was lost' : r.message,
      });
    } else post({ type: 'gpu-error', message });
  };
  const view = await createEngineView({
    gpu: navigator.gpu,
    canvas: m.canvas,
    definition: ENGINE_DEFINITION,
    width: m.width,
    height: m.height,
    dpr: m.dpr,
    preferredLimits: FLOW_SOLVER_LIMITS,
    onError,
  });
  const cycle = createCycleModel();
  const core = createSimCore({ cycle });
  const preset = LOOK_PRESETS.threeQuarterFront;
  const a: App = {
    view,
    core,
    cycle,
    flow: new GpuFlowSolver(),
    flowReady: false,
    flowInitError: null,
    field: 'mock',
    boundField: 'none',
    mockAt: null,
    orbit: orbitFromPose(preset.camera, preset.target),
    size: { width: m.width, height: m.height },
    appliedView: null,
    errors: [],
    refused: [],
    lost: false,
    simFailed: false,
  };
  appRef = a;
  app = a;
  for (const p of pending.splice(0)) handle(a, p);
  post({
    type: 'ready',
    adapter: `${view.device.info.vendor} ${view.device.info.description}`.trim(),
  });
  void startSolver(a);
  loop(a);
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    init(m).catch((err: unknown) => {
      post({
        type: 'fatal',
        message: `init failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
    return;
  }
  if (app === null) pending.push(m);
  else handle(app, m);
};
