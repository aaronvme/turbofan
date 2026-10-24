// Synthetic multi-block mesh for the throughput spike. It has the data shapes of the real
// body-fitted mesh (docs/PHYSICS.md, plan "Flow solver"): blocks of structured cells numbered
// block by block, per-radian r-weighted metrics, and a 2-cell ghost ring per block filled
// through an index map with boundary-condition codes. The geometry itself is a wiggled
// rectangle (x along i, r along j, axis at j = 0), not the engine flowpath.
//
// Metrics (per radian, so every "area" carries a factor r):
//   i-face (west face of cell (i, j)) from node (i, j) to (i, j+1), d = (dx, dr):
//     S_i = r_f (dr, -dx), pointing towards +i;
//   j-face (south face of cell (i, j)) from node (i, j) to (i+1, j):
//     S_j = r_f (-dr, dx), pointing towards +j;
//   r_f = mean node radius of the face. Cell volume V = integral of r dA (first moment of the
// quadrilateral) and rc = V / A. With these definitions every cell closes exactly:
//   outward sum of S = (0, A),
// which is what makes a constant gauge pressure exact against the radial source p' A.

export const BC = {
  /** Copy the source cell (block interface). */
  INTERFACE: 0,
  /** Mirror across the axis: v -> -v, w -> -w (r w unchanged). */
  AXIS: 1,
  /** Slip wall: reflect the normal velocity. */
  WALL: 2,
  /** Characteristic far field (Riemann invariants). */
  FARFIELD: 3,
  /** Subsonic: fix p = pInf; supersonic: extrapolate. */
  OUTFLOW: 4,
} as const;

export interface GridSpec {
  readonly ni: number;
  readonly nj: number;
  readonly x0: number;
  readonly x1: number;
  readonly r1: number;
  /** Interior node displacement, as a fraction of a cell (0 = Cartesian). */
  readonly wiggle: number;
}

export interface Nodes {
  readonly ni: number;
  readonly nj: number;
  readonly x: Float64Array;
  readonly r: Float64Array;
}

export function makeNodes(spec: GridSpec): Nodes {
  const { ni, nj, x0, x1, r1, wiggle } = spec;
  const x = new Float64Array((ni + 1) * (nj + 1));
  const r = new Float64Array((ni + 1) * (nj + 1));
  const dx = (x1 - x0) / ni;
  for (let j = 0; j <= nj; j++) {
    const t = j / nj;
    const bump = Math.sin(Math.PI * t); // zero on the axis and on the top boundary
    for (let i = 0; i <= ni; i++) {
      const s = i / ni;
      const k = j * (ni + 1) + i;
      x[k] = x0 + (x1 - x0) * s + wiggle * dx * Math.sin(6 * Math.PI * s) * bump;
      r[k] = r1 * t * (1 + 0.3 * wiggle * Math.sin(4 * Math.PI * s) * (1 - t));
    }
  }
  return { ni, nj, x, r };
}

function node(n: Nodes, i: number, j: number): [number, number] {
  const k = j * (n.ni + 1) + i;
  return [n.x[k] ?? Number.NaN, n.r[k] ?? Number.NaN];
}

export interface FaceVectors {
  readonly si: readonly [number, number];
  readonly sj: readonly [number, number];
  readonly rfi: number;
  readonly rfj: number;
}

/** West i-face and south j-face of logical cell (i, j); valid for i <= ni, j <= nj. */
export function faceVectors(n: Nodes, i: number, j: number): FaceVectors {
  const a = node(n, i, j);
  let si: [number, number] = [0, 0];
  let rfi = 0;
  if (j < n.nj) {
    const b = node(n, i, j + 1);
    rfi = 0.5 * (a[1] + b[1]);
    si = [rfi * (b[1] - a[1]), -rfi * (b[0] - a[0])];
  }
  let sj: [number, number] = [0, 0];
  let rfj = 0;
  if (i < n.ni) {
    const b = node(n, i + 1, j);
    rfj = 0.5 * (a[1] + b[1]);
    sj = [-rfj * (b[1] - a[1]), rfj * (b[0] - a[0])];
  }
  // Normalise -0 to 0 so faces on the axis compare equal to [0, 0].
  return { si: [si[0] + 0, si[1] + 0], sj: [sj[0] + 0, sj[1] + 0], rfi, rfj };
}

export interface CellMetrics {
  readonly vol: number;
  readonly area: number;
  readonly rc: number;
}

export function cellMetrics(n: Nodes, i: number, j: number): CellMetrics {
  const p = [node(n, i, j), node(n, i + 1, j), node(n, i + 1, j + 1), node(n, i, j + 1)];
  let area = 0;
  let vol = 0;
  for (let k = 0; k < 4; k++) {
    const [xa, ra] = p[k] ?? [0, 0];
    const [xb, rb] = p[(k + 1) % 4] ?? [0, 0];
    const cross = xa * rb - xb * ra;
    area += 0.5 * cross;
    vol += (cross * (ra + rb)) / 6;
  }
  return { vol, area, rc: vol / area };
}

