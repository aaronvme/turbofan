// Main-thread look-dev entry (D2-4 allows it for look-dev; the same EngineView runs in the
// worker, src/render/worker.ts). Query: ?preset=<id>&clean=1&shutter=<deg>&quality=test.
// Keys: 1-7 presets, c cutaway, e exploded, r realistic, t/g throttle up/down.
// window.lookdev drives it from Playwright (docs/look-dev screenshots).

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ENGINE_DEFINITION } from '../engine/definition';
import { createEngineView, type EngineView } from '../render/engineView';
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
  /** Renders n frames at a fixed 1/60 s step, then waits for the GPU. */
  renderFrames(n: number): Promise<void>;
  /** Mean wall-clock ms per frame over n frames, GPU-synchronised. */
  timeFrames(n: number): Promise<number>;
  pause(paused: boolean): void;
  stats(): ReturnType<EngineView['stats']>;
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
if (params.get('clean') === '1') document.body.classList.add('clean');

async function main(): Promise<void> {
  if (!('gpu' in navigator)) throw new Error('WebGPU is not available');
  const view = await createEngineView({
    gpu: navigator.gpu,
    canvas,
    definition: ENGINE_DEFINITION,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    hdriUrl: '/hdri/aircraft_workshop_01_1k.hdr',
    quality: params.get('quality') === 'test' ? 'test' : 'high',
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
  let frames = 0;
  let acc = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      controls.update();
      view.frame(dt);
      frames++;
      acc += dt;
      if (acc > 0.5) {
        const s = view.stats();
        hud.textContent = `${s.cycleLabel} cycle  N1 ${s.n1Rpm.toFixed(0)} rpm  N2 ${s.n2Rpm.toFixed(0)} rpm  blur ${s.lpBlurDeg.toFixed(0)} deg  ${((1000 * acc) / frames).toFixed(1)} ms/frame  ${(s.triangles / 1e6).toFixed(2)} M tris  GPU errors ${s.errors.length}`;
        frames = 0;
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
    async renderFrames(n) {
      for (let i = 0; i < n; i++) view.frame(1 / 60);
      await view.device.device.queue.onSubmittedWorkDone();
    },
    async timeFrames(n) {
      await view.device.device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        view.frame(1 / 60);
        await view.device.device.queue.onSubmittedWorkDone();
      }
      return (performance.now() - t0) / n;
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
