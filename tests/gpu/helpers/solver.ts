// Shared set-up of the GPU solver tests: a Dawn device with the limits the solver may need, and
// the shipped 130k mesh asset through the real loader (manifest length and SHA-256 checked).
import { readFileSync } from 'node:fs';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../../src/gpu/device';
import { loadMeshAsset, parseMeshManifest, type LoadedMesh } from '../../../src/flow/mesh/loader';
import { enginePreconditioning } from '../../../src/flow/gpu/params';
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

/**
 * D4-89: the engine's preconditioning in the GPU tests, on the GPU and on the oracle alike: minMach
 * = M_cut = the global M_cut 0.02 (ENGINE_MACH_CUT, the adapter's default; D4-40's 0.003 before).
 * It mirrors tests/ladder/oracle.ts's ENGINE_PRECONDITIONING_CUT on w2/reference-9 (d05e16d:
 * minMach 0.003 with globalMachCut 0.02, in force minMach = M_cut = 0.02). Main's oracle has no
 * globalMachCut option yet, so the tests pass the values in force. Once that branch is merged, the
 * oracle's constant can replace this one (the GPU's scheme options take globalMachCut with the
 * oracle's meaning) and GLOBAL_MACH_CUT === ENGINE_MACH_CUT can be pinned.
 */
export const ENGINE_PRECONDITIONING_CUT = enginePreconditioning();

export { GpuErrorLog };
