// P1's measurement of record (D4-64): the app's GpuFlowSolver on the shipped 130k asset inside the
// app's own 1080p engine scene, src/render/engineView.ts at 1920 x 1080 and DPR 1 with its
// defaults (the 'high' geometry, the 'quality' profile, the three-quarter front preset: P4's
// view), on the view's device, at D4-2's budget (spikes/scene/productionRun.ts). The device asks
// for FLOW_SOLVER_LIMITS (D4-50), as the app must to host the solver. The view draws no flow
// visuals yet, so D4-2's flow-visual time is 0. No page wiring here (spikes/p1/main.ts does it),
// so tests/browser/p1Bench.test.ts can run it.

import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { FLOW_SOLVER_LIMITS, type GpuErrorReport } from '../../src/gpu/device';
import { PASS_GROUPS, type FrameSample } from '../../src/gpu/passTimings';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import { sceneOf } from '../lib/p1';
import type { BenchConfig, ConfigResult } from '../scene/benchApp';
import { runProductionSolver, type ProductionScene } from '../scene/productionRun';

export const APP_SCENE_SIZE = [1920, 1080] as const;
/** The view's rolling GPU median is read this often: stats() walks the scene to count draws. */
const TIMINGS_EVERY = 15;
/**
 * Frames rendered before the view is handed over. The first one compiles the scene's pipelines,
 * which took seconds here (without this, the smoke test's 3 s warm-up and 2 s run saw no frame
 * after it), and belongs to the page load, not to the warm-up.
 */
const PRIME_FRAMES = 10;

/**
 * The app's engine view at 1080p for P1, its GPU errors collected in `errors`, its pipelines
 * compiled (PRIME_FRAMES rendered and finished on the GPU).
 */
export async function createAppView(
  canvas: HTMLCanvasElement,
  errors: GpuErrorReport[],
): Promise<EngineView> {
  const view = await createEngineView({
    gpu: navigator.gpu,
    canvas,
    definition: ENGINE_DEFINITION,
    width: APP_SCENE_SIZE[0],
    height: APP_SCENE_SIZE[1],
    dpr: 1,
    preferredLimits: FLOW_SOLVER_LIMITS,
    onError: (r) => {
      errors.push(r);
      // the harness records console errors too
      console.error(`[gpu ${r.kind}] ${r.message}`);
    },
  });
  try {
    for (let k = 0; k < PRIME_FRAMES; k++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      view.frame(1 / 60);
    }
    await view.device.device.queue.onSubmittedWorkDone();
  } catch (e) {
    await view.dispose();
    throw e;
  }
  return view;
}

const frameTotal = (f: FrameSample) => PASS_GROUPS.reduce((t, g) => t + f.gpu[g], 0);

/**
 * The engine view as productionRun's scene: view.frame renders it, D4-2's measured render is the
 * view's rolling median GPU total (its own pass timestamps: engine plus post), and the run's render
 * times are the view's timing run (every frame of the measured window).
 */
function appScene(v: EngineView, isRun: () => boolean): ProductionScene {
  let lastRender: number | null = null;
  let frames = 0;
  let recording = false;
  let run: number[] | null = null;
  return {
    render: (dtS) => {
      if (!recording && isRun()) {
        v.beginTimingRun();
        recording = true;
      }
      v.frame(dtS);
      if (frames++ % TIMINGS_EVERY === 0) {
        const m = v.stats().timings;
        lastRender = m.frames > 0 && Number.isFinite(m.gpuTotal) ? m.gpuTotal : null;
      }
    },
    renderMs: () => lastRender,
    flowVisualsMs: () => null,
    triangles: v.stats().triangles,
    // read once, after the run (productionRun waits for the queue and the last read-backs)
    get runRenderMs() {
      run ??= recording ? v.endTimingRun().map(frameTotal) : [];
      return run;
    },
    runComputeMs: [],
    dispose: () => {
      // the caller owns the view
    },
  };
}

/** One P1 run in the app's engine scene (the production solver only: it throws on anything else). */
export function runInAppScene(o: {
  readonly view: EngineView;
  readonly config: BenchConfig;
  readonly errors: readonly GpuErrorReport[];
  readonly raf: (cb: (t: number) => void) => void;
}): Promise<ConfigResult> {
  const { view, config } = o;
  if (sceneOf(config.scene) !== 'app' || config.solver !== 'production') {
    throw new Error(`${config.id}: the app scene runs the production solver in scene 'app' only`);
  }
  return runProductionSolver({
    device: view.device.device,
    config,
    raf: o.raf,
    size: APP_SCENE_SIZE,
    scene: (_flowTexture, isRun) => appScene(view, isRun),
    errors: () => o.errors,
    sceneName: 'app',
  });
}
