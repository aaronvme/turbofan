// Elliptic (Winslow/Thompson) smoothing (stub; implemented after the failing tests).
import type { MultiBlockMesh } from './types';

export interface SmoothOptions {
  readonly sweeps: number;
  readonly omega?: number;
  readonly floatInterfaces?: boolean;
  readonly control?: 'initial-grid' | 'none';
}

export interface SmoothReport {
  readonly sweeps: number;
  readonly freeNodes: number;
  readonly firstMaxMove: number;
  readonly lastMaxMove: number;
}

export function smoothMesh(_mesh: MultiBlockMesh, _opts: SmoothOptions): SmoothReport {
  throw new Error('not implemented');
}
