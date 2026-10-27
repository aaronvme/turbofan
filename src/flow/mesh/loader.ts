// Loads the generated mesh asset (public/mesh/mesh-<spec>.bin) for the solver, in the browser or
// in Node: checks the bytes against the committed manifest (length and SHA-256, MESH.md D10), lets
// the decoder check the structure (W0M-N3), checks the numbers (W1M-N3: finite metrics, positive
// areas and volumes) and derives the domain the asset does not carry from its boundary patches
// (W1M-N4: docs/SOLVER.md section 2). Nothing reaches the GPU before all of that passes.
import type { MeshAsset, SolverDomain } from '../../contracts/flow';
import { decodeMeshFile, type MeshFile } from './meshFile';

export interface MeshManifestEntry {
  readonly file: string;
  readonly bytes: number;
  readonly cells: number;
  readonly blocks: number;
  readonly sha256: string;
}

export interface MeshManifest {
  readonly format: 'turbofan-mesh';
  readonly version: number;
  readonly specs: Readonly<Record<string, MeshManifestEntry>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates public/mesh/manifest.json's shape. */
export function parseMeshManifest(json: unknown): MeshManifest {
  if (!isRecord(json) || json.format !== 'turbofan-mesh' || typeof json.version !== 'number') {
    throw new Error('not a turbofan-mesh manifest');
  }
  const specs = json.specs;
  if (!isRecord(specs)) throw new Error('mesh manifest has no specs');
  const out: Record<string, MeshManifestEntry> = {};
  for (const [name, e] of Object.entries(specs)) {
    const ok =
      isRecord(e) &&
      typeof e.file === 'string' &&
      typeof e.bytes === 'number' &&
      typeof e.cells === 'number' &&
      typeof e.blocks === 'number' &&
      typeof e.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(e.sha256);
    if (!ok) throw new Error(`mesh manifest entry ${name} is malformed`);
    out[name] = {
      file: e.file as string,
      bytes: e.bytes as number,
      cells: e.cells as number,
      blocks: e.blocks as number,
      sha256: e.sha256 as string,
    };
  }
  return { format: 'turbofan-mesh', version: json.version, specs: out };
}

/** Lower-case hex SHA-256 (Web Crypto: the browser and Node 24 both have it). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Numeric problems of a decoded file (empty when sound): non-finite nodes or metrics, a negative
 * node radius, non-positive cell areas or volumes, negative face areas. O(cells).
 */
export function meshNumericProblems(file: MeshFile): string[] {
  const problems: string[] = [];
  const check = (
    name: string,
    a: ArrayLike<number>,
    ok: (v: number) => boolean,
    what: string,
  ): void => {
    for (let k = 0; k < a.length; k++) {
      const v = a[k] ?? NaN;
      if (!ok(v)) {
        problems.push(`${name}[${k}] = ${v} is not ${what}`);
        return;
      }
    }
  };
  const finite = (v: number): boolean => Number.isFinite(v);
  const positive = (v: number): boolean => Number.isFinite(v) && v > 0;
  const nonNegative = (v: number): boolean => Number.isFinite(v) && v >= 0;
  check('nodeX', file.nodeX, finite, 'finite');
  check('nodeR', file.nodeR, nonNegative, 'finite and >= 0');
  check('cellX', file.cellX, finite, 'finite');
  check('cellR', file.cellR, positive, 'finite and > 0');
  check('cellArea', file.cellArea, positive, 'finite and > 0');
  check('cellVolR', file.cellVolR, positive, 'finite and > 0');
  check('iFaceNx', file.iFaceNx, finite, 'finite');
  check('iFaceNr', file.iFaceNr, finite, 'finite');
  check('iFaceAreaR', file.iFaceAreaR, nonNegative, 'finite and >= 0');
  check('jFaceNx', file.jFaceNx, finite, 'finite');
  check('jFaceNr', file.jFaceNr, finite, 'finite');
  check('jFaceAreaR', file.jFaceAreaR, nonNegative, 'finite and >= 0');
  return problems;
}

/** BC codes of the asset (tools/mesh/types.ts BC). */
const INFLOW = 4;
const OUTFLOW = 5;
const FARFIELD = 3;

/** Plane tolerance of the domain boundaries, m. */
const PLANE_TOL = 1e-9;

/**
 * The solver domain (contracts SolverDomain) from the asset's boundary patches: x_in is the x of
 * every INFLOW node, x_out of every OUTFLOW node, r_out the r of every FARFIELD node. Each must be
 * a plane to 1e-9 m.
 */
export function meshDomain(file: MeshFile): SolverDomain {
  const coord = (bc: number, axis: 'x' | 'r', name: string): number => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of file.patches) {
      if (p.bc !== bc) continue;
      const b = file.blocks[p.block];
      if (b === undefined) continue;
      for (let k = p.start; k <= p.end; k++) {
        const [i, j] =
          p.face === 0 ? [0, k] : p.face === 1 ? [b.ni, k] : p.face === 2 ? [k, 0] : [k, b.nj];
        const node = b.nodeOffset + j * (b.ni + 1) + i;
        const v = (axis === 'x' ? file.nodeX[node] : file.nodeR[node]) ?? NaN;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!(hi >= lo)) throw new Error(`mesh has no ${name} boundary`);
    if (hi - lo > PLANE_TOL) {
      throw new Error(`the ${name} boundary is not a plane ${axis} = const (spread ${hi - lo} m)`);
    }
    return lo;
  };
  return {
    xIn: coord(INFLOW, 'x', 'inflow'),
    xOut: coord(OUTFLOW, 'x', 'outflow'),
    rOut: coord(FARFIELD, 'r', 'far-field'),
  };
}

export interface LoadedMesh {
  /** The contract header (src/contracts/flow.ts). */
  readonly asset: MeshAsset;
  readonly file: MeshFile;
}

/** Checks and decodes an asset against its manifest entry; throws (rejects) on any problem. */
export async function loadMeshAsset(
  input: ArrayBuffer | Uint8Array,
  expected: MeshManifestEntry,
): Promise<LoadedMesh> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength !== expected.bytes) {
    throw new Error(`mesh asset is ${bytes.byteLength} bytes, the manifest says ${expected.bytes}`);
  }
  const hash = await sha256Hex(bytes);
  if (hash !== expected.sha256) {
    throw new Error(`mesh asset SHA-256 ${hash} does not match the manifest's ${expected.sha256}`);
  }
  const file = decodeMeshFile(bytes);
  const problems = meshNumericProblems(file);
  if (problems.length > 0) throw new Error(`mesh asset has bad numbers: ${problems.join('; ')}`);
  if (file.cellX.length !== expected.cells) {
    throw new Error(
      `mesh asset has ${file.cellX.length} cells, the manifest says ${expected.cells}`,
    );
  }
  if (file.blocks.length !== expected.blocks) {
    throw new Error(
      `mesh asset has ${file.blocks.length} blocks, the manifest says ${expected.blocks}`,
    );
  }
  const copy = bytes.slice().buffer;
  return {
    asset: {
      format: 'turbofan-mesh',
      version: file.version,
      cellCount: file.cellX.length,
      blockCount: file.blocks.length,
      domain: meshDomain(file),
      bytes: copy,
    },
    file,
  };
}
