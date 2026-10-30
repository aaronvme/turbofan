// The flow visuals in three (w2/flowviz): what the simulated field looks like on screen. Every
// layer reads the field the view is bound to (src/render/flowCompute.ts: the solver's own
// resample textures, D0-4, or a CPU field such as the MOCK raster) through ExternalTextures:
//
// - The cut plane: the near-extent field painted on the two faces of the cutaway wedge, where the
//   caps show the metal (fluid texels get the field, solid ones are left to the caps). Colour by
//   one quantity (src/flow/viz/fields.ts) through a 256-texel LUT (src/flow/viz/colormaps.ts),
//   with contour lines one `contourStep` apart, cropped to the near field (D4-76). The LUT holds
//   display-encoded sRGB bytes and the plane composites after the tone map, so its pixels are
//   the legend's colours exactly (D4-76).
// - The particles: the GPU particle records (flowCompute.ts) drawn as camera-facing streaks along
//   their 3D velocity, length |u| x dilation x STREAK_EXPOSURE_S (at most STREAK_MAX_M), a capsule profile a few pixels wide,
//   fading toward the tail. Both layers are in the "Flow Overlay" scene (src/render/post.ts
//   renders it as its own pass, timed outside P4) and are depth-tested by hand against the
//   engine's scene and rotor depths.
// - Heat haze and schlieren: a raymarch through the axisymmetric density gradient (the
//   gradient kernel's texture) along each pixel's view ray, mirrored from src/flow/viz/schlieren.ts:
//   eps = K rho_inf integral grad_perp(g) ds. The haze is the background's apparent shift
//   (hazeShiftPx), the schlieren the knife-edge image (knifeEdgeIntensity), at half resolution.
// Worker-safe: no DOM.

