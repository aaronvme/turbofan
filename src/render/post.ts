// The look-dev render pipeline (three r186 RenderPipeline, TSL), worker-safe:
//
//   main pass "Opaque" (colour, normal, velocity) -> GTAO (half res)
//   rotor pass "Rotors" (colour + alpha, per-pixel blur angle)
//   -> "Composite" (AO applied, analytic rotational blur of the rotors over the scene)
//   -> TRAA -> [depth of field, cinematic presets only] -> vignette + bloom
//   -> AgX tone mapping + sRGB (outputColorTransform)
//
// The flow visuals (w2/flowviz, src/render/flowViz.ts) join through attachFlow: their "Flow
// Overlay" pass (the cut plane and the particles, depth-tested against the scene and rotor
// depths), the heat haze's background shift and the schlieren image, each in a pipeline of its
// own (as the cinematic one: swapping output nodes left TRAA on a stale target). D4-76: the
// data modes composite after the tone map, in display space; Realistic before it, in
// scene-linear light like the engine. With the flow off, the frame is the pipeline above alone.
//
// Rotational blur: a rotor seen through an open shutter is the time average of the rotor
// image over the angle it turns, delta = omega T_open (src/geometry/motion.ts).
// - The fan (LD-1, pass-4 W1L-I3): stochastic time sampling in the rotor pass itself. The fan
//   is drawn as N time-offset copies spread over the exposure (src/render/engineScene.ts, the
//   offsets re-jittered every frame), and each pixel keeps the fragments of one copy only,
//   chosen per pixel and frame (materials.ts, fanTimeMask), depth-tested within that copy.
//   Every pixel is therefore an exact still of the fan at one instant, and TRAA's history
//   (zero velocity: the fan is not in the main pass) averages the instants: exact in the
//   limit, with no reprojection, so no disoccluded holes (the pass-4 march shredded the far
//   side and left a comb at the hub). The composite averages each pixel's 3 x 3 neighbours'
//   instants, so every frame is already a nine-sample estimate (the fan turns between frames,
//   so TRAA alone cannot average one sample per pixel). tests/browser/fanBlur.test.ts holds
//   it to the mean of 64 stills.
// - Other rotors (cutaway rows, the spinner) use the pixel's own rotor depth: exact for
//   surfaces of revolution, and the rows are thin. Their samples are jittered per pixel and
//   frame and TRAA averages the noise out; the angle is capped at one blade pitch (the image
//   is periodic in it).
// This is what a film camera records, not the strobed wagon wheel point sampling gives.

import {
  HalfFloatType,
  Matrix4,
  RenderPipeline,
  SRGBColorSpace,
  Vector2,
  Vector4,
  type RenderTarget,
  type Texture,
  type Node,
  type PerspectiveCamera,
  type Scene,
  AgXToneMapping,
  type UniformNode,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  cos,
  float,
  Fn,
  frameId,
  If,
  int,
  interleavedGradientNoise,
  length,
  Loop,
  mix,
  mrt,
  normalView,
  round,
  output,
  pass,
  renderOutput,
  rtt,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { installTraaResolve } from './traaResolve';
import { TRAA_MATRICES, checkTraaInternals } from './threeInternals';
import { createViewProjRoll } from './viewProjRoll';
import type { FlowPostDeps } from './flowViz';
import { fromHalfBits } from '../contracts/half';

/** How the flow visuals join the frame (D4-76): none, scene-linear, display space, schlieren. */
export type FlowCompositeMode = 'off' | 'scene' | 'display' | 'schlieren';

/** A flow pipeline target read back (tests): rgba per pixel, row 0 at the top. */
export interface FlowTargetPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Float32Array;
}

/** The flow targets a test can read: the overlay pass, the haze shift and the schlieren eps. */
export type FlowTargetId = 'overlay' | 'haze' | 'schlieren';

export interface FlowHooks {
  /** The "Flow Overlay" scene (premultiplied colour, its own depth). */
  readonly scene: Scene;
  /** Per pixel: the haze's background shift in uv (xy). */
  readonly haze: Node<'vec4'>;
  /** Per pixel: the schlieren's eps (up, right), rad. */
  readonly schlieren: Node<'vec4'>;
  /** The knife-edge cut-off a/f, rad (eps of +-this is white / black). */
  readonly schlierenRangeRad: UniformNode<'float', number>;
  /** The engine silhouette: hits inside x in [x0, x1], r <= r (schlieren mode). */
  readonly engineBox: { readonly x0: number; readonly x1: number; readonly r: number };
}

export type PostDebug = 'rotorAlpha' | 'rotorBlur' | 'ao' | 'visible' | 'velocity' | null;

