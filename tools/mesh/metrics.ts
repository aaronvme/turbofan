// Finite-volume metrics and mesh quality (stub; implemented after the failing tests).
import type { Block, MultiBlockMesh } from './types';

export interface BlockGeometry {
  readonly centreX: Float64Array;
  readonly centreR: Float64Array;
  readonly area: Float64Array;
  readonly volR: Float64Array;
  readonly iFaceNx: Float64Array;
  readonly iFaceNr: Float64Array;
  readonly iFaceAreaR: Float64Array;
  readonly jFaceNx: Float64Array;
  readonly jFaceNr: Float64Array;
  readonly jFaceAreaR: Float64Array;
}

export function blockGeometry(_b: Block): BlockGeometry {
  throw new Error('not implemented');
}

export interface Where {
  readonly i: number;
  readonly j: number;
  readonly x: number;
  readonly r: number;
}

export interface BlockQuality {
  readonly name: string;
  readonly ni: number;
  readonly nj: number;
  readonly cells: number;
  readonly minJacobian: number;
  readonly maxJacobian: number;
  readonly minScaledJacobian: number;
  readonly maxStretch: number;
  readonly maxStretchAt: Where;
  readonly maxSkewDeg: number;
  readonly maxSkewAt: Where;
  readonly wallOrthoMaxDeg: number;
  readonly interfaceOrthoMaxDeg: number;
  readonly interfaceKinkMaxDeg: number;
  readonly aspectMin: number;
  readonly aspectMax: number;
  readonly aspectMaxAt: Where;
  readonly minEdge: number;
  readonly maxEdge: number;
}

export function meshQuality(_mesh: MultiBlockMesh): BlockQuality[] {
  throw new Error('not implemented');
}
