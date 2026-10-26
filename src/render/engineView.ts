// The engine look-dev view: device, renderer, procedural engine, post chain and the MOCK
// cycle driving the spools. Worker-safe (D2-4): no DOM, the canvas may be an OffscreenCanvas,
// size and DPR come in from the caller (setSize(w, h, false)), the HDRI comes through
// HDRLoader (fetch), and the caller owns the frame loop.

import {
  AgXToneMapping,
  DirectionalLight,
  EquirectangularReflectionMapping,
  PerspectiveCamera,
  Vector3,
  WebGPURenderer,
  type DataTexture,
} from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../contracts/cycle';
import type { EngineDefinition } from '../contracts/engine';
import { buildEngineGeometry, GEOMETRY_QUALITY } from '../geometry/engineGeometry';
import { cutawayWedge } from '../geometry/cutaway';
import { easeInOut, explodeOffsets } from '../geometry/explode';
import { advanceAngle, shutterBlurAngle } from '../geometry/motion';
import { createMockCycle, mockSteadyState, MOCK_LABEL } from '../mocks/mockCycle';
import { createEngineDevice, type EngineDevice, type GpuErrorReport } from './gpuDevice';
import { buildEngineScene, type EngineScene } from './engineScene';
import { createLookUniforms, createMaterials, type LookUniforms } from './materials';
import { createPipeline, type LookPipeline } from './post';
import { LOOK_PRESETS, type LookMode, type LookPresetId } from './presets';

export interface EngineViewOptions {
  readonly gpu: GPU;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly definition: EngineDefinition;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly hdriUrl: string;
  readonly quality?: keyof typeof GEOMETRY_QUALITY;
  readonly onError?: (r: GpuErrorReport) => void;
}

export interface EngineViewStats {
  readonly triangles: number;
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly lpBlurDeg: number;
  readonly errors: readonly GpuErrorReport[];
  readonly cycleLabel: typeof MOCK_LABEL;
}

export interface EngineView {
  readonly renderer: WebGPURenderer;
  readonly camera: PerspectiveCamera;
  readonly device: EngineDevice;
  readonly uniforms: LookUniforms;
  setSize(width: number, height: number, dpr: number): void;
  setPreset(id: LookPresetId): void;
  setMode(mode: LookMode, immediate?: boolean): void;
  /** Throttle lever 0..1; `settle` jumps to the MOCK steady state instead of spooling. */
  setThrottle(lever: number, settle?: boolean): void;
  setShutter(angleDeg: number): void;
  setCameraPose(position: readonly number[], target: readonly number[]): void;
  /** Advances the simulation clock by dt seconds and renders one frame. */
  frame(dtS: number): void;
  stats(): EngineViewStats;
  dispose(): void;
}

const FPS = 60;
const CUT_WIDTH = (100 * Math.PI) / 180;
const EXPLODE_GAP = 0.22;
const TRANSITION_S = 1.4;

