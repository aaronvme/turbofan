// Main-thread look-dev entry (D2-4 allows it for look-dev; the same EngineView runs in the
// worker, src/render/worker.ts). Query: ?preset=<id>&clean=1&shutter=<deg>&quality=test
// &profile=performance. Keys: 1-8 presets, c cutaway, e exploded, r realistic, t/g throttle
// up/down, p the GPU pass overlay, q the render profile (quality / performance, D3-7). window.lookdev drives it from Playwright (tools/lookdev/capture.ts).

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ENGINE_DEFINITION } from '../engine/definition';
import { PASS_GROUPS, type FrameSample, type PassMedians } from '../gpu/passTimings';
import type { RenderProfileId } from '../gpu/renderScale';
import { createEngineView, type DebugFlags, type EngineView } from '../render/engineView';
import type { PostDebug } from '../render/post';
import { LOOK_PRESET_IDS, LOOK_PRESETS, type LookMode, type LookPresetId } from '../render/presets';

declare global {
  interface Window {
    lookdev?: LookdevApi;
  }
}

interface LookdevApi {
  readonly ready: boolean;
  setPreset(id: LookPresetId): void;
  setMode(mode: LookMode, immediate?: boolean): void;
  setThrottle(lever: number, settle?: boolean): void;
  setShutter(deg: number): void;
  setDebugFlags(flags: DebugFlags): void;
  setProfile(id: RenderProfileId): void;
  /** Renders n frames at a fixed 1/60 s step, one per animation frame, then waits for the GPU. */
  renderFrames(n: number): Promise<void>;
  /** Renders n frames and returns the per-pass GPU and CPU medians over them. */
  timeFrames(n: number): Promise<PassMedians>;
  /**
   * Renders for `ms` (a warm-up), one frame per animation frame, or back to back with
   * `saturate` (D4-24: the warm-up of a back-to-back run loads the GPU the same way).
   */
  renderFor(ms: number, saturate?: boolean): Promise<void>;
  /**
   * One timing run of `ms` (W1L-I4): every frame's passes, the rAF intervals, hidden time.
   * `saturate` renders back to back (BACK_TO_BACK_AHEAD frames queued) instead of one per animation
   * frame, so the GPU never idles and its clock cannot drop with the load (LOD round, D4-5).
   */
  timeRun(ms: number, saturate?: boolean): Promise<TimingRun>;
  /** What the page can tell about the conditions (D0-1): battery, adapter, user agent. */
  conditions(): Promise<Record<string, unknown>>;
  pause(paused: boolean): void;
  stats(): ReturnType<EngineView['stats']>;
}

