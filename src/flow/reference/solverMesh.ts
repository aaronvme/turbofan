// The solver's view of a decoded mesh asset (docs/SOLVER.md section 2): metrics upcast to f64 as
// stored (never recomputed, so the GPU kernel and this oracle see the same numbers), unit face
// normals with their per-radian areas and radii, and each ghost's unit outward boundary normal.
import type { MeshFile, MeshFilePatch, MeshFileRow, MeshFileStation } from '../mesh/meshFile';

export interface SolverBlock {
  readonly name: string;
  readonly ni: number;
  readonly nj: number;
  readonly cellOffset: number;
  readonly iFaceOffset: number;
  readonly jFaceOffset: number;
  readonly ghostOffset: number;
}

export interface SolverMesh {
  readonly nCells: number;
  readonly nGhosts: number;
  readonly blocks: readonly SolverBlock[];
  readonly patches: readonly MeshFilePatch[];
  readonly stations: readonly MeshFileStation[];
  readonly rows: readonly MeshFileRow[];
  readonly cellX: Float64Array;
  readonly cellR: Float64Array;
  /** Planar area A and per-radian volume V = A r_c. */
  readonly cellArea: Float64Array;
  readonly cellVolR: Float64Array;
  /** i-faces: unit normal towards +i, per-radian area r_bar L, face radius r_bar. */
  readonly iNx: Float64Array;
  readonly iNr: Float64Array;
  readonly iArea: Float64Array;
  readonly iRf: Float64Array;
  /** j-faces, the same towards +j. */
  readonly jNx: Float64Array;
  readonly jNr: Float64Array;
  readonly jArea: Float64Array;
  readonly jRf: Float64Array;
  /** Per ghost: source cell, BC code, unit outward normal of its boundary face. */
  readonly ghostSrc: Int32Array;
  readonly ghostBc: Uint8Array;
  readonly ghostNx: Float64Array;
  readonly ghostNr: Float64Array;
}

/** Ghost layers the scheme needs (MUSCL's 4-cell stencil). */
export const GHOST_LAYERS = 2;

function faces(
  nxL: ArrayLike<number>,
  nrL: ArrayLike<number>,
  areaR: ArrayLike<number>,
): { nx: Float64Array; nr: Float64Array; area: Float64Array; rf: Float64Array } {
  const n = areaR.length;
  const nx = new Float64Array(n);
  const nr = new Float64Array(n);
  const area = new Float64Array(n);
  const rf = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const ax = nxL[f] ?? NaN;
    const ar = nrL[f] ?? NaN;
    const L = Math.hypot(ax, ar);
    nx[f] = ax / L;
    nr[f] = ar / L;
    area[f] = areaR[f] ?? NaN;
    rf[f] = (areaR[f] ?? NaN) / L;
  }
  return { nx, nr, area, rf };
}

/** Global index of cell (i, j) of block b, or of the ghost there (nCells + ghost) outside it. */
export function extIndex(mesh: SolverMesh, b: number, i: number, j: number): number {
  const blk = mesh.blocks[b];
  if (blk === undefined) throw new Error(`no block ${b}`);
  const { ni, nj } = blk;
  if (i >= 0 && i < ni && j >= 0 && j < nj) return blk.cellOffset + j * ni + i;
  let base: number;
  let layer: number;
  let c: number;
  let n: number;
  if (i < 0) {
    base = 0;
    layer = -i;
    c = j;
    n = nj;
  } else if (i >= ni) {
    base = GHOST_LAYERS * nj;
    layer = i - ni + 1;
    c = j;
    n = nj;
  } else if (j < 0) {
    base = 2 * GHOST_LAYERS * nj;
    layer = -j;
    c = i;
    n = ni;
  } else {
    base = 2 * GHOST_LAYERS * nj + GHOST_LAYERS * ni;
    layer = j - nj + 1;
    c = i;
    n = ni;
  }
  if (layer > GHOST_LAYERS || c < 0 || c >= n) {
    throw new Error(`(${i}, ${j}) is a corner or beyond the halo of block ${blk.name}`);
  }
  return mesh.nCells + blk.ghostOffset + base + (layer - 1) * n + c;
}

export function solverMeshFromFile(file: MeshFile): SolverMesh {
  if (file.ghostLayers !== GHOST_LAYERS) {
    throw new Error(
      `the solver needs ${GHOST_LAYERS} ghost layers, the file has ${file.ghostLayers}`,
    );
  }
  const fi = faces(file.iFaceNx, file.iFaceNr, file.iFaceAreaR);
  const fj = faces(file.jFaceNx, file.jFaceNr, file.jFaceAreaR);
  const nGhosts = file.ghostSrc.length;
  const ghostNx = new Float64Array(nGhosts);
  const ghostNr = new Float64Array(nGhosts);
  const blocks: SolverBlock[] = file.blocks.map((b) => ({
    name: b.name,
    ni: b.ni,
    nj: b.nj,
    cellOffset: b.cellOffset,
    iFaceOffset: b.iFaceOffset,
    jFaceOffset: b.jFaceOffset,
    ghostOffset: b.ghostOffset,
  }));
  for (const b of blocks) {
    if (b.ni < GHOST_LAYERS || b.nj < GHOST_LAYERS) {
      throw new Error(`block ${b.name} is thinner than ${GHOST_LAYERS} cells`);
    }
    // the boundary face of each face cell, signed outward
    const set = (base: number, n: number, face: (c: number) => [number, number, number]) => {
      for (let c = 0; c < n; c++) {
        const [f, sign, kind] = face(c);
        const nx = kind === 0 ? fi.nx : fj.nx;
        const nr = kind === 0 ? fi.nr : fj.nr;
        for (let layer = 0; layer < GHOST_LAYERS; layer++) {
          const g = b.ghostOffset + base + layer * n + c;
          ghostNx[g] = sign * (nx[f] ?? NaN);
          ghostNr[g] = sign * (nr[f] ?? NaN);
        }
      }
    };
    const L = GHOST_LAYERS;
    set(0, b.nj, (j) => [b.iFaceOffset + j * (b.ni + 1), -1, 0]);
    set(L * b.nj, b.nj, (j) => [b.iFaceOffset + j * (b.ni + 1) + b.ni, 1, 0]);
    set(2 * L * b.nj, b.ni, (i) => [b.jFaceOffset + i, -1, 1]);
    set(2 * L * b.nj + L * b.ni, b.ni, (i) => [b.jFaceOffset + b.nj * b.ni + i, 1, 1]);
  }
  const f64 = (a: ArrayLike<number>): Float64Array => Float64Array.from(a);
  return {
    nCells: file.cellX.length,
    nGhosts,
    blocks,
    patches: file.patches,
    stations: file.stations,
    rows: file.rows,
    cellX: f64(file.cellX),
    cellR: f64(file.cellR),
    cellArea: f64(file.cellArea),
    cellVolR: f64(file.cellVolR),
    iNx: fi.nx,
    iNr: fi.nr,
    iArea: fi.area,
    iRf: fi.rf,
    jNx: fj.nx,
    jNr: fj.nr,
    jArea: fj.area,
    jRf: fj.rf,
    ghostSrc: Int32Array.from(file.ghostSrc),
    ghostBc: Uint8Array.from(file.ghostBc),
    ghostNx,
    ghostNr,
  };
}