export async function createEngineView(o: EngineViewOptions): Promise<EngineView> {
  const device = await createEngineDevice(o.gpu, o.onError);
  const renderer = new WebGPURenderer({
    device: device.device,
    canvas: o.canvas as HTMLCanvasElement,
    antialias: false,
  });
  await renderer.init();
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setPixelRatio(o.dpr);
  renderer.setSize(o.width, o.height, false);

  const def = o.definition;
  const geo = buildEngineGeometry(def, GEOMETRY_QUALITY[o.quality ?? 'high']);
  const uniforms = createLookUniforms();
  const scene: EngineScene = buildEngineScene(geo, createMaterials(uniforms));

  const hdri: DataTexture = await new HDRLoader().loadAsync(o.hdriUrl);
  hdri.mapping = EquirectangularReflectionMapping;
  for (const s of [scene.main, scene.rotors]) {
    s.environment = hdri;
    s.environmentIntensity = 0.9;
    s.environmentRotation.set(0, 2.2, 0);
  }
  scene.main.background = hdri;
  scene.main.backgroundBlurriness = 0.55;
  scene.main.backgroundIntensity = 0.22;
  scene.main.backgroundRotation.set(0, 2.2, 0);
  const key = new DirectionalLight(0xfff4e8, 1.6);
  key.position.set(-2, 4, 3);
  const keyR = key.clone();
  scene.main.add(key);
  scene.rotors.add(keyR);

  const camera = new PerspectiveCamera(30, o.width / o.height, 0.05, 200);
  const fanRow = def.bladeRows.find((r) => r.id === 'fan');
  if (fanRow === undefined) throw new Error('engineView: no fan row');
  const post: LookPipeline = createPipeline(
    renderer,
    scene.main,
    scene.rotors,
    camera,
    uniforms,
    {
      x: (fanRow.leadingEdge.hub.x + fanRow.trailingEdge.tip.x) / 2,
      rHub: fanRow.leadingEdge.hub.r,
      rTip: fanRow.leadingEdge.tip.r,
    },
    { blurSamples: 24, aoStrength: 0.85, bloomStrength: 0.12 },
  );

  const cycle = createMockCycle(def);
  cycle.reset('groundIdle');
  let lever = 0;
  let settled = mockSteadyState(def, 0);
  let settle = true;
  let lp = 0;
  let hp = 0;
  let shutterDeg = 180;
  let mode: LookMode = 'realistic';
  let cut = 0;
  let explode = 0;
  const target = new Vector3(0.5, 0, 0);

  const inputs = (): CycleInputs => ({
    ...DEFAULT_CYCLE_INPUTS,
    fuelLever: 'run',
    throttleLever: lever,
  });
  const speeds = () => (settle ? settled : cycle.state());

  const view: EngineView = {
    renderer,
    camera,
    device,
    uniforms,
    setSize(width, height, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    setPreset(id) {
      const p = LOOK_PRESETS[id];
      camera.fov = p.fovDeg;
      view.setCameraPose(p.camera, p.target);
      view.setMode(p.mode, true);
      view.setThrottle(p.throttle, true);
      post.focalLength.value = p.focalLength;
      post.bokehScale.value = p.bokehScale;
    },
    setMode(m, immediate = false) {
      mode = m;
      if (immediate) {
        cut = m === 'cutaway' ? 1 : 0;
        explode = m === 'exploded' ? 1 : 0;
      }
    },
    setThrottle(l, s = false) {
      lever = Math.max(0, Math.min(1, l));
      settle = s;
      if (s) settled = mockSteadyState(def, lever);
    },
    setShutter(a) {
      shutterDeg = a;
    },
    setCameraPose(position, t) {
      camera.position.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
      target.set(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateProjectionMatrix();
    },
    frame(dtS) {
      if (!settle) cycle.step(Math.min(dtS, 0.1), inputs());
      const st = speeds();
      lp = advanceAngle(lp, st.n1Rpm, def.rotation.lp, dtS);
      hp = advanceAngle(hp, st.n2Rpm, def.rotation.hp, dtS);
      for (const g of scene.spoolGroups.lp) g.rotation.x = lp;
      for (const g of scene.spoolGroups.hp) g.rotation.x = hp;
      uniforms.lpBlur.value = shutterBlurAngle(st.n1Rpm, shutterDeg, FPS);
      uniforms.hpBlur.value = shutterBlurAngle(st.n2Rpm, shutterDeg, FPS);

      const step = dtS / TRANSITION_S;
      cut = Math.max(0, Math.min(1, cut + (mode === 'cutaway' ? step : -step)));
      explode = Math.max(0, Math.min(1, explode + (mode === 'exploded' ? step : -step)));
      // the wedge opens toward the camera
      const center = Math.atan2(camera.position.z, camera.position.y);
      const wedge = cutawayWedge(easeInOut(cut), center, CUT_WIDTH);
      uniforms.cutCenter.value = wedge.center;
      uniforms.cutHalf.value = wedge.halfWidth;
      const showCaps = wedge.halfWidth > 1e-3;
      for (const [a, b] of scene.caps) {
        a.visible = b.visible = showCaps;
        a.rotation.x = wedge.center - wedge.halfWidth;
        b.rotation.x = wedge.center + wedge.halfWidth;
      }
      const offsets = explodeOffsets(def, explode, EXPLODE_GAP);
      for (const m of scene.modules) {
        const dx = m.id === null ? 0 : offsets[m.id];
        for (const g of m.groups) g.position.x = dx;
      }
      const skinsVisible = explode < 0.02;
      for (const s of scene.skins) if (!s.name.startsWith('cap:')) s.visible = skinsVisible;
      if (!skinsVisible)
        for (const s of scene.skins) if (s.name.startsWith('cap:')) s.visible = false;

      post.focusDistance.value = camera.position.distanceTo(target);
      post.render();
    },
    stats() {
      const st = speeds();
      return {
        triangles: scene.triangles,
        n1Rpm: st.n1Rpm,
        n2Rpm: st.n2Rpm,
        lpBlurDeg: (uniforms.lpBlur.value * 180) / Math.PI,
        errors: device.errors,
        cycleLabel: MOCK_LABEL,
      };
    },
    dispose() {
      post.dispose();
      scene.dispose();
      hdri.dispose();
      // three's dispose is asynchronous; the device goes only after it (three never destroys a
      // supplied device, GPU_FACTS M15)
      void Promise.resolve(renderer.dispose()).then(() => {
        device.destroy();
      });
    },
  };
  return view;
}
