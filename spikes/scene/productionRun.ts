// One P1 run of the app's GpuFlowSolver (D4-54) on the shipped 130k asset inside a 1080p scene:
// the app's own engine scene (spikes/p1/main.ts, the measurement of record, D4-64) or the W0 bench
// scene (benchApp.ts). Each frame is one step() at D4-2's budget (solverBudgetMs from the scene's
// latest measured render and flow-visual GPU times), which runs the solver's own scheduler and the
// resample, then the scene renders. The frame's solver and resample GPU times come back through
// onFrameTiming, by field version, into the D0-1 run recorder (spikes/lib/benchRun.ts). The
// result carries what spikes/lib/p1.ts solverValidity gates (W2I-I2 a).
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { solverBudgetMs } from '../../src/flow/gpu/scheduler';
import { loadMeshAsset, parseMeshManifest } from '../../src/flow/mesh/loader';
import { solverMeshFromFile } from '../../src/flow/reference/solverMesh';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import type { GpuErrorReport } from '../../src/gpu/device';
import { perfState } from '../../tools/perf/solverPerf';
import { RunRecorder, aggregateRuns } from '../lib/benchRun';
import type { P1Scene } from '../lib/p1';
import { median } from '../lib/stats';
import type { BenchConfig, ConfigResult } from './benchApp';

/**
 * The state is set back to its start every this many iterations (about every 25 frames), so every
 * frame times the same kind of field. The timing state (tools/perf/solverPerf.ts perfState: a jet,
 * swirl, a pressure wave and a hot fuel-air plume; not a solution) stays finite with D4-44 (the
 * soak: 1000 iterations), but the scheme grows a disturbance at rest on the engine mesh (D4-63:
 * max |p'| about 20x its first near 270 iterations, a 0.1 % wave 13.6x by 2000) and a P1 run
 * takes about 14000 iterations, which nobody has soaked. The upload sits between frames, outside
 * the solver's timestamped pass. A divergence between resets still invalidates the run: every
 * frame's latest resolved density residual is checked (nonFiniteResiduals, W2I-I2 a and d).
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
  /** The scene's name in the result (spikes/lib/p1.ts P1Scene). */
  readonly sceneName: P1Scene;
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
      // untimed frames never resolve: drop every frame up to this one (W2I-N6); the versions
      // ascend in insertion order
      for (const v of frameAt.keys()) {
        if (v > ft.frame) break;
        frameAt.delete(v);
      }
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
  let nonFiniteResiduals = 0;
  const recorder = await new Promise<RunRecorder>((resolve) => {
    let last: number | null = null;
    const frame = (t: number) => {
      const callbackAt = performance.now();
      rec ??= new RunRecorder(config.protocol, t, config.displayIntervalMs);
      const r = rec;
      const budget =
        config.budgetMs ??
        solverBudgetMs({ renderMs: scene.renderMs(), flowVisualsMs: scene.flowVisualsMs() });
      const step = flow.step({ gpuTimeBudgetMs: budget, maxIterations: 1000 });
      const k = step.iterationsThisStep;
      // the latest resolved residual (a few frames late): a divergence between resets shows here
      const res = step.residualDensityL2;
      if (res !== null && !Number.isFinite(res)) nonFiniteResiduals++;
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
  const status = flow.status();
  const result: ConfigResult = {
    id: config.id,
    solver: 'production',
    scene: o.sceneName,
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
    nonFiniteResiduals,
    solverStatus: { status: status.status, error: status.error },
    measured: { timeOrigin: performance.timeOrigin, ...recorder.window },
  };
  scene.dispose();
  flow.dispose();
  return result;
}
