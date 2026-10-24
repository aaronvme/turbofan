import { describe, expect, it } from 'vitest';
import {
  decodeMeshFile,
  encodeMeshFile,
  meshFileFromMesh,
  type MeshFile,
} from '../../../tools/mesh/format';
import { buildGhostMap } from '../../../tools/mesh/ghost';
import { blockGeometry } from '../../../tools/mesh/metrics';
import { reversedPair, sideBySide } from './fixtures';

const ARRAYS = [
  'nodeX',
  'nodeR',
  'cellX',
  'cellR',
  'cellArea',
  'cellVolR',
  'iFaceNx',
  'iFaceNr',
  'iFaceAreaR',
  'jFaceNx',
  'jFaceNr',
  'jFaceAreaR',
  'ghostSrc',
  'ghostBc',
] as const;

function bytesOf(a: ArrayBufferView): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

function expectBitwiseEqual(a: MeshFile, b: MeshFile): void {
  expect(b.version).toBe(a.version);
  expect(b.precision).toBe(a.precision);
  expect(b.ghostLayers).toBe(a.ghostLayers);
  expect(b.blocks).toEqual(a.blocks);
  expect(b.patches).toEqual(a.patches);
  for (const key of ARRAYS) {
    expect(b[key].constructor).toBe(a[key].constructor);
    expect(Array.from(bytesOf(b[key]))).toEqual(Array.from(bytesOf(a[key])));
  }
}

describe('mesh file format', () => {
  it('carries the mesh, its metrics and the ghost map', () => {
    const mesh = reversedPair();
    const file = meshFileFromMesh(mesh, 'f64');
    expect(file.version).toBe(1);
    expect(file.blocks.map((b) => [b.name, b.ni, b.nj])).toEqual([
      ['A', 4, 2],
      ['B', 3, 4],
    ]);
    expect(file.blocks[1]?.cellOffset).toBe(8);
    expect(file.blocks[1]?.nodeOffset).toBe(15);
    expect(file.patches.length).toBe(mesh.patches.length);
    const B = mesh.blocks[1];
    if (B === undefined) throw new Error('no block B');
    expect(file.cellVolR.slice(8, 20)).toEqual(blockGeometry(B).volR);
    expect(Array.from(file.ghostSrc)).toEqual(Array.from(buildGhostMap(mesh, 2).src));
  });

  it('round-trips writer -> reader -> writer bitwise (f64)', () => {
    const file = meshFileFromMesh(sideBySide(), 'f64');
    const bytes = encodeMeshFile(file);
    expect(bytes.byteLength % 8).toBe(0);
    const back = decodeMeshFile(bytes);
    expectBitwiseEqual(file, back);
    expect(Array.from(encodeMeshFile(back))).toEqual(Array.from(bytes));
  });

  it('round-trips the f32 metrics variant (nodes stay f64)', () => {
    const f64 = meshFileFromMesh(reversedPair(), 'f64');
    const f32 = meshFileFromMesh(reversedPair(), 'f32');
    expect(f32.nodeX).toBeInstanceOf(Float64Array);
    expect(f32.cellVolR).toBeInstanceOf(Float32Array);
    for (let k = 0; k < f64.cellVolR.length; k++) {
      expect(f32.cellVolR[k]).toBe(Math.fround(f64.cellVolR[k] ?? 0));
    }
    const back = decodeMeshFile(encodeMeshFile(f32));
    expectBitwiseEqual(f32, back);
    expect(encodeMeshFile(f32).byteLength).toBeLessThan(encodeMeshFile(f64).byteLength);
  });

  it('decodes from an unaligned copy of the bytes', () => {
    const bytes = encodeMeshFile(meshFileFromMesh(sideBySide(), 'f64'));
    const shifted = new Uint8Array(bytes.byteLength + 3);
    shifted.set(bytes, 3);
    expectBitwiseEqual(decodeMeshFile(bytes), decodeMeshFile(shifted.subarray(3)));
  });

  it('rejects bad magic, unknown versions and truncated files', () => {
    const bytes = encodeMeshFile(meshFileFromMesh(sideBySide(), 'f64'));
    const badMagic = bytes.slice();
    badMagic[0] = 0x58;
    expect(() => decodeMeshFile(badMagic)).toThrow(/magic/);
    const badVersion = bytes.slice();
    new DataView(badVersion.buffer).setUint32(8, 99, true);
    expect(() => decodeMeshFile(badVersion)).toThrow(/version/);
    expect(() => decodeMeshFile(bytes.slice(0, bytes.byteLength - 8))).toThrow();
    expect(() => decodeMeshFile(bytes.slice(0, 10))).toThrow();
  });
});
