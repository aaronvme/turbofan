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
  EqualDepth,
  LessEqualDepth,
  type Material,
  Matrix4,
  MeshBasicNodeMaterial,
  type Mesh,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../contracts/cycle';
import type { EngineDefinition } from '../contracts/engine';
import {
  buildEngineGeometry,
  GEOMETRY_QUALITY,
  type EngineGeometry,
} from '../geometry/engineGeometry';
import { cutawayWedge, wrapAngle } from '../geometry/cutaway';
import { easeInOut, explodeOffsets } from '../geometry/explode';
import {
  advanceAngle,
  fanTimeCopies,
  shutterBlurAngle,
  spoolDisplayFactor,
} from '../geometry/motion';
import { screenRectOfBox, type Box3Like } from '../geometry/screenRect';
import { closedViewVisibility } from '../geometry/visibility';
import {
  requestSimDevice,
  type GpuErrorReport,
  type SimDevice,
  type SimDeviceOptions,
} from '../gpu/device';
import type { FrameSample, PassMedians } from '../gpu/passTimings';
import {
  initialRenderScale,
  nextRenderScale,
  RENDER_PROFILES,
  type RenderProfileId,
} from '../gpu/renderScale';
import { createMockCycle, mockSteadyState, MOCK_LABEL } from '../mocks/mockCycle';
import { buildEngineScene, type EngineScene } from './engineScene';
import { createLookUniforms, createMaterials, type LookUniforms } from './materials';
import { createPassTimer, type PassTimer } from './passTimer';
import { createPipeline, type LookPipeline, type PostDebug } from './post';
import { LOOK_PRESETS, SHUTTER_1000, type LookMode, type LookPresetId } from './presets';
import { createRendererOnDevice } from './rendererOnDevice';
import { createStandMesh, createStudio, FLOOR_Y, type Studio } from './studio';
import { standLayout } from '../geometry/stand';
import { X as STATIONS } from '../geometry/parts';

export interface EngineViewOptions {
  readonly gpu: GPU;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly definition: EngineDefinition;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly quality?: keyof typeof GEOMETRY_QUALITY;
  readonly onError?: (r: GpuErrorReport) => void;
  /**
   * Device limits wanted for a compute consumer on the view's device, each at min(value, the
   * adapter's): the flow solver's FLOW_SOLVER_LIMITS (D4-50), as the P1 page asks (D4-64).
   */
  readonly preferredLimits?: SimDeviceOptions['preferredLimits'];
  readonly debug?: PostDebug;
  /** Per-pass GPU timestamps (default on when the adapter has timestamp-query). */
  readonly timing?: boolean;
  /** `quality` (full resolution, the default) or `performance` (dynamic resolution, D3-7). */
  readonly profile?: RenderProfileId;
  /**
   * Tests only: the pre-W1V-I1 TRAA (three r186's own resolve, the scene's depth and velocity
   * only), the negative control of tests/browser/rotorMotion.test.ts.
   */
  readonly legacyTraa?: boolean;
  /** Look-dev A/B only: the pre-round-5 scene pass targets (colour, normal, velocity). */
  readonly legacyGbuffer?: boolean;
}

