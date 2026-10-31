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
import {
  calloutGeometry,
  calloutPoint,
  calloutShownIn,
  componentAnchors,
  engineRings,
  projectPoint,
  screenBox,
} from '../hud/anchors';
import { FIELD_EXTENTS } from '../contracts/flow';
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
import { backingDpr, backingSize } from '../shell/pixelCap';
import { createSettleTracker, type SettleTracker } from '../shell/settle';
import { createPostFaults, stepFault } from '../shell/faults';
import {
  BOOT_CONFIGS,
  WARM_CONFIGS,
  configFor,
  createWarmScheduler,
  shownView,
  type WarmScheduler,
} from '../shell/warmUp';
import type { RasterReply, RasterRequest } from './mockRasterWorker';
import { applyOrbit, framedOrbit, orbitFromPose, orbitPose, type OrbitState } from '../shell/orbit';
import type { AppDiagnostics, CycleChoice, FromWorker, ToWorker } from '../shell/protocol';
import type { ViewMode } from '../contracts/ui';
import type { AxialAnchor, Rect } from '../hud/callouts';

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
/** Snapshot posts that may fail in a row before the overlay is told the app cannot go on. */
const MAX_FAILED_POSTS = 3;
/**
 * D4-91: the CPU a warm frame may spend on objects not drawn before (three's node builds), ms.
 * With the warm frame's draws and the real frame it stays inside a 16.7 ms frame; one object is
 * always let through, so a single slow build (a large material) can exceed it once.
 */
const WARM_BUDGET_MS = 4;

const anchors = componentAnchors(ENGINE_DEFINITION);
const calloutGeo = calloutGeometry(ENGINE_DEFINITION);
/** The engine's outside to the core nozzle (the cut views' label rows). */
const ENGINE_RINGS = engineRings(ENGINE_DEFINITION, 2.75);
/** Schlieren's content: the engine and the near field's jet (its framing, D4-92 zz). */
const SCHLIEREN_RINGS = engineRings(ENGINE_DEFINITION, FIELD_EXTENTS.near.xMax);
/** Schlieren's framing zooms out at most this much (the engine stays the subject). */
const SCHLIEREN_MIN_SCALE = 0.6;

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
  /** Why the last raster (or the raster worker) failed (W2A-I1: annunciated). */
  rasterError: string | null;
  mockRasterMs: number | null;
  mockRasters: number;
  orbit: OrbitState;
  /** D4-92 (zz): the orbit before Schlieren's framing (restored on leaving it), and the free area. */
  orbitBeforeSchlieren: OrbitState | null;
  free: Rect | null;
  size: { width: number; height: number };
  /** The device pixel ratio from the main thread, and the one rendered at (D4-85's cap). */
  dpr: number;
  renderDpr: number;
  /** D4-88: the frames the view has been settled in the asked mode. */
  settle: SettleTracker;
  settledFrames: number;
  warmUpMs: number;
  warmUpSteps: readonly { readonly name: string; readonly ms: number; readonly cpuMs: number }[];
  /** D4-91: the background warm-up, the mode being prepared (null: the asked view is shown). */
  warm: WarmScheduler;
  preparing: ViewMode | null;
  warmFrames: number;
  warmCpuMaxMs: number;
  /** The slowest warm frame's configuration and its slowest object (where a hitch comes from). */
  warmSlowest: string;
  /** D4-95: the background waited in the last frame (an input or a switch less than 1 s ago). */
  warmSuspended: boolean;
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

/** D4-85: the canvas at the CSS size, its backing store capped up to quality high. */
function applySize(a: App) {
  const { width, height } = a.size;
  a.renderDpr = backingDpr(width, height, a.dpr, a.core.view.quality);
  a.view.setSize(width, height, a.renderDpr);
}

/**
 * Applies the render state the core holds to the view (only what changed). D4-91: a view whose
 * configuration is not compiled yet waits (the shown view stays, `preparing` says so).
 */
