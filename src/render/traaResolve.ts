// Our TRAA resolve, installed into three r186's TRAANode (its history targets, jitter, camera
// matrices and copies are kept; only the resolve shader is ours). Two changes from r186's
// (examples/jsm/tsl/display/TRAANode.js, setup):
// - The history is read with a 5-tap Catmull-Rom filter (Jimenez's bilinear-optimized form)
//   instead of one bilinear tap. Once the rotors are reprojected (W1V-I1 fix b) their history
//   is resampled at a sub-pixel offset every frame, and repeated bilinear resampling blurred
//   the thin dark gaps between stacked blades away in motion; bicubic keeps them.
// - The closest-depth search and the variance clip use the 4-neighbour cross (5 taps) instead
//   of the 3 x 3 block (9 taps): LOD round 2, D4-5 (TRAA was the largest post pass, ~1.2-1.6
//   ms at 1080p), for the four Catmull-Rom taps added.
// Everything else (validity, motion weight, subpixel correction, flicker reduction) is r186's.

import type { Node, TextureNode } from 'three/webgpu';
import { add, float, Fn, If, int, max, texture, uv, vec2 } from 'three/tsl';
import {
  clipAABB,
  flickerReduction,
  samplePreviousDepth,
} from 'three/addons/tsl/utils/TAAUtils.js';

type F = Node<'float'>;

/** The TRAANode internals the resolve reads (three r186, pinned; not in @types/three). */
interface TraaParts {
  readonly beautyNode: TextureNode;
  readonly depthNode: TextureNode;
  readonly velocityNode: TextureNode;
  readonly camera: unknown;
  readonly depthThreshold: number;
  readonly edgeDepthDiff: number;
  readonly maxVelocityLength: number;
  readonly useSubpixelCorrection: boolean;
  readonly _historyRenderTarget: { texture: unknown };
  readonly _previousDepthNode: unknown;
  readonly _previousCameraProjectionMatrixInverse: unknown;
  readonly _previousCameraWorldMatrix: unknown;
  readonly _cameraWorldMatrixInverse: unknown;
  readonly _cameraNearFar: unknown;
  readonly _resolveMaterial: { colorNode: unknown };
  setup(builder: unknown): unknown;
}

const CROSS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Replaces the resolve shader of a three r186 TRAANode (throws if its internals moved). */
export function installTraaResolve(traaNode: unknown): void {
  const t = traaNode as TraaParts;
  for (const f of [
    '_historyRenderTarget',
    '_previousDepthNode',
    '_previousCameraProjectionMatrixInverse',
    '_previousCameraWorldMatrix',
    '_cameraWorldMatrixInverse',
    '_cameraNearFar',
    '_resolveMaterial',
  ] as const)
    if (!(f in t)) throw new Error(`three's TRAANode has no ${f} (src/render/traaResolve.ts)`);
  const setup = t.setup.bind(t);
  t.setup = (builder) => {
    const out = setup(builder);
    t._resolveMaterial.colorNode = resolveNode(t);
    return out;
  };
}

