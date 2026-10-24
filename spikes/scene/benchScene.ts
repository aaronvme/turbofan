// Representative render load for the GPU spikes (plan: 1080p, a few hundred thousand triangles
// of instanced PBR metal, an environment map, bloom), plus the interop path of the real app:
// a cut plane and GPU particles that sample the solver's rgba16float flow texture.
// No DOM APIs, so it runs on the main thread and in a worker (spike d).

import {
  AgXToneMapping,
  AdditiveBlending,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  ExternalTexture,
  Group,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RenderPipeline,
  Scene,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  If,
  cos,
  float,
  hash,
  instanceIndex,
  instancedArray,
  mix,
  pass,
  sin,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeNow } from '../../src/render/rendererOnDevice';

export interface BenchSceneOptions {
  readonly flowA: GPUTexture;
  readonly domain: { readonly x0: number; readonly x1: number; readonly r1: number };
  readonly particles: number;
  /** Rows of core blades (each ~ bladesPerRow instances). */
  readonly coreRows: number;
  readonly bladesPerRow: number;
}

export interface BenchScene {
  /** Triangles drawn per frame by the scene geometry (before post-processing). */
  readonly triangles: number;
  frame(dtSec: number): void;
  dispose(): void;
}

function twistedBlade(chord: number, span: number, segs: [number, number], twist: number) {
  const g = new BoxGeometry(chord, span, chord * 0.08, segs[0], segs[1], 1);
  const pos = g.attributes.position;
  if (!pos) throw new Error('no positions');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = twist * (v.y / span + 0.5);
    const x = v.x * Math.cos(a) - v.z * Math.sin(a);
    const z = v.x * Math.sin(a) + v.z * Math.cos(a);
    pos.setXYZ(i, x, v.y + span / 2, z); // root at local y = 0
  }
  g.computeVertexNormals();
  return g;
}

