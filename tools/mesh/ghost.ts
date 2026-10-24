// Ghost-cell index map for a cell-centred solver with a `layers`-deep halo (2 for MUSCL).
//
// Cells are numbered globally block by block, i fastest: cell (i, j) of block b is
// cellOffset[b] + j * ni + i. Ghosts are numbered block by block too; within a block, face by face
// (imin, imax, jmin, jmax), then layer 1..layers (1 = touching the face), then face cell index along
// the face (j for i-faces, i for j-faces). Corner ghosts are not provided: the dimension-split MUSCL
// stencil never reads them.
//
// Each ghost has a source cell and a BC code. For an interface the source is the neighbour block's
// cell `layer` cells in from the matching face, and filling the ghost is a plain copy; because the
// interface nodes (hence the face vectors) are bitwise equal on both sides, both blocks compute the
// same face flux, so the exchange is exactly conservative. For a physical boundary the source is
// this block's own mirror cell (layer 1 -> the cell touching the face, layer 2 -> the next), and the
// solver applies the BC (reflect the normal velocity at slip walls and the axis, characteristic
// state at far-field boundaries).
import { faceCellIJ } from './metrics';
import { findCellPatch, mapIndex } from './topology';
import { BC, FACES, type Block, type Face, type MultiBlockMesh } from './types';

export interface GhostMap {
  readonly layers: number;
  /** Global cell index of each block's first cell (length nBlocks + 1). */
  readonly cellOffset: Int32Array;
  /** Index of each block's first ghost (length nBlocks + 1). */
  readonly ghostOffset: Int32Array;
  /** Source cell (global index) of each ghost. */
  readonly src: Int32Array;
  /** BC code of each ghost (BC.INTERFACE for copies). */
  readonly bc: Uint8Array;
}

function faceCells(b: Pick<Block, 'ni' | 'nj'>, face: Face): number {
  return face === 'imin' || face === 'imax' ? b.nj : b.ni;
}

function depthLimit(b: Pick<Block, 'ni' | 'nj'>, face: Face): number {
  return face === 'imin' || face === 'imax' ? b.ni : b.nj;
}

/** Offset of a face's ghosts within its block. */
function faceBase(b: Pick<Block, 'ni' | 'nj'>, face: Face, layers: number): number {
  let base = 0;
  for (const f of FACES) {
    if (f === face) return base;
    base += layers * faceCells(b, f);
  }
  return base;
}

export function buildGhostMap(mesh: MultiBlockMesh, layers = 2): GhostMap {
  const { blocks, patches } = mesh;
  const cellOffset = new Int32Array(blocks.length + 1);
  const ghostOffset = new Int32Array(blocks.length + 1);
  blocks.forEach((b, bi) => {
    cellOffset[bi + 1] = (cellOffset[bi] ?? 0) + b.ni * b.nj;
    ghostOffset[bi + 1] = (ghostOffset[bi] ?? 0) + layers * 2 * (b.ni + b.nj);
  });
  const total = ghostOffset[blocks.length] ?? 0;
  const src = new Int32Array(total);
  const bc = new Uint8Array(total);
  blocks.forEach((b, bi) => {
    for (const face of FACES) {
      const n = faceCells(b, face);
      for (let c = 0; c < n; c++) {
        const patch = findCellPatch(patches, bi, face, c);
        if (patch === undefined) throw new Error(`${b.name} ${face}: cell ${c} has no patch`);
        for (let layer = 1; layer <= layers; layer++) {
          const g = (ghostOffset[bi] ?? 0) + faceBase(b, face, layers) + (layer - 1) * n + c;
          if (patch.bc === BC.INTERFACE && patch.nbr !== undefined) {
            const nb = blocks[patch.nbr.block] as Block;
            if (layer > depthLimit(nb, patch.nbr.face)) {
              throw new Error(`${nb.name} is too thin for ${layers} ghost layers`);
            }
            const cb = Math.min(mapIndex(patch, c), mapIndex(patch, c + 1));
            const [i, j] = faceCellIJ(nb, patch.nbr.face, cb, layer - 1);
            src[g] = (cellOffset[patch.nbr.block] ?? 0) + j * nb.ni + i;
            bc[g] = BC.INTERFACE;
          } else {
            if (layer > depthLimit(b, face))
              throw new Error(`${b.name} is too thin for ${layers} ghost layers`);
            const [i, j] = faceCellIJ(b, face, c, layer - 1);
            src[g] = (cellOffset[bi] ?? 0) + j * b.ni + i;
            bc[g] = patch.bc;
          }
        }
      }
    }
  });
  return { layers, cellOffset, ghostOffset, src, bc };
}

/** Index into src/bc of the ghost `layer` cells outside face cell c of a block face. */
export function ghostIndex(
  map: GhostMap,
  mesh: MultiBlockMesh,
  block: number,
  face: Face,
  layer: number,
  c: number,
): number {
  const b = mesh.blocks[block];
  if (b === undefined) throw new Error(`no block ${block}`);
  const n = faceCells(b, face);
  if (!(layer >= 1 && layer <= map.layers) || !(c >= 0 && c < n)) {
    throw new Error(`ghost ${face} layer ${layer} cell ${c} is outside block ${b.name}`);
  }
  return (map.ghostOffset[block] ?? 0) + faceBase(b, face, map.layers) + (layer - 1) * n + c;
}
