// The cut-plane field display of the flow visuals (w2/flowviz): the near-extent field (D0-4
// textures, src/contracts/flow.ts) painted on the two faces of the cutaway wedge, where the
// caps show the metal: fluid texels get the field, solid ones (fluid fraction < 0.5) are left
// to the caps. Colour by one quantity (src/flow/viz/fields.ts) through a 256-texel LUT baked
// from src/flow/viz/colormaps.ts, with contour lines one `contourStep` apart.
//
// This round feeds it CPU fields (the MOCK raster, or a readback) through DataTextures; the
// solver's own GPUTextures go in through three's ExternalTexture in the next round (handoff).
// Worker-safe: no DOM.

import {
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  type Node,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import {
  abs,
  float,
  fract,
  fwidth,
  length,
  log2,
  max,
  min,
  mix,
  sqrt,
  texture,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import type { CpuFlowField, FieldExtent } from '../contracts/flow';
import { bakeLut, COLORMAPS, type ColormapId } from '../flow/viz/colormaps';
import { FIELD_QUANTITIES, type FieldQuantityId } from '../flow/viz/fields';
import { gamma, gasConstant } from '../thermo/gas';

/** gamma R of air over [A_T0, A_T1] K: the cut plane's speed of sound a = sqrt(gamma R T). */
const A_T0 = 200;
const A_T1 = 2400;
const A_N = 64;

export interface FlowViz {
  readonly group: Group;
  setField(field: CpuFlowField): void;
  /** null hides the cut plane. */
  setQuantity(id: FieldQuantityId | null): void;
  /** Follows the cutaway wedge: the planes lie on its faces; `open` false hides them. */
  update(cutCenter: number, cutHalf: number, open: boolean): void;
  dispose(): void;
}

function fieldTexture(data: Uint16Array, e: FieldExtent): DataTexture {
  const t = new DataTexture(data, e.width, e.height, RGBAFormat, HalfFloatType);
  t.magFilter = t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createFlowViz(extent: FieldExtent): FlowViz {
  const empty = new Uint16Array(4 * extent.width * extent.height);
  let state = fieldTexture(empty, extent);
  let velocity = fieldTexture(empty.slice(), extent);
  const stateNode = texture(state);
  const velocityNode = texture(velocity);

  const luts = new Map<ColormapId, DataTexture>();
  for (const id of Object.keys(COLORMAPS) as ColormapId[]) {
    const t = new DataTexture(bakeLut(id), 256, 1, RGBAFormat, UnsignedByteType);
    t.colorSpace = SRGBColorSpace;
    t.magFilter = t.minFilter = LinearFilter;
    t.needsUpdate = true;
    luts.set(id, t);
  }
  const aData = new Float32Array(A_N);
  for (let i = 0; i < A_N; i++) {
    const tK = A_T0 + ((A_T1 - A_T0) * i) / (A_N - 1);
    aData[i] = gamma(tK, 0) * gasConstant(0);
  }
  const gammaR = new DataTexture(aData, A_N, 1, RedFormat, FloatType);
  gammaR.needsUpdate = true;

  const value = (
    id: FieldQuantityId,
    s: ReturnType<typeof stateNode.sample>,
    v: typeof s,
  ): Node<'float'> => {
    switch (id) {
      case 'p':
        return log2(max(s.r.add(1), 1e-4));
      case 'rho':
        return log2(max(s.g.add(1), 1e-4));
      case 't':
        return s.b;
      case 'speed':
        return length(v.xyz);
      case 'mach': {
        const u = s.b
          .sub(A_T0)
          .div(A_T1 - A_T0)
          .mul((A_N - 1) / A_N)
          .add(0.5 / A_N);
        const gr = texture(gammaR).sample(vec2(u, 0.5)).r;
        return length(v.xyz).div(sqrt(gr.mul(max(s.b, 1))));
      }
    }
  };

  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.alphaTest = 0.5;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  let quantity: FieldQuantityId | null = null;
  const build = (id: FieldQuantityId) => {
    const spec = FIELD_QUANTITIES[id];
    const lut = luts.get(spec.colormap);
    if (lut === undefined) throw new Error(`flowViz: no LUT ${spec.colormap}`);
    const s = stateNode.sample(uv());
    const v = velocityNode.sample(uv());
    const q = value(id, s, v);
    const t = q
      .sub(spec.min)
      .div(spec.max - spec.min)
      .clamp(0, 1);
    const base = texture(lut).sample(vec2(t.mul(255 / 256).add(0.5 / 256), 0.5)).rgb;
    // anti-aliased contour lines, one per contourStep
    const c = q.div(spec.contourStep);
    const line = float(1).sub(min(abs(fract(c.sub(0.5)).sub(0.5)).div(max(fwidth(c), 1e-6)), 1));
    material.colorNode = vec4(mix(base, base.mul(0.25), line.mul(0.7)), 1);
    material.opacityNode = v.a;
    material.needsUpdate = true;
  };

  // one half-plane per wedge face: local x = axial, local y = radius
  const geometry = new PlaneGeometry(extent.xMax - extent.xMin, extent.rMax - extent.rMin, 1, 1);
  geometry.translate((extent.xMin + extent.xMax) / 2, (extent.rMin + extent.rMax) / 2, 0);
  const group = new Group();
  group.name = 'flowCutPlane';
  const faces = [new Mesh(geometry, material), new Mesh(geometry, material)] as const;
  faces[0].name = 'flowCutPlane:a';
  faces[1].name = 'flowCutPlane:b';
  for (const f of faces) {
    f.castShadow = f.receiveShadow = false;
    f.frustumCulled = false;
    group.add(f);
  }
  group.visible = false;

  return {
    group,
    setField(field) {
      state.dispose();
      velocity.dispose();
      state = fieldTexture(field.near.state, extent);
      velocity = fieldTexture(field.near.velocity, extent);
      stateNode.value = state;
      velocityNode.value = velocity;
    },
    setQuantity(id) {
      quantity = id;
      if (id !== null) build(id);
    },
    update(center, half, open) {
      group.visible = open && quantity !== null;
      // the face at center - half shows its front; the plane's +y is the radius
      faces[0].rotation.x = center - half;
      faces[1].rotation.x = center + half;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      state.dispose();
      velocity.dispose();
      gammaR.dispose();
      for (const t of luts.values()) t.dispose();
    },
  };
}