function triangles(g: BufferGeometry): number {
  return (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
}

/** One ring of blades around the engine (x) axis at axial station x. */
function bladeRow(
  target: InstancedMesh,
  start: number,
  count: number,
  x: number,
  hub: number,
): number {
  const m = new Matrix4();
  const q = new Quaternion();
  const axis = new Vector3(1, 0, 0);
  const s = new Vector3(1, 1, 1);
  for (let k = 0; k < count; k++) {
    const theta = (2 * Math.PI * k) / count;
    q.setFromAxisAngle(axis, theta);
    const p = new Vector3(x, hub * Math.cos(theta), hub * Math.sin(theta));
    m.compose(p, q, s);
    target.setMatrixAt(start + k, m);
  }
  return start + count;
}

export function createBenchScene(renderer: WebGPURenderer, o: BenchSceneOptions): BenchScene {
  renderer.toneMapping = AgXToneMapping;
  const scene = new Scene();
  scene.background = new Color(0x0b0d10);
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  const sun = new DirectionalLight(0xffffff, 2.0);
  sun.position.set(3, 4, 2);
  scene.add(sun);

  const camera = new PerspectiveCamera(35, 16 / 9, 0.05, 50);
  camera.position.set(-2.4, 1.1, 3.3);
  camera.lookAt(0.9, 0, 0);

  const metal = new MeshStandardNodeMaterial({ color: 0xc2c6ce, metalness: 1, roughness: 0.3 });
  const rotor = new Group();
  scene.add(rotor);

  // Fan: 24 wide-chord blades, finely tessellated.
  const fanGeo = twistedBlade(0.22, 0.62, [24, 80], 0.9);
  const fan = new InstancedMesh(fanGeo, metal, 24);
  bladeRow(fan, 0, 24, 0, 0.24);
  rotor.add(fan);

  // Core: compressor and turbine rows of small blades.
  const coreGeo = twistedBlade(0.05, 0.14, [6, 24], 0.5);
  const coreCount = o.coreRows * o.bladesPerRow;
  const core = new InstancedMesh(coreGeo, metal, coreCount);
  let next = 0;
  for (let r = 0; r < o.coreRows; r++) {
    const x = 0.45 + (1.5 * r) / Math.max(1, o.coreRows - 1);
    next = bladeRow(core, next, o.bladesPerRow, x, 0.3 + 0.05 * Math.sin(r));
  }
  rotor.add(core);

  // Nacelle: revolved clearcoat shell.
  const profile: Vector2[] = [];
  for (let k = 0; k <= 96; k++) {
    const t = k / 96;
    profile.push(new Vector2(0.92 - 0.12 * Math.sin(Math.PI * t) ** 2, -0.25 + 2.4 * t));
  }
  const nacelleGeo = new LatheGeometry(profile, 192);
  nacelleGeo.rotateZ(-Math.PI / 2);
  const nacelleMat = new MeshPhysicalNodeMaterial({
    color: 0xe6eaef,
    metalness: 0.05,
    roughness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    side: DoubleSide,
  });
  const nacelle = new Mesh(nacelleGeo, nacelleMat);
  nacelle.scale.set(1, 1, 1);
  scene.add(nacelle);

  // Cut plane in the meridional (x, r) plane, coloured by p / pInf from the flow texture.
  const flow = new ExternalTexture(o.flowA);
  flow.minFilter = LinearFilter;
  flow.magFilter = LinearFilter;
  flow.generateMipmaps = false;
  const { x0, x1, r1 } = o.domain;
  const planeMat = new MeshBasicNodeMaterial({ side: DoubleSide });
  const f = texture(flow, uv());
  const s = f.x.sub(0.97).mul(12).clamp(0, 1);
  planeMat.colorNode = vec4(
    mix(vec3(0.05, 0.1, 0.35), vec3(1.6, 0.6, 0.15), s).add(f.w.abs().mul(0.004)),
    1,
  );
  const plane = new Mesh(new PlaneGeometry(x1 - x0, r1, 1, 1), planeMat);
  plane.position.set((x0 + x1) / 2, r1 / 2, -0.001);
  scene.add(plane);

  // Particles advected by the flow texture (TSL compute reading the raw-written texture).
  const n = o.particles;
  const state = instancedArray(n, 'vec4'); // x, r, theta, seed
  const dt = uniform(0);
  const init = Fn(() => {
    const p = state.element(instanceIndex);
    const h1 = hash(instanceIndex);
    const h2 = hash(instanceIndex.add(7919));
    const h3 = hash(instanceIndex.add(104729));
    p.assign(vec4(mix(float(x0), float(x1), h1), h2.mul(r1), h3.mul(6.2831853), h1));
  })().compute(n);
  const update = Fn(() => {
    const p = state.element(instanceIndex);
    const at = vec2(p.x.sub(x0).div(x1 - x0), p.y.div(r1));
    const v = texture(flow, at).level(float(0));
    // Time dilation: the flow moves at ~100 m/s, the particles at 1/200 of that.
    const nx = p.x.add(v.z.mul(dt).mul(0.005));
    const nr = p.y.add(v.w.mul(dt).mul(0.005));
    If(nx.greaterThan(x1).or(nr.greaterThan(r1)).or(nr.lessThan(0)), () => {
      p.x.assign(float(x0));
      p.y.assign(hash(instanceIndex.add(p.w.mul(1e4).toUint())).mul(r1));
    }).Else(() => {
      p.x.assign(nx);
      p.y.assign(nr);
    });
  })().compute(n);
  computeNow(renderer, init);
  const spriteMat = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const a = state.toAttribute();
  spriteMat.positionNode = vec3(a.x, a.y.mul(cos(a.z)), a.y.mul(sin(a.z)));
  spriteMat.colorNode = vec4(0.4, 0.8, 1.4, 0.6);
  spriteMat.scaleNode = float(0.006);
  const particles = new Sprite(spriteMat);
  particles.count = n;
  particles.frustumCulled = false;
  scene.add(particles);

  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  pipeline.outputNode = color.add(bloom(color, 0.5, 0.35, 0.85));

  const tris =
    24 * triangles(fanGeo) + coreCount * triangles(coreGeo) + triangles(nacelleGeo) + 2 + 2 * n; // sprite quads

  return {
    triangles: tris,
    frame(dtSec: number) {
      dt.value = dtSec;
      computeNow(renderer, update);
      rotor.rotation.x += dtSec * 3;
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      for (const g of [fanGeo, coreGeo, nacelleGeo]) g.dispose();
      for (const m of [metal, nacelleMat, planeMat, spriteMat]) m.dispose();
      env.dispose();
      pmrem.dispose();
      fan.dispose();
      core.dispose();
      flow.dispose();
    },
  };
}
