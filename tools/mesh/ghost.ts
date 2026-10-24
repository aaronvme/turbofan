// Ghost-cell index map (stub; implemented after the failing tests).
import type { Face, MultiBlockMesh } from './types';

export interface GhostMap {
  readonly layers: number;
  readonly cellOffset: Int32Array;
  readonly ghostOffset: Int32Array;
  readonly src: Int32Array;
  readonly bc: Uint8Array;
}

export function buildGhostMap(_mesh: MultiBlockMesh, _layers?: number): GhostMap {
  throw new Error('not implemented');
}

export function ghostIndex(
  _map: GhostMap,
  _mesh: MultiBlockMesh,
  _block: number,
  _face: Face,
  _layer: number,
  _c: number,
): number {
  throw new Error('not implemented');
}
