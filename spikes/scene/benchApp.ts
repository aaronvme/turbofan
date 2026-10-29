// The benchmark app shared by spike (a) (throughput, main thread), spike (d) (main thread
// vs worker) and the official P1 run's W0 bench-scene rows (`npm run bench:p1`, D4-54; its row of
// record runs in the app's engine scene, spikes/p1/main.ts, D4-64). Per frame, in queue order:
//   1. raw compute pass: k solver iterations, timestamped;
//   2. raw compute pass: resample the state into the rgba16float flow texture, timestamped;
//   3. three: TSL particle compute (samples the flow texture), then the scene + bloom.
// The spike kernel (solver 'spike'): k is fixed or sized by the spike's IterationScheduler to the
// plan's 7 ms budget. The production solver (solver 'production'): the app's GpuFlowSolver on the
// shipped 130k asset, whose step() encodes 1 and 2 itself with its D4-2 scheduler, at the budget
// solverBudgetMs gives from three's measured render and compute times (5 ms in this scene).
// No DOM APIs: the canvas may be an OffscreenCanvas in a worker.

import type { WebGPURenderer } from 'three/webgpu';
import {
  FLOW_SOLVER_LIMITS,
  GpuErrorLog,
  requestSimDevice,
  type GpuErrorReport,
  type SimDevice,
} from '../../src/gpu/device';
import { runProductionSolver } from './productionRun';
import { detectQuantumNs } from '../../src/gpu/timestamps';
import { createRendererOnDevice } from '../../src/render/rendererOnDevice';
import { FlowResample } from '../gpu/resample';
import { StageSolver } from '../gpu/stageSolver';
import { TimestampRing } from '../gpu/timestampRing';
import {
  RunRecorder,
  aggregateRuns,
  type Aggregate,
  type ProtocolTimes,
  type RunResult,
} from '../lib/benchRun';
import { freestream } from '../lib/gas';
import { sceneOf, type P1Scene } from '../lib/p1';
import { consToPrim, gaugeContext, initialState } from '../lib/initial';
import { buildGhosts, cellMetrics, makeLayout, makeNodes, type Tile } from '../lib/mesh';
import { IterationScheduler } from '../lib/scheduler';
import { median } from '../lib/stats';
import { createBenchScene } from './benchScene';

export interface BenchConfig {
  readonly id: string;
  /** The spike kernel on a synthetic grid (default), or the app's GpuFlowSolver on the 130k asset. */
  readonly solver?: 'spike' | 'production';
  /** The spike's synthetic grid and its blocks (unused by the production solver). */
  readonly grid: { readonly ni: number; readonly nj: number };
  readonly blocks: { readonly bi: number; readonly bj: number };
  /** The spike's tile; the production solver runs its default tile (reported in the result). */
  readonly tile: Tile;
  /** The production solver's budget per frame, ms, in place of D4-2's solverBudgetMs (a probe). */
  readonly budgetMs?: number;
  /**
   * The scene: the W0 bench scene (default, BenchApp) or the app's engine scene, which only the
   * P1 page runs (spikes/p1/main.ts). BenchApp throws on 'app' and on anything else (W2I-I2 b).
   */
  readonly scene?: P1Scene;
  /** 'adaptive' = IterationScheduler at the 7 ms budget; a number = fixed per frame. */
  readonly iterations: 'adaptive' | number;
  readonly protocol: ProtocolTimes;
  readonly particles: number;
  /**
   * The display refresh interval from the harness's idle rAF probe; long and throttled frames
   * are counted against it (W0G-I1). Without it the warm-up's median frame time is used.
   */
  readonly displayIntervalMs?: number;
}

export interface AdapterReport {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly limits: Record<string, number>;
}