function applyView(a: App) {
  const shown = shownView(a.core.view, a.appliedView, (id) => a.warm.isWarm(id));
  a.preparing = shown.preparing;
  const v = shown.view;
  const was = a.appliedView;
  if (was === v) return;
  a.appliedView = v;
  if (was !== null && was.quality !== v.quality) applySize(a);
  if (was?.viewMode !== v.viewMode) {
    if (v.viewMode === 'schlieren' || was?.viewMode === 'schlieren')
      frameSchlieren(a, v.viewMode === 'schlieren');
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

/** The raster worker is gone: raster on the frame from now on, and say so (annunciated). */
function rasterOnFrame(a: App, message: string) {
  a.rasterError = message;
  pushError(a, message);
  console.warn(message);
  a.raster = null;
  a.rasterDue.settled();
}

/** The raster worker (src/shell/mockRaster.ts: the raster is ~10 frames of CPU). */
function startRaster(a: App): Worker | null {
  try {
    const w = new Worker(new URL('./mockRasterWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<RasterReply>) => {
      const r = e.data;
      // W2A-N7: only the reply to the request in flight settles it (a late one is dropped)
      if (r.id !== a.rasterId) return;
      a.rasterDue.settled();
      if ('error' in r) {
        a.rasterError = `MOCK raster: ${r.error}`;
        pushError(a, a.rasterError);
        console.warn(`MOCK raster failed: ${r.error}`);
        return;
      }
      a.rasterError = null;
      a.mockRasterMs = r.ms;
      a.mockRasters++;
      a.fields?.setMock(r.field);
    };
    w.onerror = (e) => {
      // say so, and raster on the frame from now on (slower frames, never a stale field)
      rasterOnFrame(a, `MOCK raster worker failed (${e.message}): rasterizing on the frame`);
      w.terminate();
    };
    return w;
  } catch (e) {
    a.rasterError = `MOCK raster worker: ${e instanceof Error ? e.message : String(e)}: rasterizing on the frame`;
    pushError(a, a.rasterError);
    return null;
  }
}

/** Asks for a new MOCK raster when N1 moved or the last is old (one in flight at a time). */
function refreshMock(a: App, state: CycleState, nowMs: number) {
  // W2A-N7: a raster worker that never answers is given up on, visibly
  if (a.raster !== null && a.rasterDue.timedOut(nowMs)) {
    a.raster.terminate();
    rasterOnFrame(a, 'MOCK raster worker did not answer: rasterizing on the frame');
  }
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

function viewProjection(a: App): ArrayLike<number> {
  const cam = a.view.camera;
  cam.updateMatrixWorld();
  return cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
}

/** The callouts' anchors on screen (D4-92 zz: each on its part, as the mode shows it). */
function projectAnchors(a: App): AxialAnchor[] {
  const cam = a.view.camera;
  const vp = viewProjection(a);
  const u = a.view.uniforms;
  const view = {
    eye: [cam.position.x, cam.position.y, cam.position.z] as const,
    cutCenter: u.cutCenter.value,
    cutHalf: u.cutHalf.value,
  };
  // W2A-N10: only on a settled view (during a transition the parts are not at the anchors)
  const mode = a.core.view.viewMode;
  const shown = a.core.view.overlays.callouts && a.settledFrames > 0;
  return anchors.map((w) => {
    const p = projectPoint(
      vp,
      calloutPoint(w, mode, view, calloutGeo),
      a.size.width,
      a.size.height,
    );
    const visible = shown && calloutShownIn(mode, w.id) && p.visible;
    return { id: w.id, x: p.x, y: p.y, visible, priority: w.priority, axial: w.x };
  });
}

/**
 * D4-92 (zz): Schlieren's plume clear of the panels: entering it frames the engine and its jet in
 * the free area (an orbit, dollied out and panned), and leaving it puts the orbit back.
 */
function frameSchlieren(a: App, entering: boolean) {
  if (!entering) {
    if (a.orbitBeforeSchlieren !== null) a.orbit = a.orbitBeforeSchlieren;
    a.orbitBeforeSchlieren = null;
    return;
  }
  if (a.free === null) return;
  const pose = orbitPose(a.orbit);
  a.view.setCameraPose(pose.position, pose.target);
  const box = screenBox(viewProjection(a), SCHLIEREN_RINGS, a.size.width, a.size.height);
  if (box === null) return;
  a.orbitBeforeSchlieren = a.orbit;
  a.orbit = framedOrbit(
    a.orbit,
    box,
    { w: a.size.width, h: a.size.height },
    a.free,
    a.view.camera.fov,
    SCHLIEREN_MIN_SCALE,
  );
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

/**
 * D4-91: one warm frame in this frame's slot, if it has one (src/shell/warmUp.ts): the asked
 * view's configuration first, then the background order. A warm frame that throws is an error,
 * said, and its configuration is given up on (shown anyway), never a stuck "preparing". D4-95:
 * the background waits while a switch is pending (the asked view not shown yet, or its transition
 * not settled) and for a second after it and after any input (handle()).
 */
function warmSlot(a: App, frame: number, lastFrameMs: number) {
  const nowMs = performance.now();
  const switchPending = a.preparing !== null || a.settledFrames === 0;
  const id = a.warm.next(frame, lastFrameMs, configFor(a.core.view), { nowMs, switchPending });
  a.warmSuspended = a.warm.suspended(nowMs);
  if (id === null) return;
  try {
    const r = a.view.warmFrame(WARM_CONFIGS[id], { cpuMs: WARM_BUDGET_MS });
    a.warmFrames++;
    if (r.cpuMs > a.warmCpuMaxMs) {
      a.warmCpuMaxMs = r.cpuMs;
      a.warmSlowest = `${id}: ${r.slowest.name} ${r.slowest.ms.toFixed(0)} ms, outside the draws ${r.outsideMs.toFixed(0)} ms`;
    }
    if (r.done) a.warm.done(id);
  } catch (e) {
    a.warm.done(id);
    const msg = `warm-up ${id}: ${e instanceof Error ? e.message : String(e)}`;
    pushError(a, msg);
    console.warn(msg);
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
  const postFaults = createPostFaults(MAX_FAILED_POSTS);
  let lastFrameMs = 0;
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
      // a throwing model is a bug: stop the sim, keep rendering, say so (never silent): the
      // overlay annunciates SIM STOPPED with this message (W2A-I1; src/shell/faults.ts)
      const fault = stepFault(() => {
        a.core.advance(dt);
      });
      if (fault !== null) {
        a.simFailed = true;
        pushError(a, fault);
        post({ type: 'sim-stopped', message: fault });
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
    warmSlot(a, frame, lastFrameMs);
    a.view.frame(Math.min(dt, 0.1));
    a.settledFrames = a.settle.frame(
      a.core.view.viewMode,
      a.view.viewSettled() && a.preparing === null,
    );
    if (frame % TIMINGS_EVERY === 0) {
      stats = a.view.stats();
      const m = stats.timings;
      renderMs = m.frames > 0 && Number.isFinite(m.gpuTotal) ? m.gpuTotal : null;
      flowVisualsMs = stats.flow.mode === null ? null : stats.flow.visualsMs;
    }
    lastFrameMs = performance.now() - t0;
    frameMs.push(lastFrameMs, held);
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
        raster: { onFrame: a.raster === null, lastError: a.rasterError },
        view: {
          mode: a.core.view.viewMode,
          settledFrames: a.settledFrames,
          preparing: a.preparing,
        },
        warm: {
          ...a.warm.state(),
          frames: a.warmFrames,
          cpuMaxMs: a.warmCpuMaxMs,
          slowest: a.warmSlowest,
          gaveUp: a.warm.gaveUp(),
          suspended: a.warmSuspended,
        },
        backingStore: {
          ...backingSize(a.size.width, a.size.height, a.renderDpr),
          dpr: a.renderDpr,
        },
        warmUpMs: a.warmUpMs,
        warmUpSteps: a.warmUpSteps,
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
          engineBox: screenBox(viewProjection(a), ENGINE_RINGS, a.size.width, a.size.height),
          refused: a.refused.splice(0),
        });
        postFaults.posted();
      } catch (e) {
        // the errors travel in the snapshot, so a post that keeps failing (a DataCloneError)
        // would freeze the overlay with no message: say so once it is not a one-off (W2A-N2)
        const f = postFaults.failed(e);
        pushError(a, f.error);
        if (f.fatal !== null) post({ type: 'fatal', message: f.fatal });
      }
    }
    frame++;
    scope.requestAnimationFrame(tick);
  };
  scope.requestAnimationFrame(tick);
}

function handle(a: App, m: ToWorker) {
  // D4-95: the viewer's input suspends the background warm-up for a second (the overlay's own
  // layout report, viewArea, is not an input: it follows the panels and the window)
  if (m.type !== 'init' && m.type !== 'viewArea') a.warm.input(performance.now());
  switch (m.type) {
    case 'init':
      return;
    case 'resize':
      a.size = { width: m.width, height: m.height };
      a.dpr = m.dpr;
      applySize(a);
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
    case 'viewArea':
      a.free = m.free;
      return;
    case 'camera': {
      a.orbitBeforeSchlieren = null;
      const p = LOOK_PRESETS[m.preset];
      a.view.camera.fov = p.fovDeg;
      a.view.camera.updateProjectionMatrix();
      a.orbit = orbitFromPose(p.camera, p.target);
      return;
    }
    case 'field':
      // drawn once bound; a fallback and its reason are in the switch's state (D4-82). A choice
      // that throws (the fallback's own bind) is an error, never an unhandled rejection (W2A-N1)
      a.fields?.choose(m.source).catch((e: unknown) => {
        const msg = `field ${m.source}: ${e instanceof Error ? e.message : String(e)}`;
        pushError(a, msg);
        console.warn(msg);
      });
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
  const cycle = createCycleModel(cycleOptions(m.cycle ?? 'reference'));
  const core = createSimCore({ cycle });
  // D4-85: the backing store capped from the first frame
  const renderDpr = backingDpr(m.width, m.height, m.dpr, core.view.quality);
  const view = await createEngineView({
    gpu: navigator.gpu,
    canvas: m.canvas,
    definition: ENGINE_DEFINITION,
    width: m.width,
    height: m.height,
    dpr: renderDpr,
    preferredLimits: FLOW_SOLVER_LIMITS,
    onError,
  });
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
    rasterError: null,
    mockRasterMs: null,
    mockRasters: 0,
    orbit: orbitFromPose(preset.camera, preset.target),
    orbitBeforeSchlieren: null,
    free: null,
    size: { width: m.width, height: m.height },
    dpr: m.dpr,
    renderDpr,
    settle: createSettleTracker(),
    settledFrames: 0,
    warmUpMs: 0,
    warmUpSteps: [],
    warm: createWarmScheduler(),
    preparing: null,
    warmFrames: 0,
    warmCpuMaxMs: 0,
    warmSlowest: '',
    warmSuspended: false,
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
  // D4-91: the boot view's pipelines compiled behind the boot spinner (the MOCK is bound, so the
  // flow layers draw); the other modes warm in the background once the app runs
  const warm = await view.warmUp(BOOT_CONFIGS.map((id) => WARM_CONFIGS[id]));
  for (const id of BOOT_CONFIGS) a.warm.done(id);
  a.warmUpMs = warm.ms;
  a.warmUpSteps = warm.configurations;
  // messages wait in `pending` until the field is bound (a 'field' choice needs the switch)
  app = a;
  for (const p of pending.splice(0)) handle(a, p);
  post({
    type: 'ready',
    adapter: `${view.device.info.vendor} ${view.device.info.description}`.trim(),
    warmUpMs: warm.ms,
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