export interface PostSettings {
  /** Debug output instead of the final image (look-dev only). */
  readonly debug?: PostDebug;
  /** Time samples per pixel for the rotors other than the fan (own-surface blur). */
  readonly rotorSamples: number;
  readonly aoStrength: number;
  readonly bloomStrength: number;
  /** Linear radiance above which bloom starts (above the lip's specular peak, LD-3). */
  readonly bloomThreshold: number;
  /**
   * The angle each spool turned since the previous frame (rad): the rotors' motion vectors
   * for TRAA (W1V-I1 fix b). Without it rotor pixels keep the main pass's (zero) velocity.
   */
  readonly rotorMotion?: {
    readonly lpStep: UniformNode<'float', number>;
    readonly hpStep: UniformNode<'float', number>;
  };
  /** three r186's own TRAA resolve (tests: the pre-W1V-I1 pipeline). */
  readonly legacyTraa?: boolean;
  /**
   * The pre-round-5 scene pass: colour, view normal and velocity targets (24 B per sample)
   * instead of colour alone (look-dev A/B of P4's cut, `?gbuffer=legacy`).
   */
  readonly legacyGbuffer?: boolean;
}

export interface LookPipeline {
  readonly pipeline: RenderPipeline;
  readonly focusDistance: UniformNode<'float', number>;
  readonly focalLength: UniformNode<'float', number>;
  readonly bokehScale: UniformNode<'float', number>;
  /** The fan's screen rectangle in uv (u0, v0, u1, v1): the composite's fan region. */
  readonly fanRect: UniformNode<'vec4', Vector4>;
  /** Depth of field on (cinematic presets) or off (default: it is not drawn at all). */
  setCinematic(on: boolean): void;
  /** What the flow visuals read from this pipeline (src/render/flowViz.ts). */
  readonly flowDeps: FlowPostDeps;
  /** Builds the flow pipelines on the flow visuals' scene and nodes. */
  attachFlow(hooks: FlowHooks): void;
  /** Which flow pipeline renders (D4-76); 'off' is the plain pipeline. */
  setFlowComposite(mode: FlowCompositeMode): void;
  /**
   * W2V-I5's negative control: true draws the flow layers with TRAA's per-frame jitter (as
   * round 2 did), false (the default) with the unjittered camera.
   */
  setFlowJitter(on: boolean): void;
  /** The last frame's flow target, decoded (tests: W2V-I3 and W2V-I5). */
  readFlowTarget(id: FlowTargetId): Promise<FlowTargetPixels>;
  /**
   * The resolution of the 3D passes, the composite and TRAA relative to the drawing buffer
   * (D3-7, the performance profile); the output pass upsamples TRAA's result.
   */
  setRenderScale(scale: number): void;
  /**
   * Renders a frame. Tests and debugging: `traa` false skips TRAA (and depth of field);
   * `linear` writes half the linear radiance, with no tone map or sRGB encoding (and no DoF).
   * `warm` (D4-91, a warm frame the caller's real frame overwrites): TRAA's history and the
   * rotor motion's previous view-projection are left as they were.
   */
  render(traa?: boolean, linear?: boolean, warm?: boolean): void;
  dispose(): void;
}

/** The TRAANode internals the render-scale fix touches (three r186, not in @types/three). */
interface TraaInternals {
  updateBefore(frame: { renderer: WebGPURenderer }): void;
  _historyRenderTarget: RenderTarget & { depthTexture: Texture };
  readonly _previousDepthNode: { value: Texture };
  _jitterIndex: number;
}