export function splitSizes(n: number, parts: number): number[] {
  const base = Math.floor(n / parts);
  const extra = n % parts;
  return Array.from({ length: parts }, (_, k) => base + (k < extra ? 1 : 0));
}

export interface Block {
  readonly id: number;
  readonly i0: number;
  readonly j0: number;
  readonly ni: number;
  readonly nj: number;
  /** First global cell index. */
  readonly cellOffset: number;
  /** First face slot (of nFaceSlots) and its vec4 index in the geometry buffer. */
  readonly faceOffset: number;
  readonly faceVec4: number;
  /** First ghost entry. */
  readonly ghostOffset: number;
}

export interface Layout {
  readonly NI: number;
  readonly NJ: number;
  readonly bi: number;
  readonly bj: number;
  readonly blocks: readonly Block[];
  readonly nCells: number;
  readonly nFaceSlots: number;
  readonly nGhosts: number;
  /** Logical column/row -> owning block coordinate. */
  readonly colBlock: Int32Array;
  readonly rowBlock: Int32Array;
}

/** Ghost ring: 2 layers below and above (corners included), 2 left and right of the rows. */
export function ghostCount(ni: number, nj: number): number {
  return 4 * (ni + 4) + 4 * nj;
}

/** Slot of ghost position (i, j) of an ni x nj block; mirrored in the WGSL `ghostSlot`. */
export function ghostSlot(i: number, j: number, ni: number, nj: number): number {
  const w = ni + 4;
  if (j < 0) return (j + 2) * w + (i + 2);
  if (j >= nj) return 2 * w + (j - nj) * w + (i + 2);
  if (i < 0) return 4 * w + (i + 2) * nj + j;
  return 4 * w + 2 * nj + (i - ni) * nj + j;
}

export function makeLayout(NI: number, NJ: number, bi: number, bj: number): Layout {
  const wi = splitSizes(NI, bi);
  const wj = splitSizes(NJ, bj);
  const colBlock = new Int32Array(NI);
  const rowBlock = new Int32Array(NJ);
  const blocks: Block[] = [];
  let cellOffset = 0;
  let faceOffset = 0;
  let ghostOffset = 0;
  let j0 = 0;
  for (let q = 0; q < bj; q++) {
    const nj = wj[q] ?? 0;
    let i0 = 0;
    for (let p = 0; p < bi; p++) {
      const ni = wi[p] ?? 0;
      blocks.push({
        id: blocks.length,
        i0,
        j0,
        ni,
        nj,
        cellOffset,
        faceOffset,
        faceVec4: 0, // fixed below once nCells is known
        ghostOffset,
      });
      for (let i = i0; i < i0 + ni; i++) colBlock[i] = p;
      cellOffset += ni * nj;
      faceOffset += (ni + 1) * (nj + 1);
      ghostOffset += ghostCount(ni, nj);
      i0 += ni;
    }
    for (let j = j0; j < j0 + nj; j++) rowBlock[j] = q;
    j0 += nj;
  }
  const nCells = cellOffset;
  return {
    NI,
    NJ,
    bi,
    bj,
    blocks: blocks.map((b) => ({ ...b, faceVec4: nCells + 2 * b.faceOffset })),
    nCells,
    nFaceSlots: faceOffset,
    nGhosts: ghostOffset,
    colBlock,
    rowBlock,
  };
}

/** Global cell index of logical cell (I, J). */
export function cellIndex(layout: Layout, I: number, J: number): number {
  const p = layout.colBlock[I] ?? -1;
  const q = layout.rowBlock[J] ?? -1;
  const b = layout.blocks[q * layout.bi + p];
  if (!b) throw new Error(`cell (${I}, ${J}) is outside the layout`);
  return b.cellOffset + (J - b.j0) * b.ni + (I - b.i0);
}

/**
 * Geometry buffer (vec4 units): [cell c] = (vol, rc, 0, 0) for every global cell, then per
 * block (ni+1)(nj+1) face slots of 2 vec4: (Six, Sir, Sjx, Sjr), (rfi, rfj, 0, 0).
 */
export function buildGeometry(nodes: Nodes, layout: Layout): Float32Array {
  const geo = new Float32Array(4 * (layout.nCells + 2 * layout.nFaceSlots));
  for (const b of layout.blocks) {
    for (let j = 0; j <= b.nj; j++) {
      for (let i = 0; i <= b.ni; i++) {
        const I = b.i0 + i;
        const J = b.j0 + j;
        if (i < b.ni && j < b.nj) {
          const m = cellMetrics(nodes, I, J);
          const c = b.cellOffset + j * b.ni + i;
          geo[4 * c] = m.vol;
          geo[4 * c + 1] = m.rc;
        }
        const f = faceVectors(nodes, I, J);
        const k = 4 * (b.faceVec4 + 2 * (j * (b.ni + 1) + i));
        // A face on the block's last column/row only exists in one direction.
        const hasI = j < b.nj;
        const hasJ = i < b.ni;
        geo[k] = hasI ? f.si[0] : 0;
        geo[k + 1] = hasI ? f.si[1] : 0;
        geo[k + 2] = hasJ ? f.sj[0] : 0;
        geo[k + 3] = hasJ ? f.sj[1] : 0;
        geo[k + 4] = hasI ? f.rfi : 0;
        geo[k + 5] = hasJ ? f.rfj : 0;
      }
    }
  }
  return geo;
}

