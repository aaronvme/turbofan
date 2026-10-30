// The app's sim + render worker (D2-4): the transient cycle model, the live GPU flow solver and
// the engine render run here, on an OffscreenCanvas; the React overlay on the main thread sees
// only what this posts (frozen snapshots with diagnostics and callout anchors) and sends only
// messages (SimCommandMessages, resize/DPR, the orbit event proxy). The spike's three.js
// workarounds hold: no DOM (the view is worker-safe, its studio procedural, so no loader at all
// is needed, not even ImageBitmapLoader), setSize(w, h, false), and DPR and size from the main
// thread.
//
// Each frame: drain the commands, advance the clock and step the cycle model on the wall step
// (src/shell/simCore.ts), hand the state to the view (spools, glow), and draw the field the viewer
// chose through the field switch (src/shell/fieldSwitch.ts, D4-82): the labelled MOCK, or the live
// solver, labelled uncoupled until W3, stepped at D4-2's budget, min(5 ms, 15 ms - measured render
// - measured flow visuals) with a floor of 2 iterations (src/flow/gpu/scheduler.ts), while a flow
// mode draws it. A solver that cannot start, is lost or diverged falls back to the MOCK at once,
// with the reason in the diagnostics the badge reads (visible, never silent). Then render, and
// every third frame publish a snapshot whose sources come from the models (W1F-N1). Device loss
// and GPU errors are posted as they happen, never swallowed.

import { PART_POWER_FIT_CALIBRATION, referenceEngine } from '../cycle/engine';
import { createCycleModel } from '../cycle/model';
import { withCalibration } from '../cycle/partPower';
import { ENGINE_DEFINITION } from '../engine/definition';
import { GpuFlowSolver } from '../flow/gpu/device/flowSolver';
import { solverBudgetMs } from '../flow/gpu/scheduler';
import { loadMeshAsset, parseMeshManifest } from '../flow/mesh/loader';
import { FLOW_SOLVER_LIMITS, type GpuErrorReport } from '../gpu/device';
import { anchorWorld, componentAnchors, projectPoint } from '../hud/anchors';
import { createMockFlowField } from '../mocks/mockFlowField';
import { createEngineView, type EngineView } from '../render/engineView';
import { LOOK_PRESETS } from '../render/presets';
import { sanitizeFlowStatus, type FlowStatus } from '../contracts/sim';
import type { RenderState } from '../contracts/ui';
import type { CycleState } from '../contracts/cycle';
import { createSimCore, type SimCore } from '../shell/simCore';
import { createFieldSwitch, type FieldSwitch } from '../shell/fieldSwitch';
import { cutPlaneQuantity, flowModeFor } from '../shell/viewState';
import { createRasterScheduler, type RasterScheduler } from '../shell/mockRaster';
import type { RasterReply, RasterRequest } from './mockRasterWorker';
import { applyOrbit, orbitFromPose, orbitPose, type OrbitState } from '../shell/orbit';
import type { AppDiagnostics, CycleChoice, FromWorker, ToWorker } from '../shell/protocol';
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
/** The frame-cost window, frames (2 s at 60 fps: a held episode's frames stay in view). */
const COST_WINDOW = 120;
const MAX_ERRORS = 8;

const anchors = componentAnchors(ENGINE_DEFINITION);

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
};

/** The last `size` frames' ms, each tagged with whether the gas path was held (W2F-N5). */
class Rolling {
  private readonly xs: { ms: number; held: boolean }[] = [];
  constructor(private readonly size: number) {}
  push(ms: number, held: boolean) {
    this.xs.push({ ms, held });
    if (this.xs.length > this.size) this.xs.shift();
  }
  median(): number {
    return median(this.xs.map((x) => x.ms)) ?? 0;
  }
  max(): number {
    return this.xs.reduce((m, x) => Math.max(m, x.ms), 0);
  }
  heldMedian(): number | null {
    return median(this.xs.filter((x) => x.held).map((x) => x.ms));
  }
}