export interface ConfigResult {
  readonly id: string;
  readonly solver: 'spike' | 'production';
  /** The scene the run was measured in. */
  readonly scene: P1Scene;
  readonly cells: number;
  readonly grid: BenchConfig['grid'];
  readonly blocks: BenchConfig['blocks'];
  readonly tile: Tile;
  readonly workgroups: number;
  readonly iterations: BenchConfig['iterations'];
  readonly protocol: ProtocolTimes;
  readonly runs: readonly RunResult[];
  readonly aggregate: Aggregate;
  readonly resampleMsP50: number | null;
  /** three's render passes (scene + bloom), from its own timestamp queries (trackTimestamp). */
  readonly renderGpuMsP50: number | null;
  /** three's compute (the particle pass). */
  readonly threeComputeGpuMsP50: number | null;
  readonly sceneTriangles: number;
  readonly drawingBuffer: readonly [number, number];
  readonly timestampQuantumNs: string | null;
  readonly stateFinite: boolean;
  readonly maxAbsGaugePressurePa: number;
  readonly gpuErrors: readonly GpuErrorReport[];
  /** Production runs: the frames whose density residual read back non-finite (W2I-I2 a). */
  readonly nonFiniteResiduals?: number;
  /** Production runs: GpuFlowSolver.status() at the end. */
  readonly solverStatus?: { readonly status: string; readonly error: string | null };
  /**
   * The measured runs on the rendering thread's frame clock, with that thread's
   * performance.timeOrigin, so the page can match main-thread long tasks to the runs in both
   * modes (a worker has its own time origin).
   */
  readonly measured: { readonly timeOrigin: number; readonly from: number; readonly to: number };
}

/** The adapter as the bench records it (D0-1 conditions). */
export function adapterReport(sim: SimDevice): AdapterReport {
  const limits: Record<string, number> = {};
  for (const key in sim.adapter.limits) {
    const v = (sim.adapter.limits as unknown as Record<string, unknown>)[key];
    if (typeof v === 'number') limits[key] = v;
  }
  return { ...sim.info, features: [...sim.features].sort(), limits };
}

/**
 * A rejected three timestamp resolve (W2I-N7) goes to the run's GPU errors, which make the run
 * INVALID (spikes/lib/p1.ts solverValidity): its render timings are incomplete.
 */
export function timestampFailure(log: GpuErrorLog, what: string): (e: unknown) => void {
  return (e) => {
    log.sink({
      kind: 'unknown',
      message: `${what}: ${e instanceof Error ? e.message : String(e)}`,
    });
  };
}

const DOMAIN = { x0: -1, x1: 3, r1: 1.5 };
const T_INF = 288.15;
const P_INF = 101325;
const U_INF = 102; // M 0.3

export class BenchApp {
  readonly renderer: WebGPURenderer;
  readonly device: GPUDevice;
  readonly adapter: AdapterReport;
  private readonly log: GpuErrorLog;
  private readonly destroyDevice: () => void;
  private readonly size: readonly [number, number];

  private constructor(
    renderer: WebGPURenderer,
    device: GPUDevice,
    adapter: AdapterReport,
    log: GpuErrorLog,
    destroyDevice: () => void,
    size: readonly [number, number],
  ) {
    this.renderer = renderer;
    this.device = device;
    this.adapter = adapter;
    this.log = log;
    this.destroyDevice = destroyDevice;
    this.size = size;
  }

  static async create(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    width: number,
    height: number,
  ): Promise<BenchApp> {
    const log = new GpuErrorLog();
    const sim = await requestSimDevice(navigator.gpu, {
      powerPreference: 'high-performance',
      optionalFeatures: 'all',
      requiredFeatures: ['timestamp-query'],
      maxLimits: ['maxComputeWorkgroupStorageSize', 'maxStorageBufferBindingSize', 'maxBufferSize'],
      // the app's device request for the flow solver (D4-50)
      preferredLimits: FLOW_SOLVER_LIMITS,
      onError: log.sink,
    });
    const renderer = await createRendererOnDevice({
      device: sim.device,
      canvas,
      trackTimestamp: true,
    });
    // Exactly width x height device pixels whatever the window size and DPR (no style
    // updates, which an OffscreenCanvas could not take anyway).
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    const adapter = adapterReport(sim);
    return new BenchApp(
      renderer,
      sim.device,
      adapter,
      log,
      () => {
        sim.destroy();
      },
      [width, height],
    );
  }