export interface EngineViewStats {
  readonly triangles: number;
  /**
   * Triangles the camera draws this frame (culling applied; W1V-I2): the main and rotor passes,
   * the fan's shaded time copies included, the layer-2 shadow proxies and the fan's depth
   * pre-pass excluded (`fanDepthTriangles`).
   */
  readonly drawnTriangles: number;
  /** Of `drawnTriangles`, the main (opaque) pass. */
  readonly mainTriangles: number;
  /** The fan's depth pre-pass copies (vertex work only). */
  readonly fanDepthTriangles: number;
  /** Draw calls of the camera passes (main + rotors + pre-pass). */
  readonly drawCalls: number;
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly lpBlurDeg: number;
  readonly errors: readonly GpuErrorReport[];
  readonly cycleLabel: typeof MOCK_LABEL;
  /** Rolling medians of GPU ms per pass and CPU ms per frame (W1G-I2). */
  readonly timings: PassMedians;
  readonly timestamps: boolean;
  readonly profile: RenderProfileId;
  /** The 3D passes' resolution relative to the canvas (1 in `quality`). */
  readonly renderScale: number;
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
  /** The render profile (D3-7): `performance` follows the GPU time with the render scale. */
  setProfile(id: RenderProfileId): void;
  setCameraPose(position: readonly number[], target: readonly number[]): void;
  /** Look-dev A/B switches (e.g. caps or culling off) for timing comparisons. */
  setDebugFlags(flags: DebugFlags): void;
  /** Advances the simulation clock by dt seconds and renders one frame. */
  frame(dtS: number): void;
  stats(): EngineViewStats;
  /** Records every frame's pass timings from now on (a D0-1 timing run, W1L-I4). */
  beginTimingRun(): void;
  /** The frames since beginTimingRun; stops recording. */
  endTimingRun(): FrameSample[];
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
  /** The post chain without TRAA (the fan-blur reference test compares un-accumulated frames). */
  readonly noTraa?: boolean;
  /** Write half the linear radiance (no tone map, no sRGB): image tests average light. */
  readonly linear?: boolean;
  /** Extra LP spool angle, rad (the fan-blur reference renders stills across the exposure). */
  readonly lpPhase?: number;
  /** Fewer fan time copies than FAN_TIME_SAMPLES (the rotor pass's cost per copy). */
  readonly fanCopies?: number;
  /** No fan at all (what the rest of the rotor pass costs). */
  readonly noFan?: boolean;
  /** Hide every main/rotor object whose name matches this regular expression (cost bisection). */
  readonly hide?: string;
  /** The main pass draws only the nacelle and cowl skins (what the internals cost, D4-5). */
  readonly skinsOnly?: boolean;
  /**
   * The fan drawn with an ordinary depth test (no pre-pass, LessEqual with depth write) at
   * shutter 0: the reference the EqualDepth path must match pixel for pixel (W1V-I3).
   */
  readonly plainFanDepth?: boolean;
  /** Turns the fan's pre-pass copies by this angle, rad: a hole pattern (W1V-I3 control). */
  readonly fanDepthNudge?: number;
  /** Main-pass meshes whose name matches this regular expression get the trivial material. */
  readonly flatNames?: string;
  /** The main pass with one trivial unlit material (what its materials cost, D4-5). */
  readonly flat?: boolean;
  /** Rotor pixels keep the main pass's zero velocity in TRAA (W1V-I1: the old behaviour). */
  readonly noRotorMotion?: boolean;
  /** Scales the rotor motion vectors' spool steps (a probe of their sign and size). */
  readonly rotorMotionScale?: number;
}

const FPS = 60;
const CUT_WIDTH = (100 * Math.PI) / 180;
const EXPLODE_GAP = 0.22;
const TRANSITION_S = 1.4;

