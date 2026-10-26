// Main-thread look-dev entry (D2-4 allows it for look-dev; the same EngineView runs in the
// worker, src/render/worker.ts). Query: ?preset=<id>&clean=1&shutter=<deg>&quality=test.
// Keys: 1-8 presets, c cutaway, e exploded, r realistic, t/g throttle up/down, p the GPU
// pass overlay. window.lookdev drives it from Playwright (tools/lookdev/capture.ts).

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ENGINE_DEFINITION } from '../engine/definition';
import { PASS_GROUPS, type PassMedians } from '../gpu/passTimings';
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
  /** Renders n frames at a fixed 1/60 s step, one per animation frame, then waits for the GPU. */
  renderFrames(n: number): Promise<void>;
  /** Renders n frames and returns the per-pass GPU and CPU medians over them. */
  timeFrames(n: number): Promise<PassMedians>;
  pause(paused: boolean): void;
  stats(): ReturnType<EngineView['stats']>;
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const passes = document.getElementById('passes') as HTMLDivElement;
if (params.get('clean') === '1') document.body.classList.add('clean');

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
        hud.textContent = `${s.cycleLabel} cycle · N1 ${s.n1Rpm.toFixed(0)} rpm · N2 ${s.n2Rpm.toFixed(0)} rpm · blur ${s.lpBlurDeg.toFixed(1)}° · ${(s.drawnTriangles / 1e6).toFixed(2)} of ${(s.triangles / 1e6).toFixed(2)} M tris · GPU errors ${s.errors.length}`;
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
    async renderFrames(n) {
      paused = true;
      for (let i = 0; i < n; i++) {
        view.frame(1 / 60);
        await nextFrame();
      }
      await view.device.device.queue.onSubmittedWorkDone();
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