  async run(config: BenchConfig, raf: (cb: (t: number) => void) => void): Promise<ConfigResult> {
    if (sceneOf(config.scene) === 'app') {
      throw new Error(
        `${config.id}: BenchApp runs the W0 bench scene only; scene 'app' runs on the P1 page (spikes/p1/main.ts)`,
      );
    }
    if (config.solver === 'production') return this.runProduction(config, raf);
    const { device } = this;
    const { ni, nj } = config.grid;
    const nodes = makeNodes({ ni, nj, ...DOMAIN, wiggle: 0.25 });
    const layout = makeLayout(ni, nj, config.blocks.bi, config.blocks.bj);
    const ghosts = buildGhosts(nodes, layout, {
      wallTop: [Math.floor(ni / 4), Math.floor(ni / 2)],
    });
    const inf = freestream(T_INF, P_INF, U_INF);
    const ctx = gaugeContext(inf, P_INF, T_INF);
    const initial = initialState(nodes, layout, ctx, (x, r) => {
      const bump = Math.exp(-((x - 0.5) ** 2 + (r - 0.6) ** 2) / 0.05);
      return {
        rho: inf.rho * (1 + 0.1 * bump),
        u: U_INF,
        v: 5 * bump,
        rw: 20 * r * bump,
        pp: 8000 * bump,
        z: 0.02 * bump,
      };
    });
    const solver = await StageSolver.create({
      device,
      nodes,
      layout,
      ghosts,
      tile: config.tile,
      inf,
      ctx,
      cfl: 1.5,
      initial,
      label: config.id,
    });
    const resample = new FlowResample(device, nodes, layout, inf);
    const scene = createBenchScene(this.renderer, {
      flowA: resample.textureA,
      domain: DOMAIN,
      particles: config.particles,
      coreRows: 6,
      bladesPerRow: 50,
    });
    const ring = new TimestampRing(device, { slots: 8, pairs: 2 });
    const scheduler =
      config.iterations === 'adaptive'
        ? new IterationScheduler({ budgetMs: 7, min: 1, max: 24, initial: 2 })
        : null;
    const resampleMs: number[] = [];
    const renderMs: number[] = [];
    const threeComputeMs: number[] = [];
    const keep = (into: number[]) => (ms: number | undefined) => {
      if (typeof ms === 'number' && ms > 0 && Number.isFinite(ms)) into.push(ms);
    };
    const errorsBefore = this.log.reports.length;

    const recorder = await new Promise<RunRecorder>((resolve) => {
      let rec: RunRecorder | null = null;
      let last: number | null = null;
      const frame = (t: number) => {
        const callbackAt = performance.now();
        rec ??= new RunRecorder(config.protocol, t, config.displayIntervalMs);
        const k = scheduler ? scheduler.iterations : (config.iterations as number);
        const slot = ring.acquire();
        const encoder = device.createCommandEncoder();
        const sp = encoder.beginComputePass(slot ? { timestampWrites: slot.writes(0) } : {});
        solver.encode(sp, k);
        sp.end();
        const rp = encoder.beginComputePass(slot ? { timestampWrites: slot.writes(1) } : {});
        resample.encode(rp, solver.current());
        rp.end();
        slot?.resolve(encoder);
        device.queue.submit([encoder.finish()]);
        if (slot) {
          const r = rec;
          void slot.read().then(([solverMs, resMs]) => {
            if (solverMs !== undefined && Number.isFinite(solverMs)) {
              r.gpu({ frameT: t, solverMs, iterations: k });
              scheduler?.observe(k, solverMs);
            }
            if (resMs !== undefined && Number.isFinite(resMs) && r.phase === 'run') {
              resampleMs.push(resMs);
            }
          });
        }
        scene.frame(last === null ? 1 / 60 : Math.min(0.1, (t - last) / 1000));
        last = t;
        if (rec.phase === 'run') {
          void this.renderer
            .resolveTimestampsAsync('render')
            .then(keep(renderMs))
            .catch(timestampFailure(this.log, 'three render timestamps'));
          void this.renderer
            .resolveTimestampsAsync('compute')
            .then(keep(threeComputeMs))
            .catch(timestampFailure(this.log, 'three compute timestamps'));
        }
        if (rec.frame(t, k, callbackAt) === 'done') {
          resolve(rec);
          return;
        }
        raf(frame);
      };
      raf(frame);
    });

    // Let the last timestamp read-backs land, then check the state survived the run.
    await device.queue.onSubmittedWorkDone();
    await new Promise((r) => setTimeout(r, 200));
    const state = await solver.readState();
    const stateFinite = state.a.every(Number.isFinite) && state.b.every(Number.isFinite);
    let maxAbsPp = 0;
    if (stateFinite) {
      // Sample every 97th cell: enough to see blow-up without converting 256k cells.
      for (let c = 0; c < layout.nCells; c += 97) {
        const blk = layout.blocks.find((b) => c >= b.cellOffset && c < b.cellOffset + b.ni * b.nj);
        if (!blk) continue;
        const local = c - blk.cellOffset;
        const I = blk.i0 + (local % blk.ni);
        const J = blk.j0 + Math.floor(local / blk.ni);
        const q = consToPrim(
          state.a.subarray(4 * c, 4 * c + 4),
          state.b.subarray(4 * c, 4 * c + 4),
          cellMetrics(nodes, I, J).rc,
          ctx,
        );
        maxAbsPp = Math.max(maxAbsPp, Math.abs(q.pp));
      }
    }
    const runs = recorder.results();
    const quantum = detectQuantumNs(ring.rawTimestamps());
    const result: ConfigResult = {
      id: config.id,
      solver: 'spike',
      scene: 'bench',
      cells: layout.nCells,
      grid: config.grid,
      blocks: config.blocks,
      tile: config.tile,
      workgroups: solver.workgroups,
      iterations: config.iterations,
      protocol: config.protocol,
      runs,
      aggregate: aggregateRuns(runs),
      resampleMsP50: resampleMs.length > 0 ? median(resampleMs) : null,
      renderGpuMsP50: renderMs.length > 0 ? median(renderMs) : null,
      threeComputeGpuMsP50: threeComputeMs.length > 0 ? median(threeComputeMs) : null,
      sceneTriangles: scene.triangles,
      drawingBuffer: this.size,
      timestampQuantumNs: quantum === null ? null : quantum.toString(),
      stateFinite,
      maxAbsGaugePressurePa: maxAbsPp,
      gpuErrors: this.log.reports.slice(errorsBefore),
      measured: { timeOrigin: performance.timeOrigin, ...recorder.window },
    };
    scene.dispose();
    ring.destroy();
    resample.destroy();
    solver.destroy();
    return result;
  }

