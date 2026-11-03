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
 * It mirrors tests/ladder/oracle.ts's ENGINE_PRECONDITIONING_CUT (minMach 0.003 with
 * globalMachCut 0.02, in force minMach = M_cut = 0.02), passing the values in force.
 * tests/unit/flow/gpu/machCut.test.ts pins the two together (D4-93): ENGINE_MACH_CUT ===
 * GLOBAL_MACH_CUT, and the oracle's constant gives this one's stageParams uniforms.
 */
export const ENGINE_PRECONDITIONING_CUT = enginePreconditioning();

/**
 * SOLVER.md 12.2's flux-scale rows: |r_GPU - r_ref| / r_flux (D4-48) at D4-62's tolerances, ten
 * times the GPU's measured error rounded up to one figure (B 1.27e-11, E-L5 2.67e-8), with D4-71's
 * E-L9a (1e-10: D4-62's 3e-11 sat inside the f32 rounding of the norm, W2R-I17). Tightening only
 * (they were D4-48's 1e-3); a row is never loosened to pass (W2R-I19). Since D5-6 (W3S-I1) E-L9a's
 * row reads r_GPU against the oracle's residual of the GPU's own U^9 (K2, SOLVER.md 17.1), at the
 * same 1e-10.
 */
export const FLUX_SCALE_TOLERANCE = { B: 2e-10, E_L5: 3e-7, E_L9a: 1e-10 } as const;

export { GpuErrorLog };
