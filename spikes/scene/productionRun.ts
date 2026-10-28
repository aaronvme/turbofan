// One P1 run of the app's GpuFlowSolver (D4-54) on the shipped 130k asset inside a 1080p scene:
// the W0 bench scene (benchApp.ts) or the app's own EngineView (appBench.ts). Each frame is one
// step() at D4-2's budget (solverBudgetMs from the scene's latest measured render and flow-visual
// GPU times), which runs the solver's own scheduler and the resample, then the scene renders. The
// frame's solver and resample GPU times come back through onFrameTiming, by field version, into
// the D0-1 run recorder (spikes/lib/benchRun.ts).
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { solverBudgetMs } from '../../src/flow/gpu/scheduler';
import { loadMeshAsset, parseMeshManifest } from '../../src/flow/mesh/loader';
import { solverMeshFromFile } from '../../src/flow/reference/solverMesh';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import type { GpuErrorReport } from '../../src/gpu/device';
import { perfState } from '../../tools/perf/solverPerf';
import { RunRecorder, aggregateRuns } from '../lib/benchRun';
import { median } from '../lib/stats';
import type { BenchConfig, ConfigResult } from './benchApp';

/**
 * The state is set back to its start every this many iterations (about every 25 frames). The
 * timing state (tools/perf/solverPerf.ts perfState: a jet, swirl, a pressure wave and a hot
 * fuel-air plume; not a solution) goes non-finite after about 150 iterations of the engine's
 * preconditioned tracking, on main's kernel too (the w2-solver-perf handoff), and a P1 run takes
 * about 14000. The upload sits between frames, outside the solver's timestamped pass.
 */
export const RESET_ITERATIONS = 100;

/** The scene side of a production run. */
export interface ProductionScene {
  /** Renders one frame of dt seconds (after the solver's step, which it may sample). */
  render(dtS: number): void;
  /** The latest measured render GPU ms (null before one): D4-2's "measured render". */
  renderMs(): number | null;
  /** The latest measured flow-visual GPU ms (null: none or not measured). */
  flowVisualsMs(): number | null;
  readonly triangles: number;
  /** The run's medians, read after the run. */
  readonly runRenderMs: number[];
  readonly runComputeMs: number[];
  dispose(): void;
}

export async function runProductionSolver(o: {
  readonly device: GPUDevice;
  readonly config: BenchConfig;
  readonly raf: (cb: (t: number) => void) => void;
  readonly size: readonly [number, number];
  /** The scene, built on the solver's near-field state texture (the particles sample it). */
  readonly scene: (flowTexture: GPUTexture, isRun: () => boolean) => ProductionScene;
  readonly errors: () => readonly GpuErrorReport[];
}): Promise<ConfigResult> {
  const { device, config } = o;
  const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
  const entry = manifest.specs['130k'];
  if (entry === undefined) throw new Error('the mesh manifest has no 130k entry');
  const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
  const { asset, file } = await loadMeshAsset(bytes, entry);
  const mesh = solverMeshFromFile(file);
  const frameAt = new Map<number, number>();
  const resampleMs: number[] = [];
  let rec: RunRecorder | null = null;
  const flow = new GpuFlowSolver({
    onFrameTiming: (ft) => {
      const t = frameAt.get(ft.frame);
      frameAt.delete(ft.frame);
      if (rec === null || t === undefined) return;
      if (ft.iterations > 0 && Number.isFinite(ft.solverMs) && ft.solverMs > 0) {
        rec.gpu({ frameT: t, solverMs: ft.solverMs, iterations: ft.iterations });
      }
      if (Number.isFinite(ft.resampleMs) && rec.phase === 'run') resampleMs.push(ft.resampleMs);
    },
  });
  await flow.init({ device, mesh: asset, definition: ENGINE_DEFINITION });
  const kernel = flow.kernel;
  if (kernel === null) throw new Error('no kernel');
  const start = perfState(mesh, kernel.ref);
  kernel.setConserved(start);
  const scene = o.scene(flow.fields().near.state, () => rec?.phase === 'run');
  const errorsBefore = o.errors().length;
  let sinceReset = 0;
  const recorder = await new Promise<RunRecorder>((resolve) => {
    let last: number | null = null;
    const frame = (t: number) => {
      const callbackAt = performance.now();
      rec ??= new RunRecorder(config.protocol, t, config.displayIntervalMs);
      const r = rec;
      const budget =
        config.budgetMs ??
        solverBudgetMs({ renderMs: scene.renderMs(), flowVisualsMs: scene.flowVisualsMs() });
      const k = flow.step({ gpuTimeBudgetMs: budget, maxIterations: 1000 }).iterationsThisStep;
      frameAt.set(flow.fields().version, t);
      sinceReset += k;
      if (sinceReset >= RESET_ITERATIONS) {
        kernel.setConserved(start);
        sinceReset = 0;
      }
      scene.render(last === null ? 1 / 60 : Math.min(0.1, (t - last) / 1000));
      last = t;
      if (r.frame(t, k, callbackAt) === 'done') {
        resolve(r);
        return;
      }
      o.raf(frame);
    };
    o.raf(frame);
  });

  await device.queue.onSubmittedWorkDone();
  await new Promise((r) => setTimeout(r, 200));
  const P = await kernel.readPrimitives();
  let stateFinite = true;
  let maxAbsPp = 0;
  for (let c = 0; c < kernel.layout.nCells; c++) {
    for (let m = 0; m < 6; m++) if (!Number.isFinite(P[8 * c + m] ?? NaN)) stateFinite = false;
    maxAbsPp = Math.max(maxAbsPp, Math.abs(P[8 * c + 4] ?? NaN));
  }
  const runs = recorder.results();
  const result: ConfigResult = {
    id: config.id,
    solver: 'production',
    cells: kernel.layout.nCells,
    grid: config.grid,
    blocks: config.blocks,
    tile: kernel.layout.tile,
    workgroups: kernel.layout.workgroups,
    iterations: config.iterations,
    protocol: config.protocol,
    runs,
    aggregate: aggregateRuns(runs),
    resampleMsP50: resampleMs.length > 0 ? median(resampleMs) : null,
    renderGpuMsP50: scene.runRenderMs.length > 0 ? median(scene.runRenderMs) : null,
    threeComputeGpuMsP50: scene.runComputeMs.length > 0 ? median(scene.runComputeMs) : null,
    sceneTriangles: scene.triangles,
    drawingBuffer: o.size,
    timestampQuantumNs: null,
    stateFinite,
    maxAbsGaugePressurePa: maxAbsPp,
    gpuErrors: o.errors().slice(errorsBefore),
    measured: { timeOrigin: performance.timeOrigin, ...recorder.window },
  };
  scene.dispose();
  flow.dispose();
  return result;
}