export function createPipeline(
  renderer: WebGPURenderer,
  main: Scene,
  rotors: Scene,
  camera: PerspectiveCamera,
  settings: PostSettings,
): LookPipeline {
  const pipeline = new RenderPipeline(renderer);

  const scenePass = pass(main, camera);
  scenePass.name = 'Opaque';
  // P4 (round 5): the scene pass writes its colour and depth only. Its view normal and
  // velocity targets were two more rgba16float writes per sample (24 B instead of 8) over a
  // fragment-heavy pass, for data the depth already holds: GTAO reconstructs the normal from
  // the depth (three's GTAONode without a normal node), and TRAA's velocity is the camera's
  // reprojection of the depth's world point (below; the main pass is static but for the
  // exploded and cutaway transitions, which TRAA's variance clip handles as it did a moving
  // camera before W1V-I1)
  const motion = settings.rotorMotion;
  const lean =
    settings.legacyGbuffer !== true && settings.legacyTraa !== true && motion !== undefined;
  scenePass.setMRT(lean ? mrt({ output }) : mrt({ output, normal: vec4(normalView, 1), velocity }));
  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const sceneNormal = lean ? null : scenePass.getTextureNode('normal');
  // lean: a stand-in texture node whose per-texel load (what TRAA reads) is replaced below
  const sceneVelocity = lean ? texture(sceneDepth.value) : scenePass.getTextureNode('velocity');

  // three types the normal as required; its GTAONode reconstructs it from the depth when null
  const aoPass = ao(sceneDepth, sceneNormal as unknown as Node, camera);
  aoPass.resolutionScale = 0.5;
  // 8 fixed samples: 6 with the noise rotated every frame (TRAA averaging it) put a 0.11 tile
  // into the hero's fan-blur check (0.03 with these), so GTAO was not cut (LOD round 2)
  aoPass.samples.value = 8;
  const aoTex = aoPass.getTextureNode();

  const rotorPass = pass(rotors, camera);
  rotorPass.name = 'Rotors';
  rotorPass.setMRT(mrt({ output, blur: vec4(0, 0, 0, 0) }));
  const rotorColor = rotorPass.getTextureNode('output');
  const rotorDepth = rotorPass.getTextureNode('depth');
  const rotorBlur = rotorPass.getTextureNode('blur');

  const aoStrength = uniform(settings.aoStrength);
  // the fan's screen rectangle (u0, v0, u1, v1); the whole screen until the view sets it
  const fanRect = uniform(new Vector4(0, 0, 1, 1));

  // the post quad renders with its own camera, so the scene camera comes in as uniforms
  // (by reference: TRAA's per-frame jitter of the projection is included)
  const camProj = uniform(camera.projectionMatrix);
  const camProjInv = uniform(camera.projectionMatrixInverse);
  const camView = uniform(camera.matrixWorldInverse);
  const camWorld = uniform(camera.matrixWorld);
  const cameraPosition = uniform(camera.position);
  const near = camera.near;
  const far = camera.far;
  // WebGPU depth in [0, 1] to view-space z (negative in front of the camera)
  const viewZOf = (d: Node<'float'>): Node<'float'> =>
    float(near * far).div(
      float(far - near)
        .mul(d)
        .sub(far),
    );
  const rotX = (p: Node<'vec3'>, c: Node<'float'>, s: Node<'float'>): Node<'vec3'> =>
    vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));
  const toUv = (q: Node<'vec3'>): Node<'vec2'> => {
    const clip = camProj.mul(camView).mul(vec4(q, 1));
    const n = clip.xy.div(clip.w);
    return vec2(n.x.mul(0.5).add(0.5), float(0.5).sub(n.y.mul(0.5)));
  };

  const composite = Fn(() => {
    const suv = screenUV;
    const base = sceneColor.sample(suv);
    const rc = rotorColor.sample(suv);
    const covered = rc.a.greaterThan(0.001);
    const zRotor = viewZOf(rotorDepth.sample(suv).r);
    const sDepth = sceneDepth.sample(suv).r;
    const zScene = select(sDepth.lessThan(1), viewZOf(sDepth), float(-1e9));
    // ambient occlusion on the engine and the floor near it (not the far cyclorama)
    const occl = select(
      zScene.greaterThan(-30),
      mix(float(1), aoTex.sample(suv).r, aoStrength),
      float(1),
    );
    const lit = base.rgb.mul(occl);

    // the view ray through this pixel: P(z) = camera + dirW z / dirV.z
    const ndc = vec2(suv.x.mul(2).sub(1), float(1).sub(suv.y.mul(2)));
    const hv = camProjInv.mul(vec4(ndc, 0.5, 1));
    const dirV = hv.xyz.div(hv.w);
    const dirW = camWorld.mul(vec4(dirV, 0)).xyz;
    const pRotor = cameraPosition.add(dirW.mul(zRotor.div(dirV.z)));
    const jitter = interleavedGradientNoise(
      screenCoordinate.add(vec2(float(frameId.mod(64)).mul(5.588), 0)),
    );

    // the fan is already time-sampled in the rotor pass (see the header): its pixels pass
    // through; other rotors blur along their own surface point, turned through the spool's
    // shutter angle
    const blurMrt = rotorBlur.sample(suv);
    const isFan = covered.and(blurMrt.b.greaterThan(0.5));
    const acc = vec4(rc.rgb.mul(rc.a), rc.a).toVar();
    const angle = select(covered, blurMrt.r, float(0)).min(blurMrt.g).toVar();
    const visibleRotor = covered.and(zRotor.greaterThan(zScene));
    If(isFan.not().and(visibleRotor).and(angle.greaterThan(1e-4)), () => {
      acc.assign(vec4(0));
      const n = settings.rotorSamples;
      Loop(n, ({ i }) => {
        const t = float(i).add(jitter).div(n).sub(0.5).mul(angle);
        const quv = toUv(rotX(pRotor, cos(t), sin(t)));
        const smp = rotorColor.sample(quv).toVar();
        // a turned point that lands on a fan blade (a booster blade seen through the fan
        // gaps) keeps its own colour: the fan's fragment is not this rotor's surface
        If(rotorBlur.sample(quv).b.greaterThan(0.5), () => {
          smp.assign(rc);
        });
        acc.addAssign(vec4(smp.rgb.mul(smp.a), smp.a));
      });
      acc.divAssign(n);
    });
    const rot = select(visibleRotor, acc, vec4(0));
    if (settings.debug === 'visible')
      return vec4(
        select(isFan, float(1), float(0)),
        angle.div(Math.PI),
        select(visibleRotor, float(1), float(0)),
        1,
      );
    const own = lit.mul(float(1).sub(rot.a)).add(rot.rgb);

    // The fan's time samples: every pixel holds one instant (one fan copy), so one frame is
    // binary noise, and TRAA cannot average a fan that turns between frames. The 3 x 3
    // neighbourhood holds about all eight copies (interleaved gradient noise), so the pixel
    // takes the mean of its neighbours' instants: a neighbour's fan fragment where it lies in
    // front of what this pixel shows behind the fan, else this pixel's own view past the fan.
    // A pixel whose front surface is ahead of every neighbouring fan fragment (the spinner,
    // the lip) keeps its own colour. One pixel of spatial blur on the fan, none on the rest.
    // Only inside the fan's screen rectangle (the view sets it each frame from the fan's box,
    // src/geometry/screenRect.ts): elsewhere no pixel or neighbour holds a fan fragment, and
    // the 45 texture reads per pixel were most of the composite's cost.
    const result = own.toVar();
    const inFan = suv.greaterThanEqual(fanRect.xy).all().and(suv.lessThanEqual(fanRect.zw).all());
    If(inFan, () => {
      const zBehind = select(covered.and(isFan.not()).and(visibleRotor), zRotor, zScene);
      const centreFan = isFan.and(visibleRotor);
      const sum = vec3(0).toVar();
      const weight = float(0).toVar();
      const fanHits = float(0).toVar();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nuv = suv.add(vec2(dx, dy).div(screenSize));
          const nc = rotorColor.sample(nuv);
          const nFan = rotorBlur.sample(nuv).b.greaterThan(0.5).and(nc.a.greaterThan(0.5));
          const nz = viewZOf(rotorDepth.sample(nuv).r);
          const valid = nFan.and(nz.greaterThan(zBehind));
          // the view past the fan: this pixel's own composite where it sees no fan; on a fan
          // pixel, the neighbour's own (a booster blade or the spinner there, else the scene)
          const nsd = sceneDepth.sample(nuv).r;
          const nzs = select(nsd.lessThan(1), viewZOf(nsd), float(-1e9));
          const nRotor = nc.a.greaterThan(0.001).and(nFan.not()).and(nz.greaterThan(nzs));
          const nPast = select(nRotor, nc.rgb, sceneColor.sample(nuv).rgb.mul(occl));
          // on a fan pixel, a neighbour whose front surface is ahead of this fan fragment (the
          // spinner's or the lip's edge) is left out, so occluding edges stay sharp
          const nFront = select(nRotor, nz, nzs);
          const occludes = centreFan.and(valid.not()).and(nFront.greaterThan(zRotor.add(0.002)));
          const w = select(occludes, float(0), float(1));
          sum.addAssign(select(valid, nc.rgb, select(centreFan, nPast, own)).mul(w));
          weight.addAssign(w);
          fanHits.addAssign(select(valid, float(1), float(0)));
        }
      result.assign(select(fanHits.greaterThan(0), sum.div(weight.max(1)), own));
    });
    return vec4(result, 1);
  })();
  const compositeTex = rtt(composite, null, null, { type: HalfFloatType });
  compositeTex.name = 'Composite';

  // Rotor motion vectors (W1V-I1 fix b, D4-4: the cutaway shows a running engine). The rotors
  // are not in the main pass, so its velocity is zero on them and TRAA averaged each rotor
  // pixel with the rotor at other phases (ghosted, feathered blades). A rotor turns rigidly
  // about the engine axis (world x), so its pixel's previous position is exact: the rotor
  // depth's world point turned back by the spool's step and projected with the previous
  // frame's (unjittered) view-projection. The step is wrapped to half a blade pitch (the row's
  // image is periodic in it; the spinner's pitch is a full turn), so at idle the history comes
  // from the next blade along, a few pixels away, not from 107 degrees round the disc (where
  // TRAA's motion factor would discard it). The same holds for the fan's time-sampled blur: a
  // box-shutter exposure turned by the step is the next frame's exposure. TRAA reads the
  // velocity of one texel per pixel (`velocityNode.load`, three r186 TRAANode.js:554), so the
  // rotor velocity is computed there and costs no pass of its own.
  const prevViewProj = uniform(new Matrix4());
  const currViewProj = uniform(new Matrix4());
  const currViewProjInv = uniform(new Matrix4());
  const viewProjs = createViewProjRoll(
    prevViewProj.value,
    currViewProj.value,
    currViewProjInv.value,
  );
  const frameViewProj = new Matrix4();
  if (motion !== undefined) {
    const velocityNode = sceneVelocity as unknown as {
      load(texel: Node<'vec2'>): Node<'vec4'>;
    };
    const baseLoad = velocityNode.load.bind(velocityNode);
    // the camera's motion at a static scene texel: its depth's world point (unprojected with
    // the unjittered view-projection, so a still camera gives exactly zero, as three's
    // velocity does) projected with the previous frame's
    const cameraLoad = (texel: Node<'vec2'>): Node<'vec4'> => {
      const size = vec2(sceneDepth.size(int(0)) as unknown as Node<'ivec2'>);
      const uvT = texel.floor().add(0.5).div(size);
      const ndc = vec2(uvT.x.mul(2).sub(1), float(1).sub(uvT.y.mul(2)));
      const w = currViewProjInv.mul(vec4(ndc, sceneDepth.load(texel).r, 1));
      const q = prevViewProj.mul(vec4(w.xyz.div(w.w), 1));
      return vec4(ndc.sub(q.xy.div(q.w)), 0, 0);
    };
    velocityNode.load = (texel) =>
      Fn(() => {
        const sceneVel = lean ? cameraLoad(texel) : baseLoad(texel);
        const rd = rotorDepth.load(texel).r;
        const sd = sceneDepth.load(texel).r;
        const isRotor = rotorColor.load(texel).a.greaterThan(0.001).and(rd.lessThan(sd));
        const b = rotorBlur.load(texel);
        const size = vec2(rotorDepth.size(int(0)) as unknown as Node<'ivec2'>);
        const uvT = texel.floor().add(0.5).div(size);
        const ndc = vec4(uvT.x.mul(2).sub(1), float(1).sub(uvT.y.mul(2)), rd, 1);
        const hv = camProjInv.mul(ndc);
        const p = camWorld.mul(vec4(hv.xyz.div(hv.w), 1)).xyz;
        const step = select(b.a.greaterThan(1.5), motion.hpStep, motion.lpStep);
        const pitch = b.g.max(1e-4);
        const back = step.sub(pitch.mul(round(step.div(pitch)))).negate();
        const prev = rotX(p, cos(back), sin(back));
        const c = currViewProj.mul(vec4(p, 1));
        const q = prevViewProj.mul(vec4(prev, 1));
        const vel = c.xy.div(c.w).sub(q.xy.div(q.w));
        return select(isRotor, vec4(vel, 0, 0), sceneVel);
      })();
  }

  // TRAA's current depth: the nearer of the scene and the rotors. Its closest-depth search
  // picks the texel whose velocity it uses, and its disocclusion test compares that depth with
  // the history's: with the scene depth alone, a rotor pixel was judged by whatever lies behind
  // it, which changes under the rotor's reprojection, so its history was mostly thrown away
  // (and the jittered frame shown as is). The history copy (`.value`) stays the scene depth.
  const traaDepth = texture(sceneDepth.value);
  if (motion !== undefined) {
    const d = traaDepth as unknown as { load(texel: Node<'vec2'>): Node<'vec4'> };
    const baseDepthLoad = d.load.bind(d);
    d.load = (texel) => vec4(baseDepthLoad(texel).r.min(rotorDepth.load(texel).r));
  }
  const traaNode = traa(compositeTex, traaDepth, sceneVelocity, camera);
  if (settings.legacyTraa !== true) installTraaResolve(traaNode);
  // three r186's TRAANode copies the scene depth into its history (its disocclusion test) only
  // when the history matches the drawing buffer. Below render scale 1 (the performance
  // profile, D3-7) it never would, so every pixel read as disoccluded and TRAA stopped
  // accumulating: the copy is made here instead whenever three skipped it.
  const traaState = traaNode as unknown as TraaInternals;
  // W1V-N3: the patch below reaches into three's TRAA internals; a renamed field would make it
  // create a new property and leave TRAA's disocclusion test on a stale depth, silently (pinned
  // by tests/unit/render/threeInternals.test.ts; this throw is the second line of defence)
  checkTraaInternals(traaState);
  const traaUpdate = traaState.updateBefore.bind(traaNode);
  const drawing = new Vector2();
  // D4-91: a warm frame resolves into a throwaway history, then puts TRAA's state back, so the
  // real frame after it blends with the last real frame, not the warm configuration
  let warming = false;
  let warmHistory: (RenderTarget & { depthTexture: Texture }) | null = null;
  const traaUniforms = traaState as unknown as Record<
    (typeof TRAA_MATRICES)[number],
    { value: { clone(): unknown; copy(v: unknown): unknown } }
  >;
  const warmUpdate = (frame: { renderer: WebGPURenderer }) => {
    const history = traaState._historyRenderTarget;
    const previousDepth = traaState._previousDepthNode.value;
    const jitter = traaState._jitterIndex;
    const mats = TRAA_MATRICES.map((k) => traaUniforms[k].value.clone());
    warmHistory ??= history.clone();
    traaState._historyRenderTarget = warmHistory;
    try {
      traaUpdate(frame);
    } finally {
      traaState._historyRenderTarget = history;
      traaState._previousDepthNode.value = previousDepth;
      traaState._jitterIndex = jitter;
      TRAA_MATRICES.forEach((k, i) => traaUniforms[k].value.copy(mats[i]));
    }
  };
  traaState.updateBefore = (frame) => {
    if (warming) {
      warmUpdate(frame);
      return;
    }
    traaUpdate(frame);
    const h = traaState._historyRenderTarget;
    const d = sceneDepth.value;
    frame.renderer.getDrawingBufferSize(drawing);
    if (
      (h.width !== drawing.x || h.height !== drawing.y) &&
      scenePass.renderTarget.width === h.width &&
      scenePass.renderTarget.height === h.height
    ) {
      frame.renderer.copyTextureToTexture(d, h.depthTexture);
      traaState._previousDepthNode.value = h.depthTexture;
    }
  };
  const focusDistance = uniform(4);
  const focalLength = uniform(2.5);
  const bokehScale = uniform(1.2);
  // TRAA's own output texture: passing the node itself made dof copy it through an RTT
  // (three r186 has TRAANode.getTextureNode(); @types/three 0.186 does not declare it)
  const traaTex = (traaNode as unknown as { getTextureNode(): Node<'vec4'> }).getTextureNode();
  const dofNode = dof(traaTex, scenePass.getViewZNode(), focusDistance, focalLength, bokehScale);
  const bloomNode = bloom(traaTex, settings.bloomStrength, 0.5, settings.bloomThreshold);
  // a gentle lens vignette, in linear light before the tone map
  const vignette = Fn(([c]: [Node<'vec4'>]) => {
    const d = length(screenUV.sub(0.5).mul(vec2(1.25, 1)));
    const v = mix(float(1), float(0.72), smoothstep(0.3, 0.85, d));
    return vec4(c.rgb.mul(v), 1);
  });
  const graded = (c: Node<'vec4'>): Node<'vec4'> => vignette(c).add(bloomNode);
  // two pipelines over the same nodes instead of swapping one output node: a rebuilt
  // pipeline left TRAA sampling a stale-size target (the frame tiled). Bloom is part of the
  // cinematic look only: above the lip's specular peak it barely shows, and it costs ~0.5 ms
  pipeline.outputNode = vignette(traaNode);
  const cinePipeline = new RenderPipeline(renderer);
  cinePipeline.outputNode = graded(dofNode as unknown as Node<'vec4'>);
  if (settings.debug === 'rotorAlpha') pipeline.outputNode = vec4(vec3(rotorColor.a), 1);
  if (settings.debug === 'rotorBlur')
    pipeline.outputNode = vec4(rotorBlur.r.div(Math.PI), rotorColor.a, 0, 1);
  if (settings.debug === 'ao') pipeline.outputNode = vec4(vec3(aoTex.r), 1);
  // what TRAA reprojects with (rotor motion included), linear (no tone map or sRGB, so a test
  // reads it back exactly, tests/browser/rotorMotion.test.ts): red and green 0.5 + the
  // velocity in pixels (NDC, y up) / 64, blue 1 on a visible rotor pixel
  if (settings.debug === 'velocity') {
    const t = screenCoordinate;
    const onRotor = rotorColor
      .load(t)
      .a.greaterThan(0.001)
      .and(rotorDepth.load(t).r.lessThan(sceneDepth.load(t).r));
    pipeline.outputNode = vec4(
      (sceneVelocity as unknown as { load(t: Node<'vec2'>): Node<'vec4'> })
        .load(t)
        .xy.mul(screenSize)
        .mul(0.5 / 64)
        .add(0.5),
      select(onRotor, float(1), float(0)),
      1,
    );
    pipeline.outputColorTransform = false;
  }
  // the chain without TRAA (built on first use): the fan-blur reference test averages
  // un-accumulated frames (tests/browser/fanBlur.test.ts)
  const debugPipelines = new Map<string, RenderPipeline>();
  const debugPipeline = (withTraa: boolean, linear: boolean): RenderPipeline => {
    const key = `${String(withTraa)}:${String(linear)}`;
    let p = debugPipelines.get(key);
    if (p === undefined) {
      p = new RenderPipeline(renderer);
      const c = vignette(withTraa ? traaNode : compositeTex);
      p.outputNode = linear ? vec4(c.rgb.mul(0.5), 1) : c;
      p.outputColorTransform = !linear;
      debugPipelines.set(key, p);
    }
    return p;
  };
  let cinematic = false;
  let renderScale = 1;

  // W2V-I5: TRAA does not accumulate the flow layers (D4-76: the data colours composite after
  // it), so they must not carry its jitter either, or the contours, edges and streaks crawl by up
  // to half a pixel against the resolved engine. They render with their own camera: a copy of
  // the scene camera taken before the pipeline jitters it. (The depth test against the jittered
  // scene depth moves only the occlusion edges, by that half pixel.)
  const flowCamera = camera.clone();
  let flowJitter = false;
  const flowDeps: FlowPostDeps = {
    sceneDepth: sceneDepth,
    rotorDepth: rotorDepth,
    viewZOf,
    camProjInv: uniform(flowCamera.projectionMatrixInverse),
    camWorld: uniform(flowCamera.matrixWorld),
    cameraPosition: uniform(flowCamera.position),
  };
  let flowComposite: FlowCompositeMode = 'off';
  let flow: {
    pass: ReturnType<typeof pass>;
    haze: ReturnType<typeof rtt>;
    schlieren: ReturnType<typeof rtt>;
    pipelines: Record<Exclude<FlowCompositeMode, 'off'>, RenderPipeline>;
  } | null = null;
  const attachFlow = (h: FlowHooks) => {
    if (flow !== null) throw new Error('post: attachFlow twice');
    const flowPass = pass(h.scene, flowCamera);
    flowPass.name = 'Flow Overlay';
    const ov = flowPass.getTextureNode('output');
    const hazeTex = rtt(h.haze, null, null, { type: HalfFloatType });
    hazeTex.name = 'Flow Haze';
    const schTex = rtt(h.schlieren, null, null, { type: HalfFloatType });
    schTex.name = 'Flow Schlieren';
    // the engine passes first: the beauty (TRAA's chain) is the first operand everywhere, so
    // the scene pass has rendered before the flow nodes read its depth
    const over = (base: Node<'vec4'>): Node<'vec4'> =>
      vec4(base.rgb.mul(float(1).sub(ov.a)).add(ov.rgb), 1);
    // Realistic: the haze shifts what TRAA resolved, the overlay joins in linear light
    const scenePipe = new RenderPipeline(renderer);
    const traaSampler = traaTex as unknown as { sample(uv: Node<'vec2'>): Node<'vec4'> };
    const beautyHazed = traaSampler.sample(screenUV.add(hazeTex.sample(screenUV).xy));
    scenePipe.outputNode = vignette(over(beautyHazed));
    // D4-76: the data colours after the tone map, in display space
    const display = () =>
      renderOutput(vignette(traaNode), AgXToneMapping, SRGBColorSpace) as unknown as Node<'vec4'>;
    const displayPipe = new RenderPipeline(renderer);
    displayPipe.outputNode = over(display());
    displayPipe.outputColorTransform = false;
    // schlieren: the knife-edge grey (Settles 2001, eq. 3.5), the engine a dim silhouette
    const schPipe = new RenderPipeline(renderer);
    schPipe.outputNode = Fn(() => {
      // w2/app-ui round 5 (flagged edit, D4-95 item 2): the beauty first, as a statement, as in
      // the other composites, so TRAA's chain renders the scene passes before anything below
      // reads their depth (the same image: the passes render once a frame). Reading the depth
      // first rendered the scene pass a call level up, and three keys its render contexts by the
      // call depth (GPU_FACTS M56): every engine object got a second render object, node build
      // (~15 ms each) and pipeline on Schlieren's first frame
      const dim = display().rgb.mul(0.22).toVar();
      const eps = schTex.sample(screenUV).x;
      const grey = float(0.5).add(eps.mul(0.5).div(h.schlierenRangeRad)).clamp(0, 1);
      const suv = screenUV;
      const ndc = vec2(suv.x.mul(2).sub(1), float(1).sub(suv.y.mul(2)));
      const hv = camProjInv.mul(
        vec4(ndc, sceneDepth.sample(suv).r.min(rotorDepth.sample(suv).r), 1),
      );
      const pw = camWorld.mul(vec4(hv.xyz.div(hv.w), 1)).xyz;
      const inBox = pw.x
        .greaterThan(h.engineBox.x0)
        .and(pw.x.lessThan(h.engineBox.x1))
        .and(length(pw.yz).lessThan(h.engineBox.r));
      return vec4(select(inBox, dim, vec3(grey)), 1);
    })();
    schPipe.outputColorTransform = false;
    flow = {
      pass: flowPass,
      haze: hazeTex,
      schlieren: schTex,
      pipelines: { scene: scenePipe, display: displayPipe, schlieren: schPipe },
    };
    applyFlowScale();
  };
  const applyFlowScale = () => {
    if (flow === null) return;
    flow.pass.setResolutionScale(renderScale);
    flow.haze.setResolutionScale(0.5 * renderScale);
    flow.schlieren.setResolutionScale(0.5 * renderScale);
  };

  const renderFrame = (withTraa: boolean, linear: boolean) => {
    // the rotor motion vectors' view-projections, unjittered (TRAA jitters the camera only
    // inside the pipeline's render)
    camera.updateMatrixWorld();
    viewProjs.roll(
      frameViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    if (!withTraa || linear) {
      debugPipeline(withTraa, linear).render();
      return;
    }
    const flowPipe =
      flow !== null && flowComposite !== 'off' ? flow.pipelines[flowComposite] : null;
    if (flow !== null) {
      // the camera is unjittered here: TRAA jitters it only inside the pipeline's render
      flowCamera.copy(camera, false);
      flow.pass.camera = flowJitter ? camera : flowCamera;
    }
    (cinematic ? cinePipeline : (flowPipe ?? pipeline)).render();
  };
  const disposeAll = () => {
    pipeline.dispose();
    cinePipeline.dispose();
    for (const p of debugPipelines.values()) p.dispose();
    if (flow !== null) {
      for (const p of Object.values(flow.pipelines)) p.dispose();
      flow.pass.dispose();
      flow.haze.dispose();
      flow.schlieren.dispose();
    }
    compositeTex.dispose();
  };

  return {
    pipeline,
    fanRect,
    focusDistance,
    focalLength,
    bokehScale,
    setCinematic: (on) => {
      cinematic = on && !settings.debug;
    },
    flowDeps,
    attachFlow,
    setFlowComposite: (m) => {
      flowComposite = m;
    },
    setFlowJitter: (on) => {
      flowJitter = on;
    },
    readFlowTarget: async (id) => {
      if (flow === null) throw new Error('post: readFlowTarget before attachFlow');
      const rt = (id === 'overlay' ? flow.pass : id === 'haze' ? flow.haze : flow.schlieren)
        .renderTarget;
      if (rt === null) throw new Error(`post: the flow ${id} target is not rendered yet`);
      const { width, height } = rt;
      const raw = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)) as
        Uint16Array | Float32Array;
      // WebGPU copies rows padded to 256 bytes
      const half = raw instanceof Uint16Array;
      const bpt = half ? 8 : 16;
      const stride = (Math.ceil((width * bpt) / 256) * 256) / (bpt / 4);
      const rgba = new Float32Array(4 * width * height);
      for (let y = 0; y < height; y++)
        for (let k = 0; k < 4 * width; k++) {
          const v = raw[y * stride + k] ?? Number.NaN;
          rgba[4 * width * y + k] = half ? fromHalfBits(v) : v;
        }
      return { width, height, rgba };
    },
    setRenderScale: (scale) => {
      if (scale === renderScale) return;
      renderScale = scale;
      scenePass.setResolutionScale(scale);
      rotorPass.setResolutionScale(scale);
      compositeTex.setResolutionScale(scale);
      // TRAA reads its beauty's size before the composite's own resize in the same frame,
      // and three then copied the resized scene depth into the old-size history (a WebGPU
      // copy error): resize the composite target now
      renderer.getDrawingBufferSize(drawing);
      compositeTex.renderTarget?.setSize(
        Math.floor(drawing.x * scale),
        Math.floor(drawing.y * scale),
      );
      aoPass.resolutionScale = 0.5 * scale;
      applyFlowScale();
    },
    render: (withTraa = true, linear = false, warm = false) => {
      const restore = warm ? viewProjs.save() : null;
      warming = warm;
      try {
        renderFrame(withTraa, linear);
      } finally {
        warming = false;
        restore?.();
      }
    },
    dispose: () => {
      warmHistory?.dispose();
      disposeAll();
    },
  };
}
