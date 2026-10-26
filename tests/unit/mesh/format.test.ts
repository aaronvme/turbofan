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
    expect(file.version).toBe(2);
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

describe('mesh file format v2: station and row maps, structural checks (W0M-I4, W0M-N3)', () => {
  const maps = {
    stations: [
      { id: '2', block: 0, i: 0, x: 0 },
      { id: '49.5', block: 1, i: 2, x: 0.5 },
    ],
    rows: [{ id: 'hpc-s9', block: 0, i0: 1, i1: 3 }],
  };

  it('carries the station and row maps and round-trips them bitwise', () => {
    const file = meshFileFromMesh(sideBySide(), 'f32', maps);
    expect(file.version).toBe(2);
    const bytes = encodeMeshFile(file);
    const back = decodeMeshFile(bytes);
    expect(back.stations).toEqual(maps.stations);
    expect(back.rows).toEqual(maps.rows);
    expect(Array.from(encodeMeshFile(back))).toEqual(Array.from(bytes));
    // without maps the sections are present and empty
    expect(decodeMeshFile(encodeMeshFile(meshFileFromMesh(sideBySide(), 'f64'))).rows).toEqual([]);
  });

  const corrupt = (edit: (f: MeshFile) => MeshFile, message: RegExp): void => {
    const file = edit(meshFileFromMesh(sideBySide(), 'f64', maps));
    expect(() => decodeMeshFile(encodeMeshFile(file))).toThrow(message);
  };

  it('rejects block offsets that do not add up', () => {
    corrupt(
      (f) => ({ ...f, blocks: f.blocks.map((b, k) => (k === 1 ? { ...b, cellOffset: 5 } : b)) }),
      /block B offsets/,
    );
  });

  it('rejects ghost sources outside the cells and unknown BC codes', () => {
    corrupt((f) => ({ ...f, ghostSrc: f.ghostSrc.map((v, k) => (k === 0 ? 99 : v)) }), /ghost 0/);
    corrupt((f) => ({ ...f, ghostBc: f.ghostBc.map((v, k) => (k === 3 ? 9 : v)) }), /ghost 3/);
  });

  it('rejects patches with bad blocks, faces, codes or ranges', () => {
    const patch = (k: number, p: Partial<MeshFile['patches'][number]>) => (f: MeshFile) => ({
      ...f,
      patches: f.patches.map((q, m) => (m === k ? { ...q, ...p } : q)),
    });
    corrupt(patch(0, { block: 7 }), /patch 0/);
    corrupt(patch(1, { face: 4 }), /patch 1/);
    corrupt(patch(2, { bc: 6 }), /patch 2/);
    corrupt(patch(0, { end: 9 }), /patch 0/);
    corrupt(patch(0, { nbrBlock: 5 }), /patch 0/);
  });

  it('rejects station and row maps outside their blocks', () => {
    corrupt((f) => ({ ...f, stations: [{ id: '2', block: 3, i: 0, x: 0 }] }), /station 2/);
    corrupt((f) => ({ ...f, stations: [{ id: '2', block: 0, i: 4, x: 0 }] }), /station 2/);
    corrupt((f) => ({ ...f, rows: [{ id: 'r', block: 0, i0: 2, i1: 2 }] }), /row r/);
  });

  it('rejects a section whose element type disagrees with the precision flag', () => {
    const bytes = encodeMeshFile(meshFileFromMesh(sideBySide(), 'f64', maps));
    const view = new DataView(bytes.buffer);
    // the section table starts at byte 64, 16 bytes per entry; find CELL_X (id 5)
    for (let k = 0; k < view.getUint32(48, true); k++) {
      if (view.getUint32(64 + 16 * k, true) === 5) view.setUint32(64 + 16 * k + 4, 2, true);
    }
    expect(() => decodeMeshFile(bytes)).toThrow(/section 5/);
  });
});
