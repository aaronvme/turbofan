// The browser-side mesh asset loader (src/flow/mesh/loader.ts): hash, structure (the decoder's
// W0M-N3 checks), numbers (W1M-N3), the domain from the boundary patches (W1M-N4), the manifest.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeMeshFile, meshFileFromMesh, type MeshFile } from '../../../tools/mesh/format';
import {
  loadMeshAsset,
  meshDomain,
  meshNumericProblems,
  parseMeshManifest,
  type MeshManifestEntry,
} from '../../../src/flow/mesh/loader';
import { BC, rectangle, singleBlock, wiggled } from './helpers';

const block = wiggled('box', -1.5, 4.25, 0, 2.5, 6, 4, 0.05);
const mesh = singleBlock(block, {
  imin: BC.INFLOW,
  imax: BC.OUTFLOW,
  jmin: BC.AXIS,
  jmax: BC.FARFIELD,
});

function entryFor(bytes: Uint8Array, file: MeshFile): MeshManifestEntry {
  return {
    file: 'test.bin',
    bytes: bytes.byteLength,
    cells: file.cellX.length,
    blocks: file.blocks.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

describe('mesh asset loader', () => {
  const file = meshFileFromMesh(mesh, 'f32');
  const bytes = encodeMeshFile(file);

  it('loads a good asset: counts, format, domain from the boundary patches', async () => {
    const { asset, file: decoded } = await loadMeshAsset(bytes, entryFor(bytes, file));
    expect(asset.format).toBe('turbofan-mesh');
    expect(asset.version).toBe(2);
    expect(asset.cellCount).toBe(24);
    expect(asset.blockCount).toBe(1);
    expect(asset.domain).toEqual({ xIn: -1.5, xOut: 4.25, rOut: 2.5 });
    expect(asset.bytes.byteLength).toBe(bytes.byteLength);
    expect(decoded.precision).toBe('f32');
  });

  it('rejects a wrong hash, length or count', async () => {
    const e = entryFor(bytes, file);
    await expect(loadMeshAsset(bytes, { ...e, sha256: '0'.repeat(64) })).rejects.toThrow(/SHA-256/);
    await expect(loadMeshAsset(bytes, { ...e, bytes: e.bytes + 8 })).rejects.toThrow(/bytes/);
    await expect(loadMeshAsset(bytes, { ...e, cells: 25 })).rejects.toThrow(/cells/);
    await expect(loadMeshAsset(bytes, { ...e, blocks: 2 })).rejects.toThrow(/blocks/);
  });

  it('rejects non-finite or non-positive metrics (W1M-N3)', async () => {
    const bad: MeshFile = { ...file, cellArea: Float32Array.from(file.cellArea) };
    (bad.cellArea as Float32Array)[3] = Number.NaN;
    expect(meshNumericProblems(bad).join()).toMatch(/cellArea/);
    const neg: MeshFile = { ...file, cellVolR: Float32Array.from(file.cellVolR) };
    (neg.cellVolR as Float32Array)[0] = -1;
    expect(meshNumericProblems(neg).join()).toMatch(/cellVolR/);
    const face: MeshFile = { ...file, iFaceNx: Float32Array.from(file.iFaceNx) };
    (face.iFaceNx as Float32Array)[2] = Number.POSITIVE_INFINITY;
    expect(meshNumericProblems(face).join()).toMatch(/iFaceNx/);
    const nodes: MeshFile = { ...file, nodeR: Float64Array.from(file.nodeR) };
    nodes.nodeR[1] = -0.5;
    expect(meshNumericProblems(nodes).join()).toMatch(/nodeR/);
    expect(meshNumericProblems(file)).toEqual([]);
    const badBytes = encodeMeshFile(bad);
    await expect(loadMeshAsset(badBytes, entryFor(badBytes, bad))).rejects.toThrow(/cellArea/);
  });

  it('derives the domain only from plane boundaries, and needs all three kinds', () => {
    expect(meshDomain(meshFileFromMesh(mesh, 'f64'))).toEqual({ xIn: -1.5, xOut: 4.25, rOut: 2.5 });
    const tilted = singleBlock(
      {
        ...block,
        x: Float64Array.from(block.x, (x, k) => (k === 0 ? x - 0.01 : x)),
      },
      { imin: BC.INFLOW, imax: BC.OUTFLOW, jmin: BC.AXIS, jmax: BC.FARFIELD },
    );
    expect(() => meshDomain(meshFileFromMesh(tilted, 'f64'))).toThrow(/inflow.*plane/);
    const noFar = singleBlock(rectangle('b', 0, 1, 0, 1, 2, 2), {
      imin: BC.INFLOW,
      imax: BC.OUTFLOW,
      jmin: BC.AXIS,
      jmax: BC.SLIP_WALL,
    });
    expect(() => meshDomain(meshFileFromMesh(noFar, 'f64'))).toThrow(/far-field/);
  });

  it('parses the committed manifest and rejects malformed ones', () => {
    const m = parseMeshManifest(JSON.parse(readFileSync('public/mesh/manifest.json', 'utf8')));
    expect(m.format).toBe('turbofan-mesh');
    expect(m.specs['130k']?.cells).toBe(130_034);
    expect(m.specs['130k']?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => parseMeshManifest({ format: 'x', version: 2, specs: {} })).toThrow();
    expect(() => parseMeshManifest(null)).toThrow();
    expect(() =>
      parseMeshManifest({ format: 'turbofan-mesh', version: 2, specs: { a: { file: 'a' } } }),
    ).toThrow(/a/);
  });
});