export interface BoundarySpec {
  /** Logical column range [from, to) of the top boundary that is a slip wall. */
  readonly wallTop?: readonly [number, number];
}

function unit(v: readonly [number, number], sign: number): [number, number] {
  const len = Math.hypot(v[0], v[1]);
  return [(sign * v[0]) / len, (sign * v[1]) / len];
}

/** Ghost index map: 4 x u32 per entry (source cell, BC code, f32 bits of nx, nr). */
export function buildGhosts(nodes: Nodes, layout: Layout, spec: BoundarySpec): Uint32Array {
  const out = new Uint32Array(4 * layout.nGhosts);
  const f32 = new Float32Array(out.buffer);
  const { NI, NJ } = layout;
  const clampI = (I: number) => Math.min(NI - 1, Math.max(0, I));
  const clampJ = (J: number) => Math.min(NJ - 1, Math.max(0, J));
  const isWall = (I: number) =>
    spec.wallTop !== undefined && I >= spec.wallTop[0] && I < spec.wallTop[1];

  for (const b of layout.blocks) {
    for (let j = -2; j < b.nj + 2; j++) {
      for (let i = -2; i < b.ni + 2; i++) {
        if (i >= 0 && i < b.ni && j >= 0 && j < b.nj) continue;
        const I = b.i0 + i;
        const J = b.j0 + j;
        let src: number;
        let code: number;
        let n: [number, number] = [0, 0];
        if (I >= 0 && I < NI && J >= 0 && J < NJ) {
          src = cellIndex(layout, I, J);
          code = BC.INTERFACE;
        } else if (J < 0) {
          src = cellIndex(layout, clampI(I), -1 - J);
          code = BC.AXIS;
          n = [0, -1];
        } else if (J >= NJ) {
          const col = clampI(I);
          n = unit(faceVectors(nodes, col, NJ).sj, 1);
          if (isWall(col)) {
            src = cellIndex(layout, col, 2 * NJ - 1 - J);
            code = BC.WALL;
          } else {
            src = cellIndex(layout, col, NJ - 1);
            code = BC.FARFIELD;
          }
        } else if (I < 0) {
          src = cellIndex(layout, 0, clampJ(J));
          code = BC.FARFIELD;
          n = unit(faceVectors(nodes, 0, clampJ(J)).si, -1);
        } else {
          src = cellIndex(layout, NI - 1, clampJ(J));
          code = BC.OUTFLOW;
          n = unit(faceVectors(nodes, NI, clampJ(J)).si, 1);
        }
        const k = 4 * (b.ghostOffset + ghostSlot(i, j, b.ni, b.nj));
        out[k] = src;
        out[k + 1] = code;
        f32[k + 2] = n[0];
        f32[k + 3] = n[1];
      }
    }
  }
  return out;
}

export interface Tile {
  readonly x: number;
  readonly y: number;
}

export interface Topology {
  /** vec4<u32> entries: block descriptors, tiles, ghosts. */
  readonly data: Uint32Array;
  readonly wgBase: number;
  readonly ghostBase: number;
  readonly workgroups: number;
}

/**
 * The u32 table the kernel indexes: per block (cellOffset, ni, nj, ghostOffset) and
 * (faceVec4, 0, 0, 0); then one (block, tileI, tileJ, 0) per workgroup; then the ghost map.
 */
export function buildTopology(layout: Layout, ghosts: Uint32Array, tile: Tile): Topology {
  const tiles: number[] = [];
  for (const b of layout.blocks) {
    const tx = Math.ceil(b.ni / tile.x);
    const ty = Math.ceil(b.nj / tile.y);
    for (let tj = 0; tj < ty; tj++) for (let ti = 0; ti < tx; ti++) tiles.push(b.id, ti, tj, 0);
  }
  const wgBase = 2 * layout.blocks.length;
  const workgroups = tiles.length / 4;
  const ghostBase = wgBase + workgroups;
  const data = new Uint32Array(4 * ghostBase + ghosts.length);
  layout.blocks.forEach((b, k) => {
    data.set([b.cellOffset, b.ni, b.nj, b.ghostOffset, b.faceVec4, 0, 0, 0], 8 * k);
  });
  data.set(tiles, 4 * wgBase);
  data.set(ghosts, 4 * ghostBase);
  return { data, wgBase, ghostBase, workgroups };
}