/** The fan blades' axis-aligned box over every angle (a cylinder about x), m. */
function fanBoxOf(geo: EngineGeometry): Box3Like {
  const fan = geo.rows.find((r) => r.material === 'fanBlade');
  if (fan === undefined) throw new Error('engineView: no fan geometry');
  const p = fan.blade.mesh.positions;
  let x0 = Infinity;
  let x1 = -Infinity;
  let r = 0;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] ?? 0;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    r = Math.max(r, Math.hypot(p[i + 1] ?? 0, p[i + 2] ?? 0));
  }
  return { min: [x0, -r, -r], max: [x1, r, r] };
}

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
    ...(o.preferredLimits === undefined ? {} : { preferredLimits: o.preferredLimits }),
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
    // a dispose failure on this path is attached to the init error, not dropped (W1L-N5)
    let disposeError: unknown = null;
    if (renderer !== null)
      await Promise.resolve(renderer.dispose()).catch((d: unknown) => {
        disposeError = d;
      });
    device.destroy();
    if (disposeError !== null) {
      const what = (x: unknown) => (x instanceof Error ? x.message : 'non-Error value');
      throw new AggregateError(
        [e, disposeError],
        `${what(e)} (and renderer.dispose failed: ${what(disposeError)})`,
        { cause: e },
      );
    }
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
  const closedSet = closedViewVisibility(def, geo);
  const scene: EngineScene = buildEngineScene(geo, createMaterials(uniforms), closedSet);
  const studio: Studio = await createStudio(renderer);
  for (const s of [scene.main, scene.rotors]) {
    s.environment = studio.environment;
    s.environmentIntensity = 0.55;
  }
  scene.main.add(studio.stage);
  // the engine rests on its stand (W1V-N5); the cowls and the stand go in the exploded view
  const stand = createStandMesh(
    standLayout(
      {
        nacelle: (x) => geo.walls.nacelleOuter.radiusAt(x),
        cowl: (x) => geo.walls.coreCowl.radiusAt(x),
      },
      FLOOR_Y,
      STATIONS.nacelleTe,
    ),
  );
  scene.main.add(stand.group);
  scene.rotors.add(studio.rotorLights);

  const camera = new PerspectiveCamera(30, o.width / o.height, 0.05, 200);
  const fanRow = def.bladeRows.find((r) => r.id === 'fan');
  if (fanRow === undefined) throw new Error('engineView: no fan row');
  const fanPitch = (2 * Math.PI) / fanRow.count;
  const fanBox = fanBoxOf(geo);
  const viewProj = new Matrix4();
  let heightPx = o.height * o.dpr;
  const post: LookPipeline = createPipeline(renderer, scene.main, scene.rotors, camera, {
    rotorSamples: 8,
    aoStrength: 0.9,
    bloomStrength: 0.06,
    bloomThreshold: 1.6,
    debug: o.debug ?? null,
    ...(o.legacyGbuffer === true ? { legacyGbuffer: true } : {}),
    ...(o.legacyTraa === true
      ? { legacyTraa: true }
      : { rotorMotion: { lpStep: uniforms.lpStep, hpStep: uniforms.hpStep } }),
  });

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
  let fanFrame = 0;
  // the exploded engine eases its spools to a stop (D4-4); 1 = running
  let spoolFactor = 1;
  let profile: RenderProfileId = o.profile ?? 'quality';
  let scaleState = initialRenderScale(RENDER_PROFILES[profile]);
  post.setRenderScale(scaleState.scale);
  const target = new Vector3(0.5, 0, 0);

  const inputs = (): CycleInputs => ({
    ...DEFAULT_CYCLE_INPUTS,
    fuelLever: 'run',
    throttleLever: lever,
  });
  const speeds = () => (settle ? settled : cycle.state());
  // what the camera draws (W1V-I2): objects on a layer the camera does not see (the rotor
  // lights' shadow proxies) are skipped, and the fan's depth pre-pass is counted apart
  const fanDepthCopies = new Set<Object3D>(scene.fanTimeCopies.map((c) => c.depth));
  const drawCounts = () => {
    let main = 0;
    let rotors = 0;
    let depth = 0;
    let draws = 0;
    for (const s of [scene.main, scene.rotors])
      s.traverseVisible((obj) => {
        if (!obj.layers.test(camera.layers)) return;
        const g = (obj as { geometry?: { index?: { count: number } | null } }).geometry;
        if (!g?.index) return;
        const n = (g.index.count / 3) * ((obj as { count?: number }).count ?? 1);
        draws++;
        if (fanDepthCopies.has(obj)) depth += n;
        else if (s === scene.main) main += n;
        else rotors += n;
      });
    return { drawn: main + rotors, main, depth, draws };
  };
  let hidden: Object3D[] = [];
  const swapped = new Map<Mesh, Mesh['material']>();
  const flatMaterial = new MeshBasicNodeMaterial({ color: 0x808080 });

  const view: EngineView = {
    renderer,
    camera,
    device,
    uniforms,
    setSize(width, height, dpr) {
      heightPx = height * dpr;
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
        spoolFactor = m === 'exploded' ? 0 : 1;
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
    setProfile(id) {
      profile = id;
      scaleState = initialRenderScale(RENDER_PROFILES[id]);
      post.setRenderScale(scaleState.scale);
    },
    setCameraPose(position, t) {
      camera.position.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
      target.set(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateProjectionMatrix();
    },
    setDebugFlags(f) {
      flags = { ...f };
      hidden = [];
      if (f.hide !== undefined && f.hide !== '') {
        // matched against "main:<name>" / "rotors:<name>", so a pattern can pick one pass
        const re = new RegExp(f.hide);
        for (const [tag, s] of [
          ['main', scene.main],
          ['rotors', scene.rotors],
        ] as const)
          s.traverse((o) => {
            if (o !== s && re.test(`${tag}:${o.name}`)) hidden.push(o);
          });
      }
      if (f.skinsOnly === true) {
        const keep = new Set<Object3D>(scene.skins);
        for (const m of scene.modules)
          m.groups[0]?.traverse((o) => {
            if ((o as { isMesh?: boolean }).isMesh === true && !keep.has(o)) hidden.push(o);
          });
      }
      scene.main.overrideMaterial = f.flat === true ? flatMaterial : null;
      const fanMat = scene.fanTimeCopies[0]?.shaded.material as Material | undefined;
      if (fanMat !== undefined) {
        const plain = f.plainFanDepth === true;
        fanMat.depthFunc = plain ? LessEqualDepth : EqualDepth;
        fanMat.depthWrite = plain;
        fanMat.needsUpdate = true;
      }
      for (const [mesh, mat] of swapped) mesh.material = mat;
      swapped.clear();
      if (f.flatNames !== undefined && f.flatNames !== '') {
        const re = new RegExp(f.flatNames);
        scene.main.traverse((o) => {
          if ((o as { isMesh?: boolean }).isMesh === true && re.test(o.name)) {
            swapped.set(o as Mesh, (o as Mesh).material);
            (o as Mesh).material = flatMaterial;
          }
        });
      }
      const cove = studio.stage.getObjectByName('cyclorama');
      if (cove) cove.visible = f.noStage !== true;
      renderer.shadowMap.enabled = f.noShadow !== true;
      for (const l of studio.shadowLights) l.shadow.needsUpdate = true;
    },
    frame(dtS) {
      const t0 = performance.now();
      timer.beginFrame();
      if (!settle) cycle.step(Math.min(dtS, 0.1), inputs());
      const cycleSpeeds = speeds();
      spoolFactor = spoolDisplayFactor(spoolFactor, mode === 'exploded', dtS);
      const st = {
        n1Rpm: cycleSpeeds.n1Rpm * spoolFactor,
        n2Rpm: cycleSpeeds.n2Rpm * spoolFactor,
      };
      const lpWas = lp;
      const hpWas = hp;
      lp = advanceAngle(lp, st.n1Rpm, def.rotation.lp, dtS);
      hp = advanceAngle(hp, st.n2Rpm, def.rotation.hp, dtS);
      // what each spool turned since the last frame (TRAA's rotor motion vectors); a phase
      // set by a debug flag is a jump, not motion
      const motionK = flags.noRotorMotion === true ? 0 : (flags.rotorMotionScale ?? 1);
      uniforms.lpStep.value = motionK * wrapAngle(lp - lpWas);
      uniforms.hpStep.value = motionK * wrapAngle(hp - hpWas);
      const lpShown = lp + (flags.lpPhase ?? 0);
      for (const g of scene.spoolGroups.lp) g.rotation.x = lpShown;
      for (const g of scene.spoolGroups.hp) g.rotation.x = hp;
      uniforms.lpBlur.value = shutterBlurAngle(st.n1Rpm, shutterDeg, FPS);
      uniforms.hpBlur.value = shutterBlurAngle(st.n2Rpm, shutterDeg, FPS);
      // the fan's time copies spread over the exposure, re-jittered every frame, and the copy
      // each pixel picks offset every frame: the two offsets are the 2-D R2 sequence (plastic
      // number), so they are jointly well spread and every pixel's instants cover the shutter
      // interval (W1L-I3). Up to two
      // pitches the exposure is exact; beyond, one pitch (the image is periodic in it, so
      // only the per-blade jitter differs) keeps the copies at distinct phases
      const fanSpan = uniforms.lpBlur.value <= 2 * fanPitch ? uniforms.lpBlur.value : fanPitch;
      const fanLive = fanSpan > 1e-5;
      fanFrame = (fanFrame + 1) % 1_000_000;
      const j = (fanFrame * 0.5698402909980532) % 1;
      uniforms.fanSeed.value = (fanFrame * 0.7548776662466927) % 1;
      const nCopies = Math.max(
        1,
        Math.min(
          scene.fanTimeCopies.length,
          flags.fanCopies ?? fanTimeCopies(fanSpan, fanPitch, scene.fanTimeCopies.length),
        ),
      );
      uniforms.fanCopies.value = fanLive ? nCopies : 1;
      scene.fanTimeCopies.forEach((c, k) => {
        c.depth.visible = c.shaded.visible =
          flags.noFan !== true && (fanLive ? k < nCopies : k === 0);
        if (flags.plainFanDepth === true) c.depth.visible = false;
        c.depth.rotation.x = c.shaded.rotation.x = fanLive
          ? ((k + j) / nCopies - 0.5) * fanSpan
          : 0;
        c.depth.rotation.x += flags.fanDepthNudge ?? 0;
      });

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
      if (cut !== lastCut || explode !== lastExplode)
        for (const l of studio.shadowLights) l.shadow.needsUpdate = true;
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
      // and what shows only through one opening, only for an eye on that side
      const eyeX = camera.position.x;
      for (const obj of scene.frontOnly) obj.visible = !closed || eyeX < closedSet.eye.front;
      for (const obj of scene.rearOnly) obj.visible = !closed || eyeX > closedSet.eye.rear;
      const skinsVisible = explode < 0.02;
      stand.group.visible = skinsVisible;
      for (const s of scene.skins) if (!s.name.startsWith('cap:')) s.visible = skinsVisible;
      if (!skinsVisible)
        for (const s of scene.skins) if (s.name.startsWith('cap:')) s.visible = false;
      studio.contact.value = 1 - easeInOut(explode);
      for (const o of hidden) o.visible = false;
      // the composite's fan region: the fan's box where the exploded view has moved it, 3 px
      // of margin for the 3 x 3 neighbourhood and TRAA's jitter
      camera.updateMatrixWorld();
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const fdx = offsets.fan;
      const rect = screenRectOfBox(
        viewProj.elements,
        {
          min: [fanBox.min[0] + fdx, fanBox.min[1], fanBox.min[2]],
          max: [fanBox.max[0] + fdx, fanBox.max[1], fanBox.max[2]],
        },
        3 / Math.max(1, heightPx),
      );
      post.fanRect.value.set(rect.min[0], rect.min[1], rect.max[0], rect.max[1]);

      // dynamic resolution (D3-7): the median GPU time of the timer's rolling window, at the
      // current scale (the controller holds for a full window after every change)
      scaleState = nextRenderScale(scaleState, timer.medians().gpuTotal, RENDER_PROFILES[profile]);
      post.setRenderScale(scaleState.scale);
      post.focusDistance.value = camera.position.distanceTo(target);
      if (flags.noPost === true) renderer.render(scene.main, camera);
      else post.render(flags.noTraa !== true, flags.linear === true);
      timer.endFrame(performance.now() - t0);
    },
    stats() {
      const st = speeds();
      const d = drawCounts();
      return {
        triangles: scene.triangles,
        drawnTriangles: d.drawn,
        mainTriangles: d.main,
        fanDepthTriangles: d.depth,
        drawCalls: d.draws,
        n1Rpm: st.n1Rpm,
        n2Rpm: st.n2Rpm,
        lpBlurDeg: (uniforms.lpBlur.value * 180) / Math.PI,
        errors,
        cycleLabel: MOCK_LABEL,
        timings: timer.medians(),
        timestamps: timer.enabled,
        profile,
        renderScale: scaleState.scale,
      };
    },
    beginTimingRun() {
      timer.beginRun();
    },
    endTimingRun() {
      return timer.endRun();
    },
    async dispose() {
      post.dispose();
      flatMaterial.dispose();
      scene.dispose();
      studio.dispose();
      stand.dispose();
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
