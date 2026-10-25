// What of three r186 works inside a dedicated worker with an OffscreenCanvas (spike d)?
// Each check reports ok + detail instead of throwing, so one failure does not hide the rest.

import {
  CanvasTexture,
  FileLoader,
  ImageBitmapLoader,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  Texture,
  TextureLoader,
  type WebGPURenderer,
} from 'three/webgpu';
import { texture } from 'three/tsl';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface ProbeResult {
  readonly ok: boolean;
  readonly detail: string;
}

async function check(fn: () => Promise<string> | string): Promise<ProbeResult> {
  try {
    return { ok: true, detail: await fn() };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

async function pngUrl(): Promise<string> {
  const c = new OffscreenCanvas(4, 4);
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.fillStyle = '#3080ff';
  g.fillRect(0, 0, 4, 4);
  return URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));
}

/** A 2 x 2 flat (non-RLE) Radiance .hdr, the format of the Poly Haven HDRIs. */
function hdrBytes(): ArrayBuffer {
  const header = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n');
  const out = new Uint8Array(header.length + 16);
  out.set(header);
  out.set([128, 128, 128, 129, 255, 0, 0, 128, 0, 255, 0, 128, 0, 0, 255, 128], header.length);
  return out.buffer;
}

/** One textured triangle as glTF 2.0 JSON, with the image at `imageUrl` (a blob: URL). */
function gltfJson(imageUrl: string): string {
  const data = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1]);
  const bytes = new Uint8Array(data.buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: imageUrl }],
    buffers: [
      { byteLength: bytes.length, uri: `data:application/octet-stream;base64,${btoa(bin)}` },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    ],
  });
}

function drawOnce(renderer: WebGPURenderer, map: Texture): void {
  const scene = new Scene();
  const m = new MeshBasicNodeMaterial();
  m.colorNode = texture(map);
  scene.add(new Mesh(new PlaneGeometry(2, 2), m));
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  cam.position.z = 1;
  renderer.render(scene, cam);
  m.dispose();
}

export async function probeWorkerFeatures(
  renderer: WebGPURenderer,
): Promise<Record<string, ProbeResult>> {
  const url = await pngUrl();
  return {
    noDocument: await check(() => `typeof document = ${typeof document}`),
    requestAnimationFrame: await check(() => {
      if (typeof self.requestAnimationFrame !== 'function') throw new Error('missing');
      return 'self.requestAnimationFrame exists';
    }),
    textureLoader: await check(async () => {
      const t = await new TextureLoader().loadAsync(url);
      const image: unknown = t.image;
      return `loaded ${Object.prototype.toString.call(image)}`;
    }),
    imageBitmapLoader: await check(async () => {
      const loader = new ImageBitmapLoader();
      loader.setOptions({ imageOrientation: 'flipY' });
      const bmp = await loader.loadAsync(url);
      const t = new Texture(bmp);
      t.needsUpdate = true;
      drawOnce(renderer, t);
      return `ImageBitmap ${bmp.width}x${bmp.height} uploaded and sampled`;
    }),
    fileLoader: await check(async () => {
      const loader = new FileLoader();
      loader.setResponseType('arraybuffer');
      const data = (await loader.loadAsync(url)) as ArrayBuffer;
      return `${data.byteLength} bytes via fetch`;
    }),
    hdrLoaderAndPmrem: await check(async () => {
      const hdrUrl = URL.createObjectURL(new Blob([hdrBytes()]));
      const equirect = await new HDRLoader().loadAsync(hdrUrl);
      const pmrem = new PMREMGenerator(renderer);
      const env = pmrem.fromEquirectangular(equirect);
      const size = `${String(equirect.image.width)}x${String(equirect.image.height)}`;
      env.dispose();
      pmrem.dispose();
      equirect.dispose();
      return `HDRLoader ${size} -> PMREMGenerator.fromEquirectangular`;
    }),
    canvasTexture: await check(() => {
      const c = new OffscreenCanvas(64, 32);
      const g = c.getContext('2d');
      if (!g) throw new Error('no 2d context');
      g.fillStyle = '#fff';
      g.font = '16px sans-serif';
      g.fillText('N1 98.2', 2, 20);
      drawOnce(renderer, new CanvasTexture(c));
      return 'OffscreenCanvas 2D text uploaded and sampled';
    }),
    gltfLoaderWithTexture: await check(async () => {
      const gltf = await new GLTFLoader().parseAsync(gltfJson(url), '');
      // Duck-typed (isMesh/isTexture): GLTFLoader imports 'three', this module 'three/webgpu'.
      const maps: Texture[] = [];
      gltf.scene.traverse((o) => {
        const material: unknown = (o as { material?: unknown }).material;
        const map: unknown = (material as { map?: unknown } | undefined)?.map;
        if ((map as { isTexture?: boolean } | undefined)?.isTexture) maps.push(map as Texture);
      });
      const map = maps[0];
      if (!map) throw new Error('no base colour texture on the mesh');
      const image: unknown = map.image;
      drawOnce(renderer, map);
      return `GLTFLoader.parseAsync: texture image is ${Object.prototype.toString.call(image)}, sampled`;
    }),
    orbitControlsOnCanvas: await check(() => {
      const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
      const controls = new OrbitControls(cam, renderer.domElement);
      controls.dispose();
      return 'OrbitControls(camera, OffscreenCanvas) constructed';
    }),
    devicePixelRatio: await check(() => {
      const dpr: unknown = (self as { devicePixelRatio?: unknown }).devicePixelRatio;
      if (typeof dpr !== 'number') throw new Error(`self.devicePixelRatio is ${typeof dpr}`);
      return `self.devicePixelRatio = ${dpr}`;
    }),
    setSizeWithStyle: await check(() => {
      const w = renderer.domElement.width;
      const h = renderer.domElement.height;
      renderer.setSize(w, h); // updateStyle defaults to true
      return 'setSize(w, h) with updateStyle = true did not throw';
    }),
    setAnimationLoop: await check(
      () =>
        new Promise<string>((resolve) => {
          let n = 0;
          void renderer.setAnimationLoop(() => {
            n++;
            if (n === 3) {
              void renderer.setAnimationLoop(null);
              resolve('3 frames through renderer.setAnimationLoop');
            }
          });
        }),
    ),
  };
}
