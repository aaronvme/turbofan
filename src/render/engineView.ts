// The engine look-dev view: device, renderer, procedural engine, studio, post chain and the
// MOCK cycle driving the spools. Worker-safe (D2-4): no DOM, the canvas may be an
// OffscreenCanvas, size and DPR come in from the caller (setSize(w, h, false)), the studio is
// procedural (no asset fetch), and the caller owns the frame loop.
//
// The device is the shared one of src/gpu/device.ts (requestSimDevice: addEventListener error
// routing, intentional-destroy handling) and three adopts it through createRendererOnDevice
// (core mode checked). Every failure after the device exists destroys it (W1G-N3).

import {
  AgXToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../contracts/cycle';
import type { EngineDefinition } from '../contracts/engine';
import { buildEngineGeometry, GEOMETRY_QUALITY } from '../geometry/engineGeometry';
import { cutawayWedge } from '../geometry/cutaway';
import { easeInOut, explodeOffsets } from '../geometry/explode';
import { advanceAngle, shutterBlurAngle } from '../geometry/motion';
import { closedViewVisibility } from '../geometry/visibility';
import { requestSimDevice, type GpuErrorReport, type SimDevice } from '../gpu/device';
import type { PassMedians } from '../gpu/passTimings';
import { createMockCycle, mockSteadyState, MOCK_LABEL } from '../mocks/mockCycle';
import { buildEngineScene, type EngineScene } from './engineScene';
import { createLookUniforms, createMaterials, type LookUniforms } from './materials';
import { createPassTimer, type PassTimer } from './passTimer';
import { createPipeline, type LookPipeline, type PostDebug } from './post';
import { LOOK_PRESETS, SHUTTER_1000, type LookMode, type LookPresetId } from './presets';
import { createRendererOnDevice } from './rendererOnDevice';
import { createStudio, type Studio } from './studio';

export interface EngineViewOptions {
  readonly gpu: GPU;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly definition: EngineDefinition;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly quality?: keyof typeof GEOMETRY_QUALITY;
  readonly onError?: (r: GpuErrorReport) => void;
  readonly debug?: PostDebug;
  /** Per-pass GPU timestamps (default on when the adapter has timestamp-query). */
  readonly timing?: boolean;
}

export interface EngineViewStats {
  readonly triangles: number;
  /** Triangles in the scene graph that the current mode draws (culling applied). */
  readonly drawnTriangles: number;
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly lpBlurDeg: number;
  readonly errors: readonly GpuErrorReport[];
  readonly cycleLabel: typeof MOCK_LABEL;
  /** Rolling medians of GPU ms per pass and CPU ms per frame (W1G-I2). */
  readonly timings: PassMedians;
  readonly timestamps: boolean;
}

export interface EngineView {
  readonly renderer: WebGPURenderer;
  readonly camera: PerspectiveCamera;
  readonly device: SimDevice;
  readonly uniforms: LookUniforms;
  setSize(width: number, height: number, dpr: number): void;
  setPreset(id: LookPresetId): void;
  setMode(mode: LookMode, immediate?: boolean): void;
  /** Throttle lever 0..1; `settle` jumps to the MOCK steady state instead of spooling. */
  setThrottle(lever: number, settle?: boolean): void;
  setShutter(angleDeg: number): void;
  setCinematic(on: boolean): void;
  setCameraPose(position: readonly number[], target: readonly number[]): void;
  /** Look-dev A/B switches (e.g. caps or culling off) for timing comparisons. */
  setDebugFlags(flags: DebugFlags): void;
  /** Advances the simulation clock by dt seconds and renders one frame. */
  frame(dtS: number): void;
  stats(): EngineViewStats;
  dispose(): Promise<void>;
}

/** Look-dev A/B switches for timing comparisons (never set by the app). */
export interface DebugFlags {
  readonly noCull?: boolean;
  readonly noCaps?: boolean;
  /** Hide the cyclorama (background cost). */
  readonly noStage?: boolean;
  /** No shadow lookups at all. */
  readonly noShadow?: boolean;
  /** Skip the post chain: the scene pass straight to the screen. */
  readonly noPost?: boolean;
}

const FPS = 60;
const CUT_WIDTH = (100 * Math.PI) / 180;
const EXPLODE_GAP = 0.22;
const TRANSITION_S = 1.4;

export async function createEngineView(o: EngineViewOptions): Promise<EngineView> {
  const errors: GpuErrorReport[] = [];
  const sink = (r: GpuErrorReport) => {
    errors.push(r);
    if (o.onError) o.onError(r);
    else console.error(`[gpu ${r.kind}] ${r.message}`);
  };
  const device = await requestSimDevice(o.gpu, {
    label: 'turbofan-render',
    powerPreference: 'high-performance',
    optionalFeatures: ['float32-filterable', 'timestamp-query'],
    // the scene pass writes 3 rgba16float targets (colour, normal, velocity): 24 B/sample
    maxLimits: ['maxColorAttachmentBytesPerSample'],
    onError: sink,
  });
  let renderer: WebGPURenderer | null = null;
  try {
    const timing = (o.timing ?? true) && device.hasTimestamps;
    renderer = await createRendererOnDevice({
      device: device.device,
      canvas: o.canvas,
      trackTimestamp: timing,
    });
    return await assemble(o, device, renderer, errors, timing);
  } catch (e) {
    if (renderer !== null) await Promise.resolve(renderer.dispose()).catch(() => undefined);
    device.destroy();
    throw e;
  }
}

async function assemble(
  o: EngineViewOptions,
  device: SimDevice,
  renderer: WebGPURenderer,
  errors: GpuErrorReport[],
  timing: boolean,
): Promise<EngineView> {
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  // the rotor pass must start transparent: its alpha is the blade coverage
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(o.dpr);
  renderer.setSize(o.width, o.height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const timer: PassTimer = createPassTimer(renderer, timing);

  const def = o.definition;
  const geo = buildEngineGeometry(def, GEOMETRY_QUALITY[o.quality ?? 'high']);
  const uniforms = createLookUniforms();
  const scene: EngineScene = buildEngineScene(
    geo,
    createMaterials(uniforms),
    closedViewVisibility(def, geo),
  );
  const studio: Studio = await createStudio(renderer);
  for (const s of [scene.main, scene.rotors]) {
    s.environment = studio.environment;
    s.environmentIntensity = 0.55;
  }
  scene.main.add(studio.stage);
  scene.rotors.add(studio.rotorLights);

  const camera = new PerspectiveCamera(30, o.width / o.height, 0.05, 200);
  const fanRow = def.bladeRows.find((r) => r.id === 'fan');
  const fanGeo = geo.rows.find((r) => r.row.id === 'fan');
  if (fanRow === undefined || fanGeo === undefined) throw new Error('engineView: no fan row');
  const post: LookPipeline = createPipeline(
    renderer,
    scene.main,
    scene.rotors,
    camera,
    uniforms,
    {
      rHub: fanGeo.blade.rMin,
      rTip: fanGeo.blade.rMax + 0.002,
      pitch: (2 * Math.PI) / fanRow.count,
      xFore: fanGeo.blade.xMin - 0.002,
      xAft: fanGeo.blade.xMax + 0.002,
    },
    {
      fanSamples: 8,
      rotorSamples: 8,
      fanPlanes: 4,
      aoStrength: 0.9,
      bloomStrength: 0.06,
      bloomThreshold: 1.6,
      debug: o.debug ?? null,
    },
  );

  const cycle = createMockCycle(def);
  cycle.reset('groundIdle');
  let lever = 0;
  let settled = mockSteadyState(def, 0);
  let settle = true;
  let lp = 0;
  let hp = 0;
  let shutterDeg = SHUTTER_1000;
  let mode: LookMode = 'realistic';
  let cut = 0;
  let explode = 0;
  let lastCut = -1;
  let lastExplode = -1;
  let flags: DebugFlags = {};
  const target = new Vector3(0.5, 0, 0);

  const inputs = (): CycleInputs => ({
    ...DEFAULT_CYCLE_INPUTS,
    fuelLever: 'run',
    throttleLever: lever,
  });
  const speeds = () => (settle ? settled : cycle.state());
  const drawnTriangles = () => {
    let n = 0;
    for (const s of [scene.main, scene.rotors])
      s.traverseVisible((obj) => {
        const g = (obj as { geometry?: { index?: { count: number } | null } }).geometry;
        const count = (obj as { count?: number }).count ?? 1;
        if (g?.index) n += (g.index.count / 3) * count;
      });
    return n;
  };

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
      view.setShutter(p.shutterDeg);
      view.setCinematic(p.cinematic);
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
    setCinematic(on) {
      post.setCinematic(on);
    },
    setCameraPose(position, t) {
      camera.position.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
      target.set(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateProjectionMatrix();
    },
    setDebugFlags(f) {
      flags = { ...f };
      const cove = studio.stage.getObjectByName('cyclorama');
      if (cove) cove.visible = f.noStage !== true;
      renderer.shadowMap.enabled = f.noShadow !== true;
      studio.key.shadow.needsUpdate = true;
    },
    frame(dtS) {
      const t0 = performance.now();
      timer.beginFrame();
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
      const showCaps = wedge.halfWidth > 1e-3 && flags.noCaps !== true;
      for (const [a, b] of scene.caps) {
        a.visible = b.visible = showCaps;
        a.rotation.x = wedge.center - wedge.halfWidth;
        b.rotation.x = wedge.center + wedge.halfWidth;
      }
      // the static shadow map follows the engine only while it moves (mode transitions)
      if (cut !== lastCut || explode !== lastExplode) studio.key.shadow.needsUpdate = true;
      lastCut = cut;
      lastExplode = explode;
      const offsets = explodeOffsets(def, explode, EXPLODE_GAP);
      for (const m of scene.modules) {
        const dx = m.id === null ? 0 : offsets[m.id];
        for (const g of m.groups) g.position.x = dx;
      }
      // closed engine (LD-6): draw only what the cowls can show
      const closed = cut === 0 && explode === 0 && flags.noCull !== true;
      for (const obj of scene.closedHidden) obj.visible = !closed;
      const skinsVisible = explode < 0.02;
      for (const s of scene.skins) if (!s.name.startsWith('cap:')) s.visible = skinsVisible;
      if (!skinsVisible)
        for (const s of scene.skins) if (s.name.startsWith('cap:')) s.visible = false;
      studio.contact.value = 1 - easeInOut(explode);

      post.focusDistance.value = camera.position.distanceTo(target);
      if (flags.noPost === true) renderer.render(scene.main, camera);
      else post.render();
      timer.endFrame(performance.now() - t0);
    },
    stats() {
      const st = speeds();
      return {
        triangles: scene.triangles,
        drawnTriangles: drawnTriangles(),
        n1Rpm: st.n1Rpm,
        n2Rpm: st.n2Rpm,
        lpBlurDeg: (uniforms.lpBlur.value * 180) / Math.PI,
        errors,
        cycleLabel: MOCK_LABEL,
        timings: timer.medians(),
        timestamps: timer.enabled,
      };
    },
    async dispose() {
      post.dispose();
      scene.dispose();
      studio.dispose();
      // three's dispose is asynchronous; the device goes only after it, whatever happens
      // (three never destroys a supplied device, GPU_FACTS M15)
      try {
        await Promise.resolve(renderer.dispose());
      } catch (e: unknown) {
        errors.push({ kind: 'unknown', message: `renderer.dispose: ${String(e)}` });
      } finally {
        device.destroy();
      }
    },
  };
  view.setPreset('threeQuarterFront');
  return view;
}