  /** P1 (D4-54): the app's GpuFlowSolver on the shipped 130k asset inside this scene. */
  private runProduction(
    config: BenchConfig,
    raf: (cb: (t: number) => void) => void,
  ): Promise<ConfigResult> {
    const renderer = this.renderer;
    const log = this.log;
    return runProductionSolver({
      device: this.device,
      config,
      raf,
      size: this.size,
      errors: () => log.reports,
      sceneName: 'bench',
      scene: (flowTexture, isRun) => {
        const scene = createBenchScene(renderer, {
          flowA: flowTexture,
          domain: DOMAIN,
          particles: config.particles,
          coreRows: 6,
          bladesPerRow: 50,
        });
        let lastRender: number | null = null;
        let lastCompute: number | null = null;
        const runRenderMs: number[] = [];
        const runComputeMs: number[] = [];
        const keep = (into: number[], set: (ms: number) => void) => (ms: unknown) => {
          if (typeof ms === 'number' && ms > 0 && Number.isFinite(ms)) {
            set(ms);
            if (isRun()) into.push(ms);
          }
        };
        return {
          render: (dtS) => {
            scene.frame(dtS);
            void renderer
              .resolveTimestampsAsync('render')
              .then(
                keep(runRenderMs, (ms) => {
                  lastRender = ms;
                }),
              )
              .catch(timestampFailure(log, 'three render timestamps'));
            void renderer
              .resolveTimestampsAsync('compute')
              .then(
                keep(runComputeMs, (ms) => {
                  lastCompute = ms;
                }),
              )
              .catch(timestampFailure(log, 'three compute timestamps'));
          },
          renderMs: () => lastRender,
          flowVisualsMs: () => lastCompute,
          triangles: scene.triangles,
          runRenderMs,
          runComputeMs,
          dispose: () => {
            scene.dispose();
          },
        };
      },
    });
  }

  async dispose(): Promise<void> {
    await this.renderer.dispose();
    this.destroyDevice();
  }
}
