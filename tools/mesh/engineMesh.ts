// The 12-block engine topology (stub; implemented after the failing tests).
import type { FlowpathGeometry } from './geometry/flowpath';
import type { SmoothReport } from './smooth';
import type { MultiBlockMesh } from './types';

export const BLOCK_NAMES = [
  'upstream',
  'inlet',
  'lip',
  'fan',
  'bypass',
  'core',
  'afterbody',
  'plug',
  'plume-core',
  'plume-bypass',
  'plume-outer',
  'farfield',
] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

export interface MeshSpec {
  readonly name: string;
  readonly targetCells: number;
  readonly nCore: number;
  readonly nBypass: number;
  readonly nLip: number;
  readonly nFar: number;
  readonly cellsPerChord: number;
  readonly lipRadialSpacing: number;
  readonly upstreamD: number;
  readonly radialD: number;
  readonly downstreamD: number;
  readonly sweeps: number;
}

export const MESH_130K: MeshSpec = {
  name: '130k',
  targetCells: 130_000,
  nCore: 16,
  nBypass: 32,
  nLip: 16,
  nFar: 36,
  cellsPerChord: 5,
  lipRadialSpacing: 0.009,
  upstreamD: 5,
  radialD: 5,
  downstreamD: 20,
  sweeps: 300,
};

export const MESH_80K: MeshSpec = { ...MESH_130K, name: '80k', targetCells: 80_000 };

export interface EngineMesh extends MultiBlockMesh {
  readonly spec: MeshSpec;
  readonly geometry: FlowpathGeometry;
  readonly domain: {
    readonly xIn: number;
    readonly xOut: number;
    readonly rOut: number;
    readonly D: number;
  };
  readonly index: Readonly<Record<BlockName, number>>;
  readonly totalCells: number;
  readonly smoothing: SmoothReport;
}

export function buildEngineMesh(_geometry: FlowpathGeometry, _spec: MeshSpec): EngineMesh {
  throw new Error('not implemented');
}
