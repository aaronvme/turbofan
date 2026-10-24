// Binary mesh + metrics format (stub; implemented after the failing tests).
import type { MultiBlockMesh } from './types';

export type Real = Float64Array | Float32Array;

export interface MeshFileBlock {
  readonly name: string;
  readonly ni: number;
  readonly nj: number;
  readonly nodeOffset: number;
  readonly cellOffset: number;
  readonly iFaceOffset: number;
  readonly jFaceOffset: number;
  readonly ghostOffset: number;
}

export interface MeshFilePatch {
  readonly block: number;
  readonly face: number;
  readonly bc: number;
  readonly floating: boolean;
  readonly start: number;
  readonly end: number;
  readonly nbrBlock: number;
  readonly nbrFace: number;
  readonly nbrStart: number;
  readonly nbrEnd: number;
  readonly label: string;
}

export interface MeshFile {
  readonly version: number;
  readonly precision: 'f64' | 'f32';
  readonly ghostLayers: number;
  readonly blocks: readonly MeshFileBlock[];
  readonly patches: readonly MeshFilePatch[];
  readonly nodeX: Float64Array;
  readonly nodeR: Float64Array;
  readonly cellX: Real;
  readonly cellR: Real;
  readonly cellArea: Real;
  readonly cellVolR: Real;
  readonly iFaceNx: Real;
  readonly iFaceNr: Real;
  readonly iFaceAreaR: Real;
  readonly jFaceNx: Real;
  readonly jFaceNr: Real;
  readonly jFaceAreaR: Real;
  readonly ghostSrc: Int32Array;
  readonly ghostBc: Uint8Array;
}

export function meshFileFromMesh(_mesh: MultiBlockMesh, _precision: 'f64' | 'f32'): MeshFile {
  throw new Error('not implemented');
}

export function encodeMeshFile(_file: MeshFile): Uint8Array {
  throw new Error('not implemented');
}

export function decodeMeshFile(_bytes: Uint8Array): MeshFile {
  throw new Error('not implemented');
}