export interface TimingRun {
  readonly frames: FrameSample[];
  readonly rafDeltas: number[];
  readonly hiddenMs: number;
  readonly events: string[];
  /** Back to back: rAF deltas seen by a watcher during the run (occlusion). */
  readonly vsyncDeltas: number[];
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const passes = document.getElementById('passes') as HTMLDivElement;
if (params.get('clean') === '1') document.body.classList.add('clean');

/**
 * Frames kept submitted ahead of the one the CPU waits on in back-to-back pacing (D4-24). With
 * one or two the timed passes fill about the same share of the wall time (72-77 %, w2/lookdev-4,
 * indicative): the rest is not a queue that ran dry (GPU_FACTS M46: probably GPU work the
 * pass timestamps miss, or the canvas). Two, so the CPU
 * never makes the GPU wait.
 */
const BACK_TO_BACK_AHEAD = 2;
const backToBack = (queue: GPUQueue) => {
  const inFlight: Promise<undefined>[] = [];
  return async (): Promise<void> => {
    inFlight.push(queue.onSubmittedWorkDone());
    if (inFlight.length > BACK_TO_BACK_AHEAD) await inFlight.shift();
  };
};

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

const PASS_LABEL: Record<(typeof PASS_GROUPS)[number], string> = {
  shadow: 'Shadow map',
  opaque: 'Opaque + caps',
  rotors: 'Rotors',
  gtao: 'GTAO (half)',
  composite: 'Fan blur + AO',
  traa: 'TRAA',
  dof: 'Depth of field',
  bloom: 'Bloom',
  output: 'Tone map + out',
  other: 'Other',
};

function renderPasses(m: PassMedians, timestamps: boolean): string {
  if (!timestamps) return '<div class="t">GPU timestamps unavailable</div>';
  if (m.frames === 0) return '<div class="t">measuring…</div>';
  const rows = PASS_GROUPS.filter((g) => m.gpu[g] > 0.0005 || g === 'opaque')
    .map((g) => `<div class="r"><span>${PASS_LABEL[g]}</span><b>${m.gpu[g].toFixed(2)}</b></div>`)
    .join('');
  return `<div class="t">GPU ms / frame <i>median of ${m.frames}</i></div>${rows}<div class="r sum"><span>GPU total</span><b>${m.gpuTotal.toFixed(2)}</b></div><div class="r"><span>CPU encode</span><b>${m.cpu.toFixed(2)}</b></div>`;
}

async function main(): Promise<void> {
  if (!('gpu' in navigator)) throw new Error('WebGPU is not available');
  const view = await createEngineView({
    gpu: navigator.gpu,
    canvas,
    definition: ENGINE_DEFINITION,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    quality: params.get('quality') === 'test' ? 'test' : 'high',
    profile: params.get('profile') === 'performance' ? 'performance' : 'quality',
    debug: (params.get('debug') as PostDebug) ?? null,
  });
  const controls = new OrbitControls(view.camera, canvas);
  controls.enableDamping = true;
  const applyPreset = (id: LookPresetId) => {
    view.setPreset(id);
    const t = LOOK_PRESETS[id].target;
    controls.target.set(t[0], t[1], t[2]);
    controls.update();
  };
  const preset = params.get('preset');
  applyPreset(
    LOOK_PRESET_IDS.includes(preset as LookPresetId)
      ? (preset as LookPresetId)
      : 'threeQuarterFront',
  );
  const shutter = Number(params.get('shutter'));
  if (shutter > 0) view.setShutter(shutter);
  new ResizeObserver(() => {
    view.setSize(innerWidth, innerHeight, devicePixelRatio);
  }).observe(canvas);

  let paused = false;
  let last = performance.now();
  let lever = 0;
  let acc = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      controls.update();
      view.frame(dt);
      acc += dt;
      if (acc > 0.5) {
        const s = view.stats();
        hud.textContent = `${s.cycleLabel} cycle · N1 ${s.n1Rpm.toFixed(0)} rpm · N2 ${s.n2Rpm.toFixed(0)} rpm · blur ${s.lpBlurDeg.toFixed(1)}° · ${(s.drawnTriangles / 1e6).toFixed(2)} of ${(s.triangles / 1e6).toFixed(2)} M tris · ${s.profile} ${s.renderScale.toFixed(2)}× · GPU errors ${s.errors.length}`;
        passes.innerHTML = renderPasses(s.timings, s.timestamps);
        acc = 0;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  addEventListener('keydown', (e) => {
    const n = Number(e.key);
    const id = LOOK_PRESET_IDS[n - 1];
    if (id !== undefined) applyPreset(id);
    if (e.key === 'c') view.setMode('cutaway');
    if (e.key === 'e') view.setMode('exploded');
    if (e.key === 'r') view.setMode('realistic');
    if (e.key === 't') view.setThrottle((lever = Math.min(1, lever + 0.25)));
    if (e.key === 'g') view.setThrottle((lever = Math.max(0, lever - 0.25)));
    if (e.key === 'p') document.body.classList.toggle('nopasses');
    if (e.key === 'q')
      view.setProfile(view.stats().profile === 'quality' ? 'performance' : 'quality');
  });

  window.lookdev = {
    ready: true,
    setPreset: applyPreset,
    setMode: (m, i) => {
      view.setMode(m, i);
    },
    setThrottle: (l, s) => {
      view.setThrottle(l, s);
    },
    setShutter: (d) => {
      view.setShutter(d);
    },
    setDebugFlags: (f) => {
      view.setDebugFlags(f);
    },
    setProfile: (id) => {
      view.setProfile(id);
    },
    async renderFrames(n) {
      paused = true;
      for (let i = 0; i < n; i++) {
        view.frame(1 / 60);
        await nextFrame();
      }
      await view.device.device.queue.onSubmittedWorkDone();
    },
    async renderFor(ms, saturate = false) {
      paused = true;
      const end = performance.now() + ms;
      const pace = backToBack(view.device.device.queue);
      while (performance.now() < end) {
        view.frame(1 / 60);
        if (saturate) await pace();
        else await nextFrame();
      }
      await view.device.device.queue.onSubmittedWorkDone();
    },
    async timeRun(ms, saturate = false) {
      paused = true;
      const events: string[] = [];
      let hiddenMs = 0;
      let hiddenSince = document.hidden ? performance.now() : -1;
      const onVis = () => {
        const t = performance.now();
        events.push(`${document.visibilityState} at ${t.toFixed(0)}`);
        if (document.hidden && hiddenSince < 0) hiddenSince = t;
        if (!document.hidden && hiddenSince >= 0) {
          hiddenMs += t - hiddenSince;
          hiddenSince = -1;
        }
      };
      const onBlur = () => events.push(`blur at ${performance.now().toFixed(0)}`);
      const onFocus = () => events.push(`focus at ${performance.now().toFixed(0)}`);
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('blur', onBlur);
      window.addEventListener('focus', onFocus);
      const rafDeltas: number[] = [];
      // back to back, the frame loop never waits for rAF, so an occluded window would not show
      // in its intervals: a watcher records rAF on the side (the run's occlusion check)
      const vsyncDeltas: number[] = [];
      let watching = saturate;
      if (saturate) {
        let lastV = performance.now();
        const tick = () => {
          if (!watching) return;
          const t = performance.now();
          vsyncDeltas.push(t - lastV);
          lastV = t;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
      view.beginTimingRun();
      let last = performance.now();
      const end = last + ms;
      const pace = backToBack(view.device.device.queue);
      while (last < end) {
        view.frame(1 / 60);
        if (saturate) await pace();
        else await nextFrame();
        const t = performance.now();
        rafDeltas.push(t - last);
        last = t;
      }
      // the last frames' timestamp read-backs land during the next few frames
      for (let i = 0; i < 4; i++) {
        view.frame(1 / 60);
        await nextFrame();
      }
      watching = false;
      const frames = view.endTimingRun();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      if (hiddenSince >= 0) hiddenMs += performance.now() - hiddenSince;
      return { frames, rafDeltas, hiddenMs, events, vsyncDeltas };
    },
    async conditions() {
      const nav = navigator as Navigator & {
        getBattery?: () => Promise<{ charging: boolean; level: number }>;
      };
      const battery = nav.getBattery ? await nav.getBattery() : null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      const info = adapter?.info;
      return {
        userAgent: navigator.userAgent,
        battery: battery ? { charging: battery.charging, level: battery.level } : 'unavailable',
        adapter: info
          ? {
              vendor: info.vendor,
              architecture: info.architecture,
              device: info.device,
              description: info.description,
            }
          : 'unavailable',
        timestamps: view.stats().timestamps,
      };
    },
    async timeFrames(n) {
      paused = true;
      for (let i = 0; i < n; i++) {
        view.frame(1 / 60);
        await nextFrame();
      }
      await view.device.device.queue.onSubmittedWorkDone();
      // let the last timestamp read-backs land
      for (let i = 0; i < 4; i++) await nextFrame();
      return view.stats().timings;
    },
    pause(p) {
      paused = p;
    },
    stats: () => view.stats(),
  };
}

main().catch((e: unknown) => {
  hud.textContent = `look-dev failed: ${String(e)}`;
  console.error(e);
});
