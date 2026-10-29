// Per-pass GPU timestamps for the look-dev render (W1G-I2), worker-safe.
//
// three (trackTimestamp) writes a timestamp pair around every render pass and keys it by a
// render-context uid; it only reports their sum. An InspectorBase subclass sees every
// render's uid together with the scene (or post quad) it draws, whose name says which pass it
// is (src/gpu/passTimings.ts). After each frame we resolve three's queries without waiting on
// them, read the per-uid durations from its query pool, and fold them into rolling medians.
// The pool is three internals (`backend.timestampQueryPool.render.timestamps`, r186, pinned).
//
// Chrome without --enable-unsafe-webgpu quantizes timestamps to 65.5 us (GPU_FACTS M12), so
// a short pass reads as 0 or one quantum per frame; the medians over many frames are what to
// quote.

import { InspectorBase, type Object3D, type WebGPURenderer } from 'three/webgpu';
import {
  isFlowPass,
  passGroupOf,
  RollingPassStats,
  sumByGroup,
  sumFlowMs,
  type FrameSample,
  type PassMedians,
} from '../gpu/passTimings';

interface PoolInternals {
  readonly timestampQueryPool?: {
    readonly render?: { readonly timestamps: ReadonlyMap<string, number> };
  };
}

class LabelInspector extends InspectorBase {
  readonly labels = new Map<string, { label: string; frame: number }>();
  frame = 0;
  override beginRender(uid: string, scene: Object3D): void {
    this.labels.set(uid, { label: scene.name, frame: this.frame });
  }
  /** Advances three's node frame: post nodes render once per frame id (NodeUpdateType.FRAME). */
  advance(): void {
    this.nodeFrame.update();
  }
}

export interface PassTimer {
  /** Call before encoding a frame. */
  beginFrame(): void;
  /** Call after the frame is submitted, with the CPU ms it took. */
  endFrame(cpuMs: number): void;
  medians(): PassMedians;
  /** Records every frame from now on (a timing run, W1L-I4). */
  beginRun(): void;
  /** The frames since beginRun; stops recording. */
  endRun(): FrameSample[];
  readonly enabled: boolean;
}

export function createPassTimer(
  renderer: WebGPURenderer,
  enabled: boolean,
  window = 120,
): PassTimer {
  const inspector = new LabelInspector();
  renderer.inspector = inspector;
  const stats = new RollingPassStats(window);
  const cpuByFrame = new Map<number, number>();
  let frame = 0;
  let pending = false;
  const unclassified = new Set<string>();

  const collect = () => {
    const pool = (renderer.backend as unknown as PoolInternals).timestampQueryPool?.render;
    if (pool === undefined) return;
    const byFrame = new Map<number, { label: string; ms: number }[]>();
    for (const [uid, ms] of pool.timestamps) {
      const l = inspector.labels.get(uid);
      if (l === undefined) continue;
      inspector.labels.delete(uid);
      let list = byFrame.get(l.frame);
      if (list === undefined) byFrame.set(l.frame, (list = []));
      list.push({ label: l.label, ms });
      if (passGroupOf(l.label) === 'other' && !isFlowPass(l.label) && !unclassified.has(l.label)) {
        unclassified.add(l.label);
        console.warn(`pass timer: unclassified pass "${l.label}" (${ms.toFixed(3)} ms) DEBUG ${[...inspector.labels.values()].filter((x) => x.frame === l.frame).map((x) => x.label).join("|")}`);
      }
    }
    for (const [f, list] of [...byFrame].sort((a, b) => a[0] - b[0])) {
      // the flow visuals' passes are timed apart from the render (P4 excludes them, D4-2)
      const flow = list.some((e) => isFlowPass(e.label)) ? sumFlowMs(list) : undefined;
      stats.push(sumByGroup(list), cpuByFrame.get(f) ?? Number.NaN, flow);
      cpuByFrame.delete(f);
    }
    // labels of frames whose queries were dropped (pool overflow) must not pile up
    for (const [uid, l] of inspector.labels) if (l.frame < frame - 8) inspector.labels.delete(uid);
    for (const f of cpuByFrame.keys()) if (f < frame - 8) cpuByFrame.delete(f);
  };

  return {
    enabled,
    beginFrame: () => {
      frame++;
      inspector.frame = frame;
      inspector.advance();
      // three's timestamp query uids end in renderer.info.frame, which only its own rAF
      // loop advances: two frames in one animation frame shared uids (W1L-N7). Advancing it
      // here keeps them unique (it stays monotonic; three uses it for nothing else)
      (renderer.info as { frame: number }).frame++;
    },
    endFrame: (cpuMs) => {
      if (!enabled) {
        stats.push(sumByGroup([]), cpuMs);
        return;
      }
      cpuByFrame.set(frame, cpuMs);
      if (pending) return; // the queries of this frame join the next resolve
      pending = true;
      renderer
        .resolveTimestampsAsync('render')
        .then(collect)
        .catch((e: unknown) => {
          console.error('pass timer:', e);
        })
        .finally(() => {
          pending = false;
        });
    },
    medians: () => stats.medians(),
    beginRun: () => {
      stats.beginRun();
    },
    endRun: () => stats.endRun(),
  };
}
