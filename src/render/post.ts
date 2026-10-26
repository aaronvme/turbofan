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
  cameraPosition,
  cameraProjectionMatrix,
  cameraProjectionMatrixInverse,
  cameraViewMatrix,
  cameraWorldMatrix,
  cos,
  float,
  Fn,
  frameId,
  getViewPosition,
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
}

export interface PostSettings {
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

  const worldAt = (suv: Node<'vec2'>, depth: Node<'float'>): Node<'vec3'> =>
    cameraWorldMatrix.mul(vec4(getViewPosition(suv, depth, cameraProjectionMatrixInverse), 1)).xyz;

  const composite = Fn(() => {
    const suv = screenUV;
    const base = sceneColor.sample(suv);
    const occl = mix(float(1), aoTex.sample(suv).r, aoStrength);
    const lit = base.rgb.mul(occl);

    const rc = rotorColor.sample(suv);
    const rDepth = rotorDepth.sample(suv).r;
    const sDepth = sceneDepth.sample(suv).r;
    const covered = rc.a.greaterThan(0.001);

    // the fan face disc where the pixel looks between blades
    const far = worldAt(suv, float(0.5));
    const dir = far.sub(cameraPosition).normalize();
    const tDisc = float(fan.x).sub(cameraPosition.x).div(dir.x);
    const pDisc = cameraPosition.add(dir.mul(tDisc));
    const rDisc = length(pDisc.yz);
    const onDisc = tDisc
      .greaterThan(0)
      .and(rDisc.greaterThan(fan.rHub))
      .and(rDisc.lessThan(fan.rTip));
    const pBlade = worldAt(suv, rDepth);
    const p = select(covered, pBlade, pDisc).toVar();
    const angle = select(
      covered,
      rotorBlur.sample(suv).r,
      select(onDisc, u.lpBlur, float(0)),
    ).toVar();

    // is the rotor (or the disc) in front of the static scene here?
    const sceneWorld = worldAt(suv, sDepth);
    const dScene = select(sDepth.lessThan(1), sceneWorld.sub(cameraPosition).length(), float(1e9));
    const dRotor = p.sub(cameraPosition).length();
    const visible = covered.or(onDisc).and(dRotor.lessThan(dScene));

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
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(q, 1));
        const ndc = clip.xy.div(clip.w);
        const quv = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const smp = rotorColor.sample(quv);
        acc.addAssign(vec4(smp.rgb.mul(smp.a), smp.a));
      });
      acc.divAssign(samples);
    });
    const rot = select(visible, acc, vec4(0));
    return vec4(lit.mul(float(1).sub(rot.a)).add(rot.rgb), 1);
  })();

  const traaNode = traa(composite, sceneDepth, sceneVelocity, camera);
  const focusDistance = uniform(4);
  const focalLength = uniform(2.5);
  const bokehScale = uniform(1.2);
  const dofNode = dof(traaNode, scenePass.getViewZNode(), focusDistance, focalLength, bokehScale);
  const bloomNode = bloom(traaNode, settings.bloomStrength, 0.45, 0.9);
  pipeline.outputNode = (dofNode as unknown as Node<'vec4'>).add(bloomNode);

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
