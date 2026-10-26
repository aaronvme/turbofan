// The generated mesh asset: `npm run mesh` writes public/mesh/mesh-<spec>.bin (not committed) and
// public/mesh/manifest.json (committed). A fresh build must reproduce the manifest's bytes and
// SHA-256 exactly, so the generator stays deterministic and every mesh change is a visible
// manifest change; the app checks a downloaded asset against the same hash.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { MESH_130K, MESH_80K, buildEngineMesh, meshFileMaps } from '../../tools/mesh/engineMesh';
import { VERSION, decodeMeshFile, encodeMeshFile, meshFileFromMesh } from '../../tools/mesh/format';
import { flowpathFromDefinition } from '../../tools/mesh/geometry/definition';

interface Manifest {
  readonly format: string;
  readonly version: number;
  readonly specs: Readonly<
    Record<string, { file: string; bytes: number; cells: number; blocks: number; sha256: string }>
  >;
}

const manifest = JSON.parse(readFileSync('public/mesh/manifest.json', 'utf8')) as Manifest;
const geometry = flowpathFromDefinition(ENGINE_DEFINITION);

describe('generated mesh asset', () => {
  it('declares the current binary format', () => {
    expect(manifest.format).toBe('turbofan-mesh');
    expect(manifest.version).toBe(VERSION);
  });

  it.each([MESH_130K, MESH_80K])('rebuilds $name to the manifest bytes and hash', (spec) => {
    const mesh = buildEngineMesh(geometry, spec);
    const bytes = encodeMeshFile(meshFileFromMesh(mesh, 'f32', meshFileMaps(mesh)));
    const entry = manifest.specs[spec.name];
    expect(entry).toBeDefined();
    expect(bytes.length).toBe(entry?.bytes);
    expect(mesh.totalCells).toBe(entry?.cells);
    expect(mesh.blocks.length).toBe(entry?.blocks);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry?.sha256);
    // and it decodes, maps included
    const file = decodeMeshFile(bytes);
    expect(file.stations.length).toBe(mesh.stations.length);
    expect(file.rows.length).toBe(mesh.rows.length);
  });
});
