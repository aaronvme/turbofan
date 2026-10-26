// The look-dev render pipeline (three r186 RenderPipeline, TSL), worker-safe:
//
//   main pass "Opaque" (colour, normal, velocity) -> GTAO (half res)
//   rotor pass "Rotors" (colour + alpha, per-pixel blur angle)
//   -> "Composite" (AO applied, analytic rotational blur of the rotors over the scene)
//   -> TRAA -> [depth of field, cinematic presets only] -> vignette + bloom
//   -> AgX tone mapping + sRGB (outputColorTransform)
//
// Rotational blur: a rotor seen through an open shutter is the time average of the rotor
// image over the angle it turns, delta = omega T_open (src/geometry/motion.ts). At time t the
// pixel's ray meets the rotor turned by omega t, i.e. the static rotor meets the ray turned
// back by -omega t.
// - The fan (LD-1): the turned-back ray is marched through the fan's swept volume at a few
//   axial planes; the first point that lies at or behind the rotor surface the camera sees
//   there is the hit, and its colour is the rotor colour there. The old single fan-face plane
//   departed from the blades near the hub and left blade-edge "teeth" (pass-3 LD-1); the
//   march follows the blades through their whole axial extent.
// - Other rotors (cutaway rows, the spinner) use the pixel's own rotor depth: exact for
//   surfaces of revolution, and the rows are thin.
// The samples are jittered per pixel and frame and TRAA averages the noise out; the angle is
// capped at one blade pitch (the image is periodic in it). This is what a film camera
// records, not the strobed wagon wheel point sampling gives.

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
  bool,
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
import type { LookUniforms } from './materials';

export interface FanVolume {
  readonly rHub: number;
  readonly rTip: number;
  /** Blade pitch, rad (2 pi / count). */
  readonly pitch: number;
  /** Axial limits of the fan rotor, m. */
  readonly xFore: number;
  readonly xAft: number;
}

export type PostDebug = 'rotorAlpha' | 'rotorBlur' | 'ao' | 'visible' | null;

export interface PostSettings {
  /** Debug output instead of the final image (look-dev only). */
  readonly debug?: PostDebug;
  /** Time samples per pixel for the fan march and for the other rotors. */
  readonly fanSamples: number;
  readonly rotorSamples: number;
  /** Axial planes the fan march tests per time sample. */
  readonly fanPlanes: number;
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
  render(): void;
  dispose(): void;
}

export function createPipeline(
  renderer: WebGPURenderer,
  main: Scene,
  rotors: Scene,
  camera: PerspectiveCamera,
  u: LookUniforms,
  fan: FanVolume,
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

    // the fan's swept volume: J planes between xFore and xAft, in order along the ray
    const J = settings.fanPlanes;
    const forward = dirW.x.greaterThan(0);
    // the planes are jittered per pixel and frame too, so their spacing never shows as steps
    const planeJitter = interleavedGradientNoise(
      screenCoordinate.add(vec2(37.1, float(frameId.mod(64)).mul(3.71))),
    );
    const span = fan.xAft - fan.xFore;
    const planes = Array.from({ length: J }, (_, k) => {
      const f = float(k).add(planeJitter).div(J);
      const xa = f.mul(span).add(fan.xFore);
      const xb = float(1).sub(f).mul(span).add(fan.xFore);
      const xk = select(forward, xa, xb);
      const t = xk.sub(cameraPosition.x).div(dirW.x);
      const p = cameraPosition.add(dirW.mul(t));
      const r = length(p.yz);
      const zView = dirV.z.mul(t);
      const valid = t
        .greaterThan(0)
        .and(r.greaterThan(fan.rHub * 0.97))
        .and(r.lessThan(fan.rTip))
        .and(zView.greaterThan(zScene));
      return { p, valid };
    });
    let inFan: Node<'bool'> = bool(false);
    for (const pl of planes) inFan = inFan.or(pl.valid);
    // the spinner (or anything rotating ahead of the fan) is in front: not the fan's pixel
    const spinnerFront = covered.and(pRotor.x.lessThan(fan.xFore));
    const useFan = inFan.and(spinnerFront.not());

    const acc = vec4(rc.rgb.mul(rc.a), rc.a).toVar();
    const fanAngle = u.lpBlur.min(fan.pitch);
    If(useFan.and(fanAngle.greaterThan(1e-4)), () => {
      acc.assign(vec4(0));
      const n = settings.fanSamples;
      Loop(n, ({ i }) => {
        const t = float(i).add(jitter).div(n).sub(0.5).mul(fanAngle);
        const c = cos(t);
        const s = sin(t);
        const hit = bool(false).toVar();
        const col = vec4(0).toVar();
        for (const pl of planes) {
          If(hit.not().and(pl.valid), () => {
            const q = rotX(pl.p, c, s);
            const quv = toUv(q);
            const smp = rotorColor.sample(quv);
            const isFan = rotorBlur.sample(quv).b.greaterThan(0.5);
            const zr = viewZOf(rotorDepth.sample(quv).r);
            const zq = camView.mul(vec4(q, 1)).z;
            // only a fan blade counts (not the spinner or a booster blade seen there)
            If(isFan.and(smp.a.greaterThan(0.5)).and(zq.lessThanEqual(zr.add(0.004))), () => {
              hit.assign(true);
              col.assign(smp);
            });
          });
        }
        // a miss looks through the fan: at what the pixel itself sees behind it (a booster
        // blade, unblurred) or at the static scene
        If(hit.not().and(covered).and(pRotor.x.greaterThan(fan.xAft)), () => {
          col.assign(rc);
        });
        acc.addAssign(vec4(col.rgb.mul(col.a), col.a));
      });
      acc.divAssign(n);
    });
    // other rotors: their own surface point, turned through the spool's shutter angle
    const blurMrt = rotorBlur.sample(suv);
    const angle = select(covered, blurMrt.r, float(0)).min(blurMrt.g).toVar();
    const visibleRotor = covered.and(zRotor.greaterThan(zScene));
    If(useFan.not().and(visibleRotor).and(angle.greaterThan(1e-4)), () => {
      acc.assign(vec4(0));
      const n = settings.rotorSamples;
      Loop(n, ({ i }) => {
        const t = float(i).add(jitter).div(n).sub(0.5).mul(angle);
        const smp = rotorColor.sample(toUv(rotX(pRotor, cos(t), sin(t))));
        acc.addAssign(vec4(smp.rgb.mul(smp.a), smp.a));
      });
      acc.divAssign(n);
    });
    const rot = select(useFan.or(visibleRotor), acc, vec4(0));
    if (settings.debug === 'visible')
      return vec4(
        select(useFan, float(1), float(0)),
        fanAngle.div(Math.PI),
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
  let cinematic = false;

  return {
    pipeline,
    focusDistance,
    focalLength,
    bokehScale,
    setCinematic: (on) => {
      cinematic = on && !settings.debug;
    },
    render: () => {
      (cinematic ? cinePipeline : pipeline).render();
    },
    dispose: () => {
      pipeline.dispose();
      cinePipeline.dispose();
      compositeTex.dispose();
    },
  };
}