import {
  CustomBlending,
  DataTexture,
  DoubleSide,
  ExternalTexture,
  FloatType,
  Group,
  InstancedBufferGeometry,
  LinearFilter,
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoColorSpace,
  type Node,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  Scene,
  StorageBufferAttribute,
  type UniformNode,
  UnsignedByteType,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  abs,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  cross,
  Discard,
  dot,
  float,
  Fn,
  fract,
  fwidth,
  If,
  instanceIndex,
  interleavedGradientNoise,
  length,
  log2,
  Loop,
  max,
  min,
  mix,
  normalize,
  positionView,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  storage,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { FieldExtent } from '../contracts/flow';
import { bakeLut, COLORMAPS, type ColormapId } from '../flow/viz/colormaps';
import { FIELD_QUANTITIES, GAMMA_R_TABLE, type FieldQuantityId } from '../flow/viz/fields';
import {
  CROP_OUTLINE,
  STREAK_EXPOSURE_S,
  STREAK_MAX_M,
  tracersShown,
  type CutPlaneCrop,
  type FlowVizMode,
} from '../flow/viz/modes';
import { gladstoneDaleK } from '../flow/viz/optics';
import { PARTICLE_FLOATS } from '../flow/viz/particleKernel';
import type { FlowCompute, FlowFieldBinding } from './flowCompute';
import { injectGpuBuffer } from './rendererOnDevice';

/** The cut plane's speed of sound: air's gamma R table (fields.ts, W2V-N11: the tested one). */
const A_T0 = GAMMA_R_TABLE.t0;
const A_T1 = GAMMA_R_TABLE.t1;
const A_N = GAMMA_R_TABLE.n;

/** Half the streak's width, px (of the flow pass's target). */
const HALF_WIDTH_PX = 1;
/**
 * In the display modes a streak carries a dark halo out to this half width, px, so a light
 * tracer reads on every colour of the map (white on viridis yellow has no contrast), as map
 * labels do.
 */
const HALO_PX = 2.2;
/**
 * A tracer's exposure is spread along its streak: in the scene-linear mode the streak's
 * opacity falls as 1 / length beyond this length, m, so fast jets do not paint solid white.
 */
const EXPOSURE_LEN_M = 0.12;
/** Gladstone-Dale K at 550 nm (the photopic peak), m^3/kg. */
const K_GD = gladstoneDaleK(550);
/** A rotor surface hides the flow layer only when it is this much nearer, m. */
const ROTOR_SLACK_M = 0.08;
/**
 * The static scene's slack, m: the stator vanes straddle the cut faces too (they are hidden
 * blade by blade, not cut), so they get the rotors' slack; the section caps lie on the plane.
 */
const SCENE_SLACK_M = ROTOR_SLACK_M;
/**
 * In the cut modes the particles are lit as by a laser sheet (the experimental technique): only
 * those within this distance of a cut face show, so they trace the flow over the section
 * instead of filling the open wedge, m.
 */
const SHEET_HALF_M = 0.03;
/** The haze and schlieren march this many samples along a pixel's ray through the near field. */
const HAZE_STEPS = 32;
const SCHLIEREN_STEPS = 96;

type DepthNode = Node<'vec4'> & {
  load(texel: Node<'vec2'>): Node<'vec4'>;
  sample(uv: Node<'vec2'>): Node<'vec4'>;
};

/** The camera's view geometry the haze needs (resolution-free). */
export interface FlowViewGeometry {
  /** 2 tan(fovY / 2): the frame height's angular size at unit distance. */
  readonly tanFovY2: number;
  /** Width over height. */
  readonly aspect: number;
}

/** What the visuals need from the render pipeline (src/render/post.ts). */
export interface FlowPostDeps {
  /** The scene and rotor passes' depth textures (WebGPU depth in [0, 1]). */
  readonly sceneDepth: DepthNode;
  readonly rotorDepth: DepthNode;
  /** WebGPU depth to view-space z (negative in front of the camera). */
  viewZOf(d: Node<'float'>): Node<'float'>;
  readonly camProjInv: UniformNode<'mat4', unknown>;
  readonly camWorld: UniformNode<'mat4', unknown>;
  readonly cameraPosition: UniformNode<'vec3', unknown>;
}

export interface FlowViz {
  /** The "Flow Overlay" scene: the cut plane and the particles (post.ts renders it). */
  readonly scene: Scene;
  /** Follows the field the compute is bound to (call after a bind). */
  bindField(b: FlowFieldBinding): void;
  /** The mode drawn (null: nothing), and the cut plane's quantity (null: the mode's). */
  setMode(mode: FlowVizMode | null, quantity?: FieldQuantityId | null): void;
  /** Time dilation: the particles' simulated seconds per wall second. */
  setDilation(d: number): void;
  /** Hides the particles whatever the mode (a debug A/B). */
  setParticlesHidden(hidden: boolean): void;
  /** D4-83: the viewer's tracer choice (null: the mode's default; Realistic has none). */
  setTracers(on: boolean | null): void;
  /** No haze whatever the mode (a debug A/B). */
  setHazeOff(off: boolean): void;
  /** D4-76: the cut plane over the full near-field raster instead of the mode's crop. */
  setFullDomain(full: boolean): void;
  /** Follows the cutaway wedge (the planes lie on its faces) and the camera's pixel angle. */
  update(cutCenter: number, cutHalf: number, open: boolean, view: FlowViewGeometry): void;
  /** The haze's background shift in uv (xy), built on the pipeline's depth (post.ts). */
  hazeNode(deps: FlowPostDeps): Node<'vec4'>;
  /** The schlieren's eps (up, right) per pixel, rad (post.ts composites the grey). */
  schlierenNode(deps: FlowPostDeps): Node<'vec4'>;
  /** Builds the depth-tested materials once the pipeline exists. */
  attach(deps: FlowPostDeps): void;
  dispose(): void;
}

/** The pixel's view ray, its normal basis and how far it runs to the first opaque surface. */
function viewRay(deps: FlowPostDeps) {
  const suv = screenUV;
  const ndc = vec2(suv.x.mul(2).sub(1), float(1).sub(suv.y.mul(2)));
  const hv = deps.camProjInv.mul(vec4(ndc, 0.5, 1));
  const dirV = normalize(hv.xyz.div(hv.w));
  const dir = normalize(deps.camWorld.mul(vec4(dirV, 0)).xyz);
  const camUp = deps.camWorld.mul(vec4(0, 1, 0, 0)).xyz;
  const right = normalize(cross(dir, camUp));
  const up = cross(right, dir);
  const d = min(deps.sceneDepth.sample(suv).r, deps.rotorDepth.sample(suv).r);
  // distance along the unit ray to the first opaque surface (far: none)
  const tSurf = select(d.lessThan(1), deps.viewZOf(d).div(dirV.z), float(1e4));
  return { dir, right, up, tSurf };
}

/** Premultiplied "over": src + dst (1 - src alpha), colour and alpha alike. */
function premultiplied(m: MeshBasicNodeMaterial): void {
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
}

export function createFlowViz(o: {
  readonly renderer: WebGPURenderer;
  readonly compute: FlowCompute;
  readonly extent: FieldExtent;
}): FlowViz {
  const { extent: e, compute } = o;
  // the field's textures: rebound with the compute (solver or CPU field)
  let ext: { state: ExternalTexture; velocity: ExternalTexture } | null = null;
  const blank = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType);
  blank.needsUpdate = true;
  const linear = (t: ExternalTexture): ExternalTexture => {
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    return t;
  };
  const stateNode = texture(blank);
  const velocityNode = texture(blank);
  const gradientTex = linear(new ExternalTexture(compute.gradient));
  const gradientNode = texture(gradientTex);
  const rhoInf = uniform(1.225);
  const dilation = uniform(1 / 200);
  const opacity = uniform(0);
  /** 1: display-encoded white streaks (D4-76 modes); 0: scene-linear radiance (Realistic). */
  const display = uniform(0);
  const tanFovY2 = uniform(0.5);
  const aspect = uniform(16 / 9);
  /** The mode's haze strength (1 = the physical Gladstone-Dale deflection; 0 = none). */
  const hazeGain = uniform(0);
  let hazeOff = false;
  const sheet = { on: uniform(0), faceA: uniform(0), faceB: uniform(0) };
  const crop = {
    on: uniform(0),
    xMin: uniform(-1e3),
    xMax: uniform(1e3),
    rMax: uniform(1e3),
  };

  const luts = new Map<ColormapId, DataTexture>();
  for (const id of Object.keys(COLORMAPS) as ColormapId[]) {
    // raw display-encoded bytes: the plane composites in display space (D4-76), so the LUT is
    // never decoded to linear (NoColorSpace) and its pixels are the legend's bytes
    const t = new DataTexture(bakeLut(id), 256, 1, RGBAFormat, UnsignedByteType);
    t.colorSpace = NoColorSpace;
    t.magFilter = t.minFilter = LinearFilter;
    t.needsUpdate = true;
    luts.set(id, t);
  }
  const gammaR = new DataTexture(GAMMA_R_TABLE.values.slice(), A_N, 1, RedFormat, FloatType);
  gammaR.magFilter = gammaR.minFilter = NearestFilter;
  gammaR.needsUpdate = true;

  let deps: FlowPostDeps | null = null;
  /**
   * True where this fragment lies behind the engine: a static or rotor surface nearer by more
   * than the slack (the plane lies exactly on the section caps; the rows at the cut faces
   * straddle them, and the rotors' shutter blur smears them across the section: they must not
   * hide the data, but the fan in front of it still does).
   */
  const behindEngine = (viewZ: Node<'float'>): Node<'bool'> => {
    if (deps === null) throw new Error('flowViz: attach() before drawing');
    const t = screenCoordinate.xy;
    const ds = deps.sceneDepth.load(t).r;
    const dr = deps.rotorDepth.load(t).r;
    const behindScene = ds.lessThan(1).and(viewZ.lessThan(deps.viewZOf(ds).sub(SCENE_SLACK_M)));
    const behindRotor = dr.lessThan(1).and(viewZ.lessThan(deps.viewZOf(dr).sub(ROTOR_SLACK_M)));
    return behindScene.or(behindRotor);
  };

  const value = (id: FieldQuantityId, s: Node<'vec4'>, v: Node<'vec4'>): Node<'float'> => {
    switch (id) {
      case 'p':
        return log2(max(s.x.add(1), 1e-4));
      case 'rho':
        return log2(max(s.y.add(1), 1e-4));
      case 't':
        return s.z;
      case 'speed':
        return length(v.xyz);
      case 'mach': {
        const u = s.z
          .sub(A_T0)
          .div(A_T1 - A_T0)
          .clamp(0, 1)
          .mul((A_N - 1) / A_N)
          .add(0.5 / A_N);
        const gr = texture(gammaR).sample(vec2(u, 0.5)).r;
        return length(v.xyz).div(sqrt(gr.mul(max(s.z, 1))));
      }
    }
  };

  const planeMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  planeMaterial.transparent = true;
  planeMaterial.depthWrite = true;
  premultiplied(planeMaterial);
  let quantity: FieldQuantityId | null = null;
  let built: FieldQuantityId | null = null;
  let mode: FlowVizMode | null = null;
  let particlesHidden = false;
  let tracers: boolean | null = null;
  const showStreaks = () => {
    streaks.visible = mode !== null && tracersShown(mode, tracers) && !particlesHidden;
  };
  let fullDomain = false;
  const applyCrop = () => {
    const c: CutPlaneCrop | null = fullDomain ? null : (mode?.crop ?? null);
    crop.on.value = c === null ? 0 : 1;
    if (c !== null) {
      crop.xMin.value = c.xMin;
      crop.xMax.value = c.xMax;
      crop.rMax.value = c.rMax;
    }
  };
  const buildPlane = (id: FieldQuantityId) => {
    built = id;
    const spec = FIELD_QUANTITIES[id];
    const lut = luts.get(spec.colormap);
    if (lut === undefined) throw new Error(`flowViz: no LUT ${spec.colormap}`);
    planeMaterial.fragmentNode = Fn(() => {
      If(behindEngine(positionView.z), () => {
        Discard();
      });
      const s = stateNode.sample(uv());
      const v = velocityNode.sample(uv());
      const q = value(id, s, v);
      // a non-finite field (a diverging solver before the fallback, W2V-I6) never reaches the
      // blend: comparisons with NaN are false
      If(abs(q).lessThan(1e30).and(abs(v.w).lessThan(1e30)).not(), () => {
        Discard();
      });
      const t = q
        .sub(spec.min)
        .div(spec.max - spec.min)
        .clamp(0, 1);
      const base = texture(lut).sample(vec2(t.mul(255 / 256).add(0.5 / 256), 0.5)).rgb;
      // anti-aliased contour lines, one per contourStep
      const c = q.div(spec.contourStep);
      const line = float(1).sub(min(abs(fract(c.sub(0.5)).sub(0.5)).div(max(fwidth(c), 1e-6)), 1));
      const rgb = mix(base, base.mul(0.25), line.mul(0.7));
      // the fluid edge at walls, anti-aliased (the caps show the solid)
      const fl = v.w;
      const aa = max(fwidth(fl), 1e-3);
      const fluid = smoothstep(float(0.5).sub(aa), float(0.5).add(aa), fl);
      // D4-76's near-field crop, D4-83: a crisp, anti-aliased edge with a thin outline just
      // inside it (a fade left viridis' darkest end as a purple fog round the engine)
      const x = uv()
        .x.mul(e.xMax - e.xMin)
        .add(e.xMin);
      const r = uv()
        .y.mul(e.rMax - e.rMin)
        .add(e.rMin);
      const edgeM = min(min(crop.rMax.sub(r), x.sub(crop.xMin)), crop.xMax.sub(x));
      const edgePx = edgeM.div(max(fwidth(edgeM), 1e-6));
      const inside = mix(float(1), edgePx.add(0.5).clamp(0, 1), crop.on);
      const outline = float(1)
        .sub(smoothstep(CROP_OUTLINE.widthPx - 0.5, CROP_OUTLINE.widthPx + 0.5, edgePx))
        .mul(crop.on)
        .mul(CROP_OUTLINE.alpha);
      const framed = mix(rgb, vec3(...CROP_OUTLINE.rgb), outline);
      const a = fluid.mul(inside);
      If(a.lessThan(0.002), () => {
        Discard();
      });
      return vec4(framed.mul(a), a);
    })();
    planeMaterial.needsUpdate = true;
  };

  // one half-plane per wedge face: local x = axial, local y = radius
  const planeGeo = new PlaneGeometry(e.xMax - e.xMin, e.rMax - e.rMin, 1, 1);
  planeGeo.translate((e.xMin + e.xMax) / 2, (e.rMin + e.rMax) / 2, 0);
  const planes = new Group();
  planes.name = 'flowCutPlane';
  const faces = [new Mesh(planeGeo, planeMaterial), new Mesh(planeGeo, planeMaterial)] as const;
  faces[0].name = 'flowCutPlane:a';
  faces[1].name = 'flowCutPlane:b';
  for (const f of faces) {
    f.frustumCulled = false;
    f.renderOrder = 0;
    planes.add(f);
  }
  planes.visible = false;

  // the particles: the compute's records, read in the vertex stage (GPU_FACTS M23-M25)
  const n = compute.count;
  const records = new StorageBufferAttribute(new Float32Array(PARTICLE_FLOATS * n), 4);
  injectGpuBuffer(o.renderer, records, compute.particleBuffer);
  const parts = storage(records, 'vec4', 3 * n);
  const streakGeo = new InstancedBufferGeometry();
  // corner (s along the streak, side across it)
  streakGeo.setAttribute(
    'position',
    new Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3),
  );
  streakGeo.setIndex([0, 2, 1, 1, 2, 3]);
  streakGeo.instanceCount = n;
  const streakMaterial = new MeshBasicNodeMaterial();
  streakMaterial.transparent = true;
  streakMaterial.depthWrite = false;
  premultiplied(streakMaterial);
  const streaks = new Mesh(streakGeo, streakMaterial);
  streaks.name = 'flowParticles';
  streaks.frustumCulled = false;
  streaks.renderOrder = 1;
  streaks.visible = false;

  const buildStreaks = () => {
    const k = instanceIndex.mul(3);
    const pos = parts.element(k);
    const aux = parts.element(k.add(1));
    const vel = parts.element(k.add(2));
    const corner = attribute<'vec3'>('position', 'vec3');
    const head = vec3(pos.x, pos.y.mul(cos(pos.z)), pos.y.mul(sin(pos.z)));
    const len = min(vel.w.mul(dilation).mul(STREAK_EXPOSURE_S), STREAK_MAX_M);
    const tail = head.sub(vel.xyz.div(max(vel.w, 1e-3)).mul(len));
    const viewH = cameraViewMatrix.mul(vec4(head, 1));
    const viewT = cameraViewMatrix.mul(vec4(tail, 1));
    const clipH = cameraProjectionMatrix.mul(viewH);
    const clipT = cameraProjectionMatrix.mul(viewT);
    const half = screenSize.mul(0.5);
    const sH = clipH.xy.div(clipH.w).mul(half);
    const sT = clipT.xy.div(clipT.w).mul(half);
    const dS = sH.sub(sT);
    const lenPx = length(dS);
    const dir = select(lenPx.greaterThan(1e-3), dS.div(max(lenPx, 1e-3)), vec2(1, 0));
    const nrm = vec2(dir.y.negate(), dir.x);
    const s = corner.x;
    const side = corner.y;
    // along the streak in px from the tail, extended by the half width at both ends (round
    // caps); the display modes' quads also hold the halo
    const outer = mix(float(HALF_WIDTH_PX + 0.5), float(HALO_PX + 0.5), display);
    const along = mix(outer.negate(), lenPx.add(outer), s);
    const across = side.mul(outer);
    const p = sT.add(dir.mul(along)).add(nrm.mul(across));
    const w = mix(clipT.w, clipH.w, s);
    const z = mix(clipT.z, clipH.z, s);
    // the laser sheet (cut modes): the distance to the nearer cut face, on its side of the axis
    const faceDist = (phi: Node<'float'>) => {
      const dth = pos.z.sub(phi);
      return select(cos(dth).greaterThan(0), pos.y.mul(abs(sin(dth))), float(1e3));
    };
    const lit = mix(
      float(1),
      float(1).sub(
        smoothstep(
          0.5 * SHEET_HALF_M,
          SHEET_HALF_M,
          min(faceDist(sheet.faceA), faceDist(sheet.faceB)),
        ),
      ),
      sheet.on,
    );
    // the long exposure's spread (scene-linear mode): opacity ~ 1 / length past EXPOSURE_LEN_M
    const spread = mix(min(float(1), float(EXPOSURE_LEN_M).div(max(len, 1e-4))), float(1), display);
    const alphaLit = aux.y.mul(lit).mul(spread);
    // a particle behind the camera, unborn or invisible is collapsed away
    const live = alphaLit
      .greaterThan(0.002)
      .and(clipH.w.greaterThan(0.05))
      .and(clipT.w.greaterThan(0.05))
      .and(opacity.greaterThan(0));
    streakMaterial.vertexNode = select(live, vec4(p.div(half).mul(w), z, w), vec4(0, 0, -2, 1));
    const vAlong = varying(along);
    const vAcross = varying(across);
    const vLen = varying(lenPx);
    const vAlpha = varying(alphaLit);
    const vZ = varying(mix(viewT.z, viewH.z, s));
    streakMaterial.fragmentNode = Fn(() => {
      If(behindEngine(vZ), () => {
        Discard();
      });
      // distance to the segment [0, len] on the streak's axis: a capsule
      const dx = max(max(vAlong.negate(), vAlong.sub(vLen)), 0);
      const dist = length(vec2(dx, vAcross));
      const core = float(1).sub(smoothstep(HALF_WIDTH_PX - 0.75, HALF_WIDTH_PX + 0.5, dist));
      const halo = float(1)
        .sub(smoothstep(HALO_PX - 0.75, HALO_PX + 0.5, dist))
        .mul(0.55)
        .mul(display);
      const toward = vAlong.div(max(vLen, 1)).clamp(0, 1);
      const k = vAlpha.mul(opacity).mul(mix(float(0.15), float(1), toward));
      // the light core over its dark halo (premultiplied): the halo's alpha where the core is not
      const aCore = core.mul(k);
      const a = aCore.add(halo.mul(k).mul(float(1).sub(core)));
      If(a.lessThan(0.002), () => {
        Discard();
      });
      // scene-linear: a pale smoke under the studio light; display: near-white on a dark halo
      const rgb = mix(vec3(0.82, 0.86, 0.92), vec3(0.97, 0.98, 1), display);
      return vec4(rgb.mul(aCore), a);
    })();
    streakMaterial.needsUpdate = true;
  };

  const scene = new Scene();
  scene.name = 'Flow Overlay';
  scene.add(planes, streaks);

  /** eps (right, up) of the pixel's ray, its centroid distance and the ray's surface distance. */
  const march = (dp: FlowPostDeps, steps: number) =>
    Fn(() => {
      const ray = viewRay(dp);
      const o3 = dp.cameraPosition;
      const d = ray.dir;
      const out = vec4(0, 0, 0, ray.tSurf).toVar();
      // the ray's span inside x in [xMin, xMax], r <= rMax (schlieren.ts rayCylinderSpan)
      const qa = d.y.mul(d.y).add(d.z.mul(d.z)).max(1e-9);
      const qb = o3.y.mul(d.y).add(o3.z.mul(d.z)).mul(2);
      const qc = o3.y
        .mul(o3.y)
        .add(o3.z.mul(o3.z))
        .sub(e.rMax * e.rMax);
      const disc = qb.mul(qb).sub(qa.mul(qc).mul(4));
      const sq = sqrt(max(disc, 0));
      const dxSafe = select(abs(d.x).lessThan(1e-6), float(1e-6), d.x);
      const ax = float(e.xMin).sub(o3.x).div(dxSafe);
      const bx = float(e.xMax).sub(o3.x).div(dxSafe);
      const t0 = max(max(min(ax, bx), qb.negate().sub(sq).div(qa.mul(2))), 0);
      const t1 = min(min(max(ax, bx), qb.negate().add(sq).div(qa.mul(2))), ray.tSurf);
      If(disc.greaterThan(0).and(t1.greaterThan(t0)), () => {
        const ds = t1.sub(t0).div(steps);
        // a fixed per-pixel offset (no frame term: a flickering march would be a synthetic shimmer)
        const jitter = interleavedGradientNoise(screenCoordinate.xy);
        const eps = vec2(0).toVar();
        const w = float(0).toVar();
        const wt = float(0).toVar();
        const kds = float(K_GD).mul(rhoInf).mul(ds);
        Loop(steps, ({ i }) => {
          const t = t0.add(float(i).add(jitter).mul(ds));
          const p = o3.add(d.mul(t));
          const r = length(p.yz);
          const g = gradientNode.sample(
            vec2(p.x.sub(e.xMin).div(e.xMax - e.xMin), r.sub(e.rMin).div(e.rMax - e.rMin)),
          );
          const invR = float(1).div(max(r, 1e-4));
          const grad = vec3(g.x, g.y.mul(p.y).mul(invR), g.y.mul(p.z).mul(invR));
          const de = vec2(dot(grad, ray.right), dot(grad, ray.up)).mul(kds);
          eps.addAssign(de);
          const m = length(de);
          w.addAssign(m);
          wt.addAssign(m.mul(t));
        });
        out.assign(vec4(eps, wt.div(max(w, 1e-20)), ray.tSurf));
      });
      return out;
    })();

  return {
    scene,
    bindField(b) {
      const prev = ext;
      ext = {
        state: linear(new ExternalTexture(b.near.state)),
        velocity: linear(new ExternalTexture(b.near.velocity)),
      };
      stateNode.value = ext.state;
      velocityNode.value = ext.velocity;
      rhoInf.value = b.reference.rhoInfKgPerM3;
      prev?.state.dispose();
      prev?.velocity.dispose();
    },
    setMode(m, q = null) {
      mode = m;
      const id = m === null ? null : (q ?? m.quantity);
      quantity = m?.cutPlane === true ? id : null;
      if (quantity !== null && quantity !== built && deps !== null) buildPlane(quantity);
      opacity.value = m?.particleOpacity ?? 0;
      display.value = m?.composite === 'display' ? 1 : 0;
      hazeGain.value = hazeOff ? 0 : (m?.haze ?? 0);
      sheet.on.value = m?.cutPlane === true ? 1 : 0;
      applyCrop();
      showStreaks();
    },
    setFullDomain(full) {
      fullDomain = full;
      applyCrop();
    },
    setHazeOff(off) {
      hazeOff = off;
      hazeGain.value = off ? 0 : (mode?.haze ?? 0);
    },
    setParticlesHidden(h) {
      particlesHidden = h;
      showStreaks();
    },
    setTracers(on) {
      tracers = on;
      showStreaks();
    },
    setDilation(d) {
      dilation.value = d;
    },
    update(center, halfW, open, view) {
      planes.visible = open && quantity !== null && mode?.cutPlane === true;
      // the face at center - half shows its front; the plane's +y is the radius
      faces[0].rotation.x = center - halfW;
      faces[1].rotation.x = center + halfW;
      // the plane's +y at rotation a is the radius at theta = a (rotation about +x)
      sheet.faceA.value = center - halfW;
      sheet.faceB.value = center + halfW;
      tanFovY2.value = view.tanFovY2;
      aspect.value = view.aspect;
    },
    hazeNode(dp) {
      return Fn(() => {
        const m = march(dp, HAZE_STEPS);
        // hazeShiftPx, in the full frame's uv (y down): eps (t_bg - t_gas) / t_bg over the
        // frame's angular size. W2V-I3: not px over screenSize, which in this half-resolution
        // target is half the frame's, so round 2's shift was twice the physical one
        const k = max(m.w.sub(m.z), 0).div(max(m.w, 1e-3)).div(tanFovY2).mul(hazeGain);
        return vec4(m.x.mul(k).div(aspect), m.y.mul(k).negate(), 0, 1);
      })();
    },
    schlierenNode(dp) {
      return Fn(() => {
        const m = march(dp, SCHLIEREN_STEPS);
        return vec4(m.y, m.x, 0, 1);
      })();
    },
    attach(dp) {
      deps = dp;
      buildStreaks();
      if (quantity !== null) buildPlane(quantity);
    },
    dispose() {
      planeGeo.dispose();
      planeMaterial.dispose();
      streakGeo.dispose();
      streakMaterial.dispose();
      gammaR.dispose();
      blank.dispose();
      gradientTex.dispose();
      ext?.state.dispose();
      ext?.velocity.dispose();
      for (const t of luts.values()) t.dispose();
    },
  };
}