interface App {
  view: EngineView;
  core: SimCore;
  cycle: ReturnType<typeof createCycleModel>;
  flow: GpuFlowSolver;
  flowInitError: string | null;
  /** What is drawn (D4-82); null until the first MOCK raster is bound. */
  fields: FieldSwitch | null;
  /** The MOCK raster's own worker (null: it failed, so the raster runs here, on the frame). */
  raster: Worker | null;
  rasterDue: RasterScheduler;
  rasterId: number;
  mockRasterMs: number | null;
  mockRasters: number;
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

/** Applies the render state the core holds to the view (only what changed). */
function applyView(a: App) {
  const v = a.core.view;
  const was = a.appliedView;
  if (was === v) return;
  a.appliedView = v;
  if (was?.viewMode !== v.viewMode) {
    // D4-83: Realistic draws its haze and schlieren always, its tracers only when asked
    const fm = flowModeFor(v.viewMode);
    a.view.setFlowMode(fm);
    if (fm === null) a.view.setMode('exploded');
  }
  if (was?.viewMode !== v.viewMode || was.overlays.particles !== v.overlays.particles)
    a.view.setFlowTracers(v.overlays.particles);
  const q = cutPlaneQuantity(v);
  if (was === null || cutPlaneQuantity(was) !== q) a.view.setFlowQuantity(q);
  if (was?.quality !== v.quality)
    a.view.setProfile(v.quality === 'low' || v.quality === 'medium' ? 'performance' : 'quality');
  if (was?.particleTimeDilation !== v.particleTimeDilation)
    a.view.setFlowTimeScale(Math.min(1, 1 / v.particleTimeDilation));
}

/** The MOCK raster of the cycle's own state, here on the frame (the boot raster, a fallback). */
function rasterHere(a: App, state: CycleState) {
  const r0 = performance.now();
  const field = createMockFlowField(ENGINE_DEFINITION, state, a.core.inputs.ambient);
  a.mockRasterMs = performance.now() - r0;
  a.mockRasters++;
  return field;
}

/** The raster worker (src/shell/mockRaster.ts: the raster is ~10 frames of CPU). */
function startRaster(a: App): Worker | null {
  try {
    const w = new Worker(new URL('./mockRasterWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<RasterReply>) => {
      a.rasterDue.settled();
      const r = e.data;
      if ('error' in r) {
        pushError(a, `MOCK raster: ${r.error}`);
        console.warn(`MOCK raster failed: ${r.error}`);
        return;
      }
      a.mockRasterMs = r.ms;
      a.mockRasters++;
      a.fields?.setMock(r.field);
    };
    w.onerror = (e) => {
      // say so, and raster on the frame from now on (slower frames, never a stale field)
      const msg = `MOCK raster worker failed (${e.message}): rasterizing on the frame`;
      pushError(a, msg);
      console.warn(msg);
      w.terminate();
      a.raster = null;
      a.rasterDue.settled();
    };
    return w;
  } catch (e) {
    pushError(a, `MOCK raster worker: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Asks for a new MOCK raster when N1 moved or the last is old (one in flight at a time). */
function refreshMock(a: App, state: CycleState, nowMs: number) {
  if (a.fields === null || !a.rasterDue.due(state.n1Percent, nowMs)) return;
  a.rasterDue.requested(state.n1Percent, nowMs);
  if (a.raster === null) {
    a.fields.setMock(rasterHere(a, state));
    a.rasterDue.settled();
    return;
  }
  const req: RasterRequest = { id: ++a.rasterId, state, ambient: a.core.inputs.ambient };
  a.raster.postMessage(req);
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
  // a non-finite readback is a divergence, said as such (the snapshot carries finite data)
  return sanitizeFlowStatus(a.flow.status());
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

/** Starts the solver at boot (its status shows in the diagnostics); rejects with why it failed. */
async function startSolver(a: App): Promise<GpuFlowSolver> {
  try {
    const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
    const entry = manifest.specs['130k'];
    if (entry === undefined) throw new Error('the mesh manifest has no 130k entry');
    const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
    const { asset } = await loadMeshAsset(bytes, entry);
    await a.flow.init({ device: a.view.device.device, mesh: asset, definition: ENGINE_DEFINITION });
    return a.flow;
  } catch (e) {
    a.flowInitError = e instanceof Error ? e.message : String(e);
    pushError(a, `flow solver: ${a.flowInitError}`);
    a.flow.dispose();
    throw e;
  }
}

function loop(a: App) {
  let last: number | null = null;
  let frame = 0;
  let renderMs: number | null = null;
  let flowVisualsMs: number | null = null;
  let budget = 0;
  const cycleMs = new Rolling(COST_WINDOW);
  const frameMs = new Rolling(COST_WINDOW);
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
    let held = false;
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
      held = a.core.state().gasPathSolve.status === 'held';
      cycleMs.push(performance.now() - c0, held);
    }
    const state = a.core.state();
    a.view.setCycleState(state, a.cycle.source);
    refreshMock(a, state, t);
    budget = solverBudgetMs({ renderMs, flowVisualsMs });
    // the drawn solver steps while a flow mode draws it; its health check runs every frame
    const stepping = a.fields?.drawn() === 'solver' && flowModeFor(a.core.view.viewMode) !== null;
    a.fields?.beforeFrame(stepping ? { gpuTimeBudgetMs: budget, maxIterations: 1000 } : null);
    const pose = orbitPose(a.orbit);
    a.view.setCameraPose(pose.position, pose.target);
    a.view.frame(Math.min(dt, 0.1));
    if (frame % TIMINGS_EVERY === 0) {
      stats = a.view.stats();
      const m = stats.timings;
      renderMs = m.frames > 0 && Number.isFinite(m.gpuTotal) ? m.gpuTotal : null;
      flowVisualsMs = stats.flow.mode === null ? null : stats.flow.visualsMs;
    }
    frameMs.push(performance.now() - t0, held);
    if (frame % PUBLISH_EVERY === 0) {
      const flow = flowStatus(a);
      const drawn = a.fields?.drawn() ?? 'none';
      const diagnostics: AppDiagnostics = {
        budget: {
          renderGpuMs: renderMs,
          flowVisualsGpuMs: flowVisualsMs ?? 0,
          solverGpuMs: drawn === 'solver' ? (flow.stats?.gpuTimeMs ?? null) : null,
          solverBudgetMs: budget,
          solverIterations: stepping ? (flow.stats?.iterationsThisStep ?? 0) : 0,
          msPerIteration: a.flow.msPerIteration,
          cycleCpuMs: cycleMs.median(),
          cycleCpuMaxMs: cycleMs.max(),
          cycleCpuHeldMs: cycleMs.heldMedian(),
          frameCpuMs: frameMs.median(),
          frameCpuMaxMs: frameMs.max(),
          frameCpuHeldMs: frameMs.heldMedian(),
          mockRasterMs: a.mockRasterMs,
          mockRasters: a.mockRasters,
          fps: stamps.length,
        },
        field: a.fields?.state() ?? null,
        lostSolveCause: a.cycle.lostSolveCause(),
        errors: [...a.errors],
        adapter: `${a.view.device.info.vendor} ${a.view.device.info.architecture}`.trim(),
        triangles: stats.triangles,
        renderScale: stats.renderScale,
      };
      try {
        post({
          type: 'snapshot',
          snapshot: a.core.snapshot({ flow, flowSource: drawn }),
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
      // drawn once bound; a fallback and its reason are in the switch's state (D4-82)
      void a.fields?.choose(m.source);
      return;
  }
}

function cycleOptions(c: CycleChoice) {
  return c === 'partPowerFit'
    ? { engine: withCalibration(referenceEngine(), PART_POWER_FIT_CALIBRATION) }
    : {};
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
  const cycle = createCycleModel(cycleOptions(m.cycle ?? 'reference'));
  const core = createSimCore({ cycle });
  const preset = LOOK_PRESETS.threeQuarterFront;
  const a: App = {
    view,
    core,
    cycle,
    flow: new GpuFlowSolver(),
    flowInitError: null,
    fields: null,
    raster: null,
    rasterDue: createRasterScheduler(),
    rasterId: 0,
    mockRasterMs: null,
    mockRasters: 0,
    orbit: orbitFromPose(preset.camera, preset.target),
    size: { width: m.width, height: m.height },
    appliedView: null,
    errors: [],
    refused: [],
    lost: false,
    simFailed: false,
  };
  appRef = a;
  // the solver starts at boot (the diagnostics show its status) and is drawn only when chosen
  const solver = startSolver(a);
  // a failed start is already reported (the errors, the flow status), and the switch's fallback
  // says so again if the solver is chosen: no unhandled rejection
  solver.catch(() => undefined);
  // the boot raster here (the field must be bound before the first frame), the rest off the frame
  const now = performance.now();
  a.rasterDue.requested(core.state().n1Percent, now);
  const boot = rasterHere(a, core.state());
  a.rasterDue.settled();
  a.raster = startRaster(a);
  a.fields = await createFieldSwitch({
    sink: view,
    mock: boot,
    solver: () => solver,
    warn: (message) => {
      console.warn(message);
      pushError(a, message);
    },
  });
  // messages wait in `pending` until the field is bound (a 'field' choice needs the switch)
  app = a;
  for (const p of pending.splice(0)) handle(a, p);
  post({
    type: 'ready',
    adapter: `${view.device.info.vendor} ${view.device.info.description}`.trim(),
  });
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