function resolveNode(t: TraaParts): Node<'vec4'> {
  const historyTex = texture(t._historyRenderTarget.texture as never);
  const beauty = t.beautyNode;
  const loadAt = (node: TextureNode, p: Node<'vec2'>) =>
    (node as unknown as { load(p: Node<'vec2'>): Node<'vec4'> }).load(p);
  const sampleAt = (p: Node<'vec2'>) => historyTex.sample(p);

  // the 5-tap Catmull-Rom history (bilinear taps at the merged centre weights)
  const catmullRom = Fn(([uvH, size]: [Node<'vec2'>, Node<'vec2'>]) => {
    const pos = uvH.mul(size);
    const t1 = pos.sub(0.5).floor().add(0.5);
    const f = pos.sub(t1);
    const w0 = f.mul(f.mul(f.mul(-0.5).add(1)).sub(0.5));
    const w1 = f.mul(f).mul(f.mul(1.5).sub(2.5)).add(1);
    const w2 = f.mul(f.mul(f.mul(-1.5).add(2)).add(0.5));
    const w3 = f.mul(f).mul(f.mul(0.5).sub(0.5));
    const w12 = w1.add(w2);
    const t12 = t1.add(w2.div(w12)).div(size);
    const t0 = t1.sub(1).div(size);
    const t3 = t1.add(2).div(size);
    const a = sampleAt(vec2(t12.x, t0.y)).mul(w12.x.mul(w0.y));
    const b = sampleAt(vec2(t0.x, t12.y)).mul(w0.x.mul(w12.y));
    const c = sampleAt(t12).mul(w12.x.mul(w12.y));
    const d = sampleAt(vec2(t3.x, t12.y)).mul(w3.x.mul(w12.y));
    const e = sampleAt(vec2(t12.x, t3.y)).mul(w12.x.mul(w3.y));
    const wsum = w12.x
      .mul(w0.y)
      .add(w0.x.mul(w12.y))
      .add(w12.x.mul(w12.y))
      .add(w3.x.mul(w12.y))
      .add(w12.x.mul(w3.y));
    // bicubic rings a little at hard edges: no negative radiance (the clip bounds the rest)
    return add(a, b, c, d, e).div(wsum).max(0);
  });

  return Fn(() => {
    const uvNode = uv();
    const size = vec2(beauty.size(int(0)) as unknown as Node<'ivec2'>);
    const texel = uvNode.mul(size);

    // the closest and farthest depth in the cross
    const closest = float(2).toVar();
    const closestTexel = vec2(0).toVar();
    const farthest = float(-1).toVar();
    for (const [x, y] of [[0, 0] as const, ...CROSS]) {
      const n = texel.add(vec2(x, y)).toVar();
      const d = loadAt(t.depthNode, n).r.toVar();
      If(d.lessThan(closest), () => {
        closest.assign(d);
        closestTexel.assign(n);
      });
      If(d.greaterThan(farthest), () => {
        farthest.assign(d);
      });
    }
    const offsetUV = loadAt(t.velocityNode, closestTexel).xy.mul(vec2(0.5, -0.5));
    const historyUV = uvNode.sub(offsetUV);
    const previousDepth = samplePreviousDepth(
      t._previousDepthNode,
      historyUV,
      t._previousCameraProjectionMatrixInverse,
      t._previousCameraWorldMatrix,
      t._cameraWorldMatrixInverse,
      t._cameraNearFar,
      t.camera,
    ) as F;
    const isValidUV = historyUV.greaterThanEqual(0).all().and(historyUV.lessThanEqual(1).all());
    const isEdge = farthest.sub(closest).greaterThan(t.edgeDepthDiff);
    const isDisocclusion = closest.sub(previousDepth).greaterThan(t.depthThreshold);
    const hasValidHistory = isValidUV.and(isEdge.or(isDisocclusion.not()));

    const current = loadAt(beauty, texel).max(0).toVar();
    const history = catmullRom(historyUV, size);

    const motionFactor = uvNode
      .sub(historyUV)
      .mul(size)
      .length()
      .div(t.maxVelocityLength)
      .saturate();
    const weight = float(0.05).toVar();
    if (t.useSubpixelCorrection) {
      const phase = offsetUV.mul(size).fract().abs();
      const w = max(phase, phase.oneMinus());
      weight.addAssign(w.x.mul(w.y).oneMinus().div(0.75).mul(0.25));
    }
    weight.assign(hasValidHistory.select(weight.add(motionFactor).saturate(), float(1)));

    // variance clip over the cross
    const m1 = current.toVar();
    const m2 = current.pow2().toVar();
    for (const [x, y] of CROSS) {
      const c = loadAt(beauty, texel.add(vec2(x, y))).max(0);
      m1.addAssign(c);
      m2.addAssign(c.pow2());
    }
    const gamma = float(0.5).add(motionFactor.oneMinus().pow2().mul(0.5));
    const mean = m1.div(5);
    const sigma = m2.div(5).sub(mean.pow2()).max(0).sqrt().mul(gamma);
    const lo = mean.sub(sigma);
    const hi = mean.add(sigma);
    const clipped = clipAABB(mean.clamp(lo, hi), history, lo, hi) as Node<'vec4'>;
    return flickerReduction(current, clipped, weight) as Node<'vec4'>;
  })();
}
