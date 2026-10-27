// The 130k production mesh for the ladder, built in memory from the engine definition (the same
// bytes as public/mesh/mesh-130k.bin; the f32 variant goes through the real loader and its hash).
import { readFileSync } from 'node:fs';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { loadMeshAsset, parseMeshManifest, type LoadedMesh } from '../../src/flow/mesh/loader';
import type { MeshFile } from '../../src/flow/mesh/meshFile';
import { NP } from '../../src/flow/reference/state';
import type { ReferenceSolver } from '../../src/flow/reference/solver';
import { MESH_130K, buildEngineMesh, meshFileMaps } from '../../tools/mesh/engineMesh';
import { encodeMeshFile, meshFileFromMesh } from '../../tools/mesh/format';
import { flowpathFromDefinition } from '../../tools/mesh/geometry/definition';

const mesh = buildEngineMesh(flowpathFromDefinition(ENGINE_DEFINITION), MESH_130K);

/** The shipped asset (f32 metrics), checked against the committed manifest by the loader. */
export async function engineAsset(): Promise<LoadedMesh> {
  const bytes = encodeMeshFile(meshFileFromMesh(mesh, 'f32', meshFileMaps(mesh)));
  const manifest = parseMeshManifest(JSON.parse(readFileSync('public/mesh/manifest.json', 'utf8')));
  const entry = manifest.specs['130k'];
  if (entry === undefined) throw new Error('manifest has no 130k entry');
  return loadMeshAsset(bytes, entry);
}

/** The same mesh with f64 metrics (exact discrete identities). */
export function engineFileF64(): MeshFile {
  return meshFileFromMesh(mesh, 'f64', meshFileMaps(mesh));
}

/** max over cells of |u - u_inf| (axial, radial and swirl components). */
export function spuriousVelocity(s: ReferenceSolver): number {
  const P = s.primitives();
  let worst = 0;
  for (let c = 0; c < s.mesh.nCells; c++) {
    const du = (P[NP * c + 1] ?? NaN) - s.ref.u;
    const v = P[NP * c + 2] ?? NaN;
    const w = (P[NP * c + 3] ?? NaN) / (s.mesh.cellR[c] ?? NaN);
    const m = Math.sqrt(du * du + v * v + w * w);
    if (!(m <= worst)) worst = m; // NaN propagates
  }
  return worst;
}
