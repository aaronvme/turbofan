// The look-dev render pipeline (three r186 RenderPipeline, TSL), worker-safe:
//
//   main pass (colour, normal, velocity) -> GTAO (half res) applied to the colour
//   rotor pass (colour + alpha, per-pixel blur angle)  -> analytic rotational blur, composited
//   -> TRAA -> depth of field -> + bloom -> AgX tone mapping + sRGB (outputColorTransform)
//
// Rotational blur: a rotor seen through an open shutter is the time average of the rotor
// image over the angle it turns, delta = omega T_open (src/geometry/motion.ts). For a rigid
// rotation about the engine axis the colour at a fixed world point P is the rotor's colour at
// R(-omega t) P, so the blurred rotor at a pixel is the mean of the rotor pass sampled at the
// projections of P rotated through [-delta/2, delta/2]. P is the rotor surface at the pixel
// (rotor depth) where a blade is, or the fan face disc where the pixel sees between blades;
// the samples are jittered per pixel and frame, and TRAA averages the noise out. This is what
// a film camera records, not the strobed wagon wheel that point sampling gives.

import {
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
  packNormalToRGB,
  pass,
  screenCoordinate,
  screenUV,
  select,
  sin,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { LookUniforms } from './materials';

export interface FanDisc {
  /** x of the fan face disc used between blades, m. */
  readonly x: number;
  readonly rHub: number;
  readonly rTip: number;
  /** Blade pitch, rad (2 pi / count). */
  readonly pitch: number;
  /** Axial limits of the fan rotor, m: rotor pixels outside belong to the spinner or other rows. */
  readonly xFore: number;
  readonly xAft: number;
}

export interface PostSettings {
  /** Debug output instead of the final image (look-dev only). */
  readonly debug?: 'rotorAlpha' | 'rotorBlur' | 'ao' | 'visible' | null;
  readonly blurSamples: number;
  readonly aoStrength: number;
  readonly bloomStrength: number;
}

export interface LookPipeline {
  readonly pipeline: RenderPipeline;
  readonly focusDistance: UniformNode<'float', number>;
  readonly focalLength: UniformNode<'float', number>;
  readonly bokehScale: UniformNode<'float', number>;
  render(): void;
  dispose(): void;
}

export function createPipeline(
  renderer: WebGPURenderer,
  main: Scene,
  rotors: Scene,
  camera: PerspectiveCamera,
  u: LookUniforms,
  fan: FanDisc,
  settings: PostSettings,
): LookPipeline {
  const pipeline = new RenderPipeline(renderer);

  const scenePass = pass(main, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const sceneNormal = unpackRGBToNormal(scenePass.getTextureNode('normal'));
  const sceneVelocity = scenePass.getTextureNode('velocity');

  const aoPass = ao(sceneDepth, sceneNormal, camera);
  aoPass.resolutionScale = 0.5;
  const aoTex = aoPass.getTextureNode();

  const rotorPass = pass(rotors, camera);
  rotorPass.setMRT(mrt({ output, blur: vec4(0, 0, 0, 0) }));
  const rotorColor = rotorPass.getTextureNode('output');
  const rotorDepth = rotorPass.getTextureNode('depth');
  const rotorBlur = rotorPass.getTextureNode('blur');

  const samples = settings.blurSamples;
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

  const composite = Fn(() => {
    const suv = screenUV;
    const base = sceneColor.sample(suv);

    const rc = rotorColor.sample(suv);
    const covered = rc.a.greaterThan(0.001);
    const zRotor = viewZOf(rotorDepth.sample(suv).r);
    const sDepth = sceneDepth.sample(suv).r;
    const zScene = select(sDepth.lessThan(1), viewZOf(sDepth), float(-1e9));
    // ambient occlusion on the engine only (not on the distant backdrop)
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
    const at = (z: Node<'float'>) => cameraPosition.add(dirW.mul(z.div(dirV.z)));

    // where the pixel looks between blades: the fan face disc
    const tDisc = float(fan.x).sub(cameraPosition.x).div(dirW.x);
    const pDisc = cameraPosition.add(dirW.mul(tDisc));
    const zDisc = dirV.z.mul(tDisc);
    const rDisc = length(pDisc.yz);
    const onDisc = tDisc
      .greaterThan(0)
      .and(rDisc.greaterThan(fan.rHub))
      .and(rDisc.lessThan(fan.rTip));
    // inside the fan annulus every pixel uses the fan face disc (blade or gap alike), so the
    // blur is continuous across blade edges; other rotors (cutaway) use their own depth
    const pRotor = at(zRotor);
    const useDisc = onDisc.and(
      covered.not().or(pRotor.x.greaterThan(fan.xFore).and(pRotor.x.lessThan(fan.xAft))),
    );
    const p = select(useDisc, pDisc, pRotor).toVar();
    // A rotor of N blades is periodic in 2 pi / N, and the mean over an angle longer than
    // one pitch is (to within one pitch / angle) the mean over one pitch: sample at most one
    // pitch, so a fast fan converges to its smooth disc instead of a noisy smear
    const blurMrt = rotorBlur.sample(suv);
    const pitch = select(useDisc, float(fan.pitch), blurMrt.g);
    const angle = select(useDisc, u.lpBlur, select(covered, blurMrt.r, float(0)))
      .min(pitch)
      .toVar();
    // in front of the static scene (view z closer to 0)?
    const zFront = select(useDisc, zDisc, zRotor);
    const visible = covered.or(onDisc).and(zFront.greaterThan(zScene));

    const acc = vec4(rc.rgb.mul(rc.a), rc.a).toVar();
    If(visible.and(angle.greaterThan(1e-4)), () => {
      acc.assign(vec4(0));
      const jitter = interleavedGradientNoise(
        screenCoordinate.add(vec2(float(frameId.mod(64)).mul(5.588), 0)),
      );
      Loop(samples, ({ i }) => {
        const t = float(i).add(jitter).div(samples).sub(0.5).mul(angle);
        const c = cos(t);
        const s = sin(t);
        const q = vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));
        const clip = camProj.mul(camView).mul(vec4(q, 1));
        const ndc = clip.xy.div(clip.w);
        const quv = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const smp = rotorColor.sample(quv);
        acc.addAssign(vec4(smp.rgb.mul(smp.a), smp.a));
      });
      acc.divAssign(samples);
    });
    const rot = select(visible, acc, vec4(0));
    if (settings.debug === 'visible')
      return vec4(
        select(visible, float(1), float(0)),
        angle.div(Math.PI),
        select(covered, float(1), float(0)),
        1,
      );
    return vec4(lit.mul(float(1).sub(rot.a)).add(rot.rgb), 1);
  })();

  const traaNode = traa(composite, sceneDepth, sceneVelocity, camera);
  const focusDistance = uniform(4);
  const focalLength = uniform(2.5);
  const bokehScale = uniform(1.2);
  const dofNode = dof(traaNode, scenePass.getViewZNode(), focusDistance, focalLength, bokehScale);
  const bloomNode = bloom(traaNode, settings.bloomStrength, 0.45, 0.9);
  pipeline.outputNode = (dofNode as unknown as Node<'vec4'>).add(bloomNode);
  if (settings.debug === 'rotorAlpha') pipeline.outputNode = vec4(vec3(rotorColor.a), 1);
  if (settings.debug === 'rotorBlur')
    pipeline.outputNode = vec4(rotorBlur.r.div(Math.PI), rotorColor.a, 0, 1);
  if (settings.debug === 'ao') pipeline.outputNode = vec4(vec3(aoTex.r), 1);

  return {
    pipeline,
    focusDistance,
    focalLength,
    bokehScale,
    render: () => {
      pipeline.render();
    },
    dispose: () => {
      pipeline.dispose();
    },
  };
}
