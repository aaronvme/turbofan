// Shared set-up of the GPU solver tests: a Dawn device with the limits the solver may need, and
// the shipped 130k mesh asset through the real loader (manifest length and SHA-256 checked).
import { readFileSync } from 'node:fs';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../../src/gpu/device';
import { loadMeshAsset, parseMeshManifest, type LoadedMesh } from '../../../src/flow/mesh/loader';
import { solverMeshFromFile, type SolverMesh } from '../../../src/flow/reference/solverMesh';
import { createDawnGpu } from './dawn';

export async function solverDevice(log: GpuErrorLog): Promise<SimDevice> {
  return requestSimDevice(createDawnGpu(), {
    powerPreference: 'high-performance',
    optionalFeatures: ['timestamp-query'],
    maxLimits: [
      'maxStorageBuffersPerShaderStage',
      'maxComputeWorkgroupStorageSize',
      'maxStorageBufferBindingSize',
      'maxBufferSize',
    ],
    onError: log.sink,
  });
}

let shipped: Promise<LoadedMesh> | null = null;

/** public/mesh/mesh-130k.bin, checked against public/mesh/manifest.json. */
export function shippedAsset(): Promise<LoadedMesh> {
  shipped ??= (async () => {
    const manifest = parseMeshManifest(
      JSON.parse(readFileSync('public/mesh/manifest.json', 'utf8')),
    );
    const entry = manifest.specs['130k'];
    if (entry === undefined) throw new Error('manifest has no 130k entry');
    return loadMeshAsset(readFileSync(`public/mesh/${entry.file}`), entry);
  })();
  return shipped;
}

export async function shippedMesh(): Promise<SolverMesh> {
  return solverMeshFromFile((await shippedAsset()).file);
}

export { GpuErrorLog };
