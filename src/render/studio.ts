// The product-shot studio (D3-1, LD-3), worker-safe and fully procedural (no HDRI file):
//
// - An environment scene of softboxes in a dark room, baked by PMREMGenerator.fromScene at
//   512 px per face, for the image-based light and every reflection. The panels are smooth
//   gradients, so mirror-like surfaces show long soft softbox reflections instead of the 1k
//   HDRI's texel blocks (pass-3 LD-2).
// - A visible cyclorama: a floor that sweeps up into a wall all around (an infinity cove),
//   matte neutral grey, darkening away from the engine like a lit studio pool.
// - Lights: a soft shadowed key from above front-left, a cool rim from behind, a dim fill.
//   The floor gets the key's shadow plus an analytic contact shadow under the nacelle.
//
// Engine frame: x along the axis (fan face at 0, plug tip ~3.4 m), y up.

import {
  BackSide,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector2,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  exp,
  float,
  length,
  mix,
  positionWorld,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

/** Floor height, m (the nacelle's lowest point is ~0.95 m below the axis). */
export const FLOOR_Y = -1.32;
/** Where the engine sits over the floor: the cove is centred here. */
const CENTRE_X = 1.3;

export interface Studio {
  readonly environment: Texture;
  /** Cyclorama, lights and shadow catcher for the main scene. */
  readonly stage: Group;
  /** Lights for the rotor scene (same rig, no shadow). */
  readonly rotorLights: Group;
  readonly key: DirectionalLight;
  /** 0 hides the analytic contact shadow (exploded view: the engine is split). */
  readonly contact: { value: number };
  dispose(): void;
}

function softbox(
  w: number,
  h: number,
  intensity: number,
  tint: readonly [number, number, number],
): Mesh {
  const m = new MeshBasicNodeMaterial({ side: DoubleSide });
  // a diffused softbox: bright centre, soft falloff to a dark rim
  const d = uv().sub(0.5).abs().mul(2);
  const edge = smoothstep(1, 0.55, d.x).mul(smoothstep(1, 0.55, d.y));
  m.colorNode = vec3(...tint)
    .mul(intensity)
    .mul(edge.mul(0.85).add(0.15));
  return new Mesh(new PlaneGeometry(w, h), m);
}

function environmentScene(): Scene {
  const s = new Scene();
  // a dark room with a lighter floor (bounce)
  const room = new MeshBasicNodeMaterial({ side: BackSide });
  const up = positionWorld.normalize().y;
  room.colorNode = mix(
    vec3(0.03, 0.03, 0.032),
    vec3(0.006, 0.006, 0.007),
    smoothstep(-0.2, 0.7, up),
  );
  s.add(new Mesh(new SphereGeometry(30, 48, 24), room));
  const floor = new Mesh(new PlaneGeometry(60, 60), new MeshBasicNodeMaterial({ color: 0x262626 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  s.add(floor);
  // key: a big overhead softbox, a little forward and to the camera side
  const key = softbox(7, 3.2, 22, [1, 0.97, 0.93]);
  key.position.set(0.6, 6.5, 2.2);
  key.lookAt(0.8, 0, 0.3);
  s.add(key);
  // two tall strips: a rim behind the engine and a kicker on the far side
  const rim = softbox(1.4, 6, 16, [0.9, 0.95, 1]);
  rim.position.set(4.8, 2.2, -5.5);
  rim.lookAt(1.2, 0, 0);
  s.add(rim);
  const kick = softbox(1.4, 6, 9, [1, 0.98, 0.95]);
  kick.position.set(-4.5, 2.2, -5);
  kick.lookAt(0.5, 0, 0);
  s.add(kick);
  // fill: a large dim card on the camera side
  const fill = softbox(8, 4, 1.6, [1, 1, 1]);
  fill.position.set(-1, 1.5, 8);
  fill.lookAt(1, 0, 0);
  s.add(fill);
  // two long horizontal strips along the engine: the classic product-shot highlight bands
  // running the length of a cylinder (one high on the camera side, one low on the far side)
  const bandHigh = softbox(9, 0.55, 14, [1, 0.99, 0.97]);
  bandHigh.position.set(1.2, 3.4, 5.2);
  bandHigh.lookAt(1.2, 0, 0);
  s.add(bandHigh);
  const bandLow = softbox(9, 0.45, 6, [0.95, 0.97, 1]);
  bandLow.position.set(1.2, -0.2, -5.6);
  bandLow.lookAt(1.2, 0, 0);
  s.add(bandLow);
  // a low strip in front of the intake, for the lip's lower edge
  const front = softbox(5, 0.8, 6, [1, 1, 1]);
  front.position.set(-6.5, -0.4, 1.5);
  front.lookAt(0, 0, 0);
  s.add(front);
  return s;
}

/** The cyclorama profile (radius, height) revolved about the vertical through CENTRE_X. */
function coveGeometry(): LatheGeometry {
  const pts: Vector2[] = [new Vector2(0, FLOOR_Y)];
  const r0 = 9;
  const rc = 5;
  for (let k = 0; k <= 16; k++) {
    const a = (Math.PI / 2) * (k / 16);
    pts.push(new Vector2(r0 + rc * Math.sin(a), FLOOR_Y + rc * (1 - Math.cos(a))));
  }
  pts.push(new Vector2(r0 + rc, FLOOR_Y + 30));
  return new LatheGeometry(pts, 128);
}

export async function createStudio(renderer: WebGPURenderer): Promise<Studio> {
  const pmrem = new PMREMGenerator(renderer);
  const envScene = environmentScene();
  const target = pmrem.fromScene(envScene, 0.02, 0.1, 100, { size: 512 });
  pmrem.dispose();
  for (const o of envScene.children) {
    if (o instanceof Mesh) {
      const mesh = o as Mesh<PlaneGeometry | SphereGeometry, MeshBasicNodeMaterial>;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
  await Promise.resolve();

  const stage = new Group();
  stage.name = 'studio';
  const contact = uniform(1);
  // matte: a Lambert surface is all a cyclorama needs, and it covers most of the frame
  const coveMat = new MeshLambertNodeMaterial({ side: DoubleSide });
  const p = positionWorld;
  const d = length(vec2(p.x.sub(CENTRE_X), p.z));
  // a lit pool: neutral grey near the engine, falling off into a darker surround
  const pool = mix(float(1), float(0.2), smoothstep(2, 11, d));
  // contact shadow: a soft ellipse under the nacelle (its footprint ~ x -0.8..1.6, |z| < 1)
  const cx = p.x.sub(0.45).div(1.55);
  const cz = p.z.div(0.95);
  const blob = exp(cx.mul(cx).add(cz.mul(cz)).mul(-1.6))
    .mul(0.55)
    .mul(contact);
  const onFloor = smoothstep(FLOOR_Y + 0.3, FLOOR_Y + 0.02, p.y);
  coveMat.colorNode = vec3(0.2, 0.202, 0.205)
    .mul(pool)
    .mul(float(1).sub(blob.mul(onFloor)));
  const cove = new Mesh(coveGeometry(), coveMat);
  cove.position.x = CENTRE_X;
  cove.receiveShadow = true;
  cove.name = 'cyclorama';
  stage.add(cove);

  const key = new DirectionalLight(new Color(1, 0.96, 0.9), 2.6);
  key.name = 'key';
  key.position.set(-1.2, 7, 3.2);
  key.target.position.set(1.0, 0, 0);
  key.castShadow = true;
  // the engine only moves on mode changes: the view re-renders the map then (needsUpdate)
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.blurSamples = 12;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const cam = key.shadow.camera;
  cam.left = -4;
  cam.right = 4;
  cam.top = 4;
  cam.bottom = -4;
  cam.near = 1;
  cam.far = 16;
  stage.add(key, key.target);
  const rim = new DirectionalLight(new Color(0.85, 0.92, 1), 1.4);
  rim.position.set(5, 3, -5);
  rim.target.position.set(1, 0, 0);
  stage.add(rim, rim.target);

  const rotorLights = new Group();
  const keyR = new DirectionalLight(key.color, key.intensity);
  keyR.position.copy(key.position);
  keyR.target.position.copy(key.target.position);
  const rimR = new DirectionalLight(rim.color, rim.intensity);
  rimR.position.copy(rim.position);
  rimR.target.position.copy(rim.target.position);
  rotorLights.add(keyR, keyR.target, rimR, rimR.target);

  return {
    environment: target.texture,
    stage,
    rotorLights,
    key,
    contact,
    dispose: () => {
      target.dispose();
      cove.geometry.dispose();
      coveMat.dispose();
      key.shadow.dispose();
    },
  };
}
