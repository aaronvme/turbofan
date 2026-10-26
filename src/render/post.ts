// The look-dev render pipeline (three r186 RenderPipeline, TSL), worker-safe:
//
//   main pass "Opaque" (colour, normal, velocity) -> GTAO (half res)
//   rotor pass "Rotors" (colour + alpha, per-pixel blur angle)
//   -> "Composite" (AO applied, analytic rotational blur of the rotors over the scene)
//   -> TRAA -> [depth of field, cinematic presets only] -> vignette + bloom
//   -> AgX tone mapping + sRGB (outputColorTransform)
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
//   side and left a comb at the hub). tests/browser/fanBlur.test.ts holds it to the mean of
//   64 stills.
// - Other rotors (cutaway rows, the spinner) use the pixel's own rotor depth: exact for
//   surfaces of revolution, and the rows are thin. Their samples are jittered per pixel and
//   frame and TRAA averages the noise out; the angle is capped at one blade pitch (the image
//   is periodic in it).
// This is what a film camera records, not the strobed wagon wheel point sampling gives.

import {
  HalfFloatType,
  RenderPipeline,
  type Node,
  type PerspectiveCamera,
  type Scene,
  type UniformNode,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  cos,
  float,
  Fn,
  frameId,
  If,
  interleavedGradientNoise,
  length,
  Loop,
  mix,
  mrt,
  normalView,
  output,
  pass,
  rtt,
  screenCoordinate,
  screenUV,
  select,
  sin,
  smoothstep,
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

export type PostDebug = 'rotorAlpha' | 'rotorBlur' | 'ao' | 'visible' | null;

export interface PostSettings {
  /** Debug output instead of the final image (look-dev only). */
  readonly debug?: PostDebug;
  /** Time samples per pixel for the rotors other than the fan (own-surface blur). */
  readonly rotorSamples: number;
  readonly aoStrength: number;
  readonly bloomStrength: number;
  /** Linear radiance above which bloom starts (above the lip's specular peak, LD-3). */
  readonly bloomThreshold: number;
}

export interface LookPipeline {
  readonly pipeline: RenderPipeline;
  readonly focusDistance: UniformNode<'float', number>;
  readonly focalLength: UniformNode<'float', number>;
  readonly bokehScale: UniformNode<'float', number>;
  /** Depth of field on (cinematic presets) or off (default: it is not drawn at all). */
  setCinematic(on: boolean): void;
  /**
   * Renders a frame. Tests and debugging: `traa` false skips TRAA (and depth of field);
   * `linear` writes half the linear radiance, with no tone map or sRGB encoding (and no DoF).
   */
  render(traa?: boolean, linear?: boolean): void;
  dispose(): void;
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
  // the targets are rgba16float, so the view normal is stored as is (GTAO samples it: it
  // needs a texture node, not an unpack expression)
  scenePass.setMRT(mrt({ output, normal: vec4(normalView, 1), velocity }));
  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const sceneNormal = scenePass.getTextureNode('normal');
  const sceneVelocity = scenePass.getTextureNode('velocity');

  const aoPass = ao(sceneDepth, sceneNormal, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.samples.value = 8;
  const aoTex = aoPass.getTextureNode();

  const rotorPass = pass(rotors, camera);
  rotorPass.name = 'Rotors';
  rotorPass.setMRT(mrt({ output, blur: vec4(0, 0, 0, 0) }));
  const rotorColor = rotorPass.getTextureNode('output');
  const rotorDepth = rotorPass.getTextureNode('depth');
  const rotorBlur = rotorPass.getTextureNode('blur');

  const aoStrength = uniform(settings.aoStrength);

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
    return vec4(lit.mul(float(1).sub(rot.a)).add(rot.rgb), 1);
  })();
  const compositeTex = rtt(composite, null, null, { type: HalfFloatType });
  compositeTex.name = 'Composite';

  const traaNode = traa(compositeTex, sceneDepth, sceneVelocity, camera);
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

  return {
    pipeline,
    focusDistance,
    focalLength,
    bokehScale,
    setCinematic: (on) => {
      cinematic = on && !settings.debug;
    },
    render: (withTraa = true, linear = false) => {
      if (!withTraa || linear) {
        debugPipeline(withTraa, linear).render();
        return;
      }
      (cinematic ? cinePipeline : pipeline).render();
    },
    dispose: () => {
      pipeline.dispose();
      cinePipeline.dispose();
      for (const p of debugPipelines.values()) p.dispose();
      compositeTex.dispose();
    },
  };
}
