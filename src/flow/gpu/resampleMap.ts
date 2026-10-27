// The render resample's texel map (contracts FieldExtent, decision D0-4): for every texel of a
// uniform (x, r) raster, up to four cells and their weights, and the texel's fluid fraction.
// Built once on the host from the mesh nodes; the GPU resample kernel then interpolates the
// solver's primitives with it every frame.
//
// - Point location: the cell whose quad contains the texel centre (inverse bilinear map), found
//   through a bucket grid over the extent.
// - Weights: cell-centred bilinear in the cell's index space. The texel lies in one quadrant of its
//   cell (xi, eta about 1/2); the neighbours towards it in i and j, and the diagonal one, take the
//   weights tx = |xi - 1/2|, ty = |eta - 1/2|. Across a block interface the neighbour is the other
//   block's cell (the interface ghost's source); at a physical boundary the cell itself (constant
//   extrapolation to the wall). Where the diagonal cell is outside the block (a block corner), the
//   weights are planar: c 1 - tx - ty, the i neighbour tx, the j neighbour ty.
// - Fluid fraction: the share of the texel's 4 corners and its centre that lie inside a cell. A
//   texel whose centre is in solid but a corner in fluid takes that corner's cell, so filtering near
//   a wall sees fluid values; a texel with no sample in fluid has no cell (the kernel writes the
//   exact ambient there).
import type { FieldExtent } from '../../contracts/flow';
import type { MeshFile } from '../mesh/meshFile';
import { extIndex, type SolverMesh } from '../reference/solverMesh';

export const NO_CELL = 0xffffffff;

export interface ResampleMap {
  readonly extent: FieldExtent;
  /** 4 cells per texel (row-major, j = 0 next to the axis); NO_CELL when there is none. */
  readonly cells: Uint32Array;
  /** Per texel (w0, w1, w2, fluid fraction); the fourth weight is 1 - w0 - w1 - w2. */
  readonly weights: Float32Array;
}

export interface CellHit {
  readonly cell: number;
  readonly block: number;
  readonly i: number;
  readonly j: number;
  /** Local coordinates in the cell's quad, in [0, 1]. */
  readonly xi: number;
  readonly eta: number;
}

const TOL = 1e-9;

/** Inverse bilinear map of (x, r) in the quad (p00, p10, p11, p01); null if it does not converge. */
function inverseBilinear(
  q: readonly number[],
  x: number,
  r: number,
): { xi: number; eta: number } | null {
  const [x00, r00, x10, r10, x11, r11, x01, r01] = q as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  let xi = 0.5;
  let eta = 0.5;
  for (let k = 0; k < 20; k++) {
    const fx =
      (1 - xi) * (1 - eta) * x00 + xi * (1 - eta) * x10 + xi * eta * x11 + (1 - xi) * eta * x01 - x;
    const fr =
      (1 - xi) * (1 - eta) * r00 + xi * (1 - eta) * r10 + xi * eta * r11 + (1 - xi) * eta * r01 - r;
    const a = (1 - eta) * (x10 - x00) + eta * (x11 - x01);
    const b = (1 - xi) * (x01 - x00) + xi * (x11 - x10);
    const c = (1 - eta) * (r10 - r00) + eta * (r11 - r01);
    const d = (1 - xi) * (r01 - r00) + xi * (r11 - r10);
    const det = a * d - b * c;
    if (!(Math.abs(det) > 0)) return null;
    const dxi = (d * fx - b * fr) / det;
    const deta = (a * fr - c * fx) / det;
    xi -= dxi;
    eta -= deta;
    if (Math.abs(dxi) + Math.abs(deta) < 1e-13) break;
  }
  return Number.isFinite(xi) && Number.isFinite(eta) ? { xi, eta } : null;
}

/** A bucket grid of the mesh cells over a rectangle, for point location. */
export class CellLocator {
  private readonly file: MeshFile;
  private readonly x0: number;
  private readonly r0: number;
  private readonly h: number;
  private readonly nx: number;
  private readonly nr: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  /** Per cell: block, i, j (for the hit record). */
  private readonly cellBlock: Int32Array;

  constructor(
    file: MeshFile,
    bounds: { xMin: number; xMax: number; rMin: number; rMax: number },
    bucket: number,
  ) {
    this.file = file;
    this.x0 = bounds.xMin;
    this.r0 = bounds.rMin;
    this.h = bucket;
    this.nx = Math.max(1, Math.ceil((bounds.xMax - bounds.xMin) / bucket));
    this.nr = Math.max(1, Math.ceil((bounds.rMax - bounds.rMin) / bucket));
    const nCells = file.cellX.length;
    this.cellBlock = new Int32Array(nCells);
    const counts = new Int32Array(this.nx * this.nr + 1);
    const ranges: number[] = [];
    file.blocks.forEach((b, bi) => {
      for (let j = 0; j < b.nj; j++) {
        for (let i = 0; i < b.ni; i++) {
          const c = b.cellOffset + j * b.ni + i;
          this.cellBlock[c] = bi;
          const q = this.quad(c);
          let lx = Infinity;
          let hx = -Infinity;
          let lr = Infinity;
          let hr = -Infinity;
          for (let k = 0; k < 4; k++) {
            lx = Math.min(lx, q[2 * k] ?? NaN);
            hx = Math.max(hx, q[2 * k] ?? NaN);
            lr = Math.min(lr, q[2 * k + 1] ?? NaN);
            hr = Math.max(hr, q[2 * k + 1] ?? NaN);
          }
          const i0 = Math.max(0, Math.floor((lx - this.x0) / bucket - TOL));
          const i1 = Math.min(this.nx - 1, Math.floor((hx - this.x0) / bucket + TOL));
          const j0 = Math.max(0, Math.floor((lr - this.r0) / bucket - TOL));
          const j1 = Math.min(this.nr - 1, Math.floor((hr - this.r0) / bucket + TOL));
          if (i1 < i0 || j1 < j0) continue;
          ranges.push(c, i0, i1, j0, j1);
          for (let jj = j0; jj <= j1; jj++)
            for (let ii = i0; ii <= i1; ii++) {
              const s = jj * this.nx + ii + 1;
              counts[s] = (counts[s] ?? 0) + 1;
            }
        }
      }
    });
    for (let k = 1; k < counts.length; k++) counts[k] = (counts[k] ?? 0) + (counts[k - 1] ?? 0);
    this.start = counts;
    this.items = new Int32Array(counts[counts.length - 1] ?? 0);
    const fill = Int32Array.from(counts);
    for (let k = 0; k < ranges.length; k += 5) {
      const [c, i0, i1, j0, j1] = ranges.slice(k, k + 5) as [
        number,
        number,
        number,
        number,
        number,
      ];
      for (let jj = j0; jj <= j1; jj++) {
        for (let ii = i0; ii <= i1; ii++) {
          const s = jj * this.nx + ii;
          this.items[fill[s] ?? 0] = c;
          fill[s] = (fill[s] ?? 0) + 1;
        }
      }
    }
  }

  /** Node coordinates of cell c: (x, r) of nodes (i, j), (i+1, j), (i+1, j+1), (i, j+1). */
  private quad(c: number): number[] {
    const f = this.file;
    let bi = 0;
    while (bi + 1 < f.blocks.length && (f.blocks[bi + 1]?.cellOffset ?? Infinity) <= c) bi++;
    const b = f.blocks[bi];
    if (b === undefined) throw new Error('no block');
    const local = c - b.cellOffset;
    const i = local % b.ni;
    const j = Math.floor(local / b.ni);
    const n = (ii: number, jj: number) => b.nodeOffset + jj * (b.ni + 1) + ii;
    const out: number[] = [];
    for (const [ii, jj] of [
      [i, j],
      [i + 1, j],
      [i + 1, j + 1],
      [i, j + 1],
    ] as const) {
      out.push(f.nodeX[n(ii, jj)] ?? NaN, f.nodeR[n(ii, jj)] ?? NaN);
    }
    return out;
  }

  locate(x: number, r: number): CellHit | null {
    const ii = Math.floor((x - this.x0) / this.h);
    const jj = Math.floor((r - this.r0) / this.h);
    if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nr) return null;
    const s = jj * this.nx + ii;
    for (let k = this.start[s] ?? 0; k < (this.start[s + 1] ?? 0); k++) {
      const c = this.items[k] ?? 0;
      const loc = inverseBilinear(this.quad(c), x, r);
      if (loc === null) continue;
      if (loc.xi < -TOL || loc.xi > 1 + TOL || loc.eta < -TOL || loc.eta > 1 + TOL) continue;
      const bi = this.cellBlock[c] ?? 0;
      const b = this.file.blocks[bi];
      if (b === undefined) continue;
      const local = c - b.cellOffset;
      return {
        cell: c,
        block: bi,
        i: local % b.ni,
        j: Math.floor(local / b.ni),
        xi: Math.min(1, Math.max(0, loc.xi)),
        eta: Math.min(1, Math.max(0, loc.eta)),
      };
    }
    return null;
  }
}

const locators = new WeakMap<MeshFile, CellLocator>();

/** The cell containing (x, r), over the whole mesh (a locator cached per file). */
export function locateCell(file: MeshFile, x: number, r: number): CellHit | null {
  let loc = locators.get(file);
  if (loc === undefined) {
    let xMin = Infinity;
    let xMax = -Infinity;
    let rMax = 0;
    for (let k = 0; k < file.nodeX.length; k++) {
      xMin = Math.min(xMin, file.nodeX[k] ?? NaN);
      xMax = Math.max(xMax, file.nodeX[k] ?? NaN);
      rMax = Math.max(rMax, file.nodeR[k] ?? NaN);
    }
    const bucket = Math.sqrt(((xMax - xMin) * rMax) / Math.max(1, file.cellX.length)) * 4;
    loc = new CellLocator(file, { xMin, xMax, rMin: 0, rMax }, bucket);
    locators.set(file, loc);
  }
  return loc.locate(x, r);
}

/** The cell at (i, j) of block b, the neighbour block's cell across an interface, or null. */
function cellAt(mesh: SolverMesh, b: number, i: number, j: number): number | null {
  const blk = mesh.blocks[b];
  if (blk === undefined) return null;
  if (i >= 0 && i < blk.ni && j >= 0 && j < blk.nj) return blk.cellOffset + j * blk.ni + i;
  const outI = i < 0 || i >= blk.ni;
  const outJ = j < 0 || j >= blk.nj;
  if (outI && outJ) return null;
  const g = extIndex(mesh, b, i, j) - mesh.nCells;
  return mesh.ghostBc[g] === 0 ? (mesh.ghostSrc[g] ?? null) : null;
}

export function buildResampleMap(
  file: MeshFile,
  mesh: SolverMesh,
  extent: FieldExtent,
): ResampleMap {
  const W = extent.width;
  const H = extent.height;
  const dx = (extent.xMax - extent.xMin) / W;
  const dr = (extent.rMax - extent.rMin) / H;
  const locator = new CellLocator(
    file,
    { xMin: extent.xMin, xMax: extent.xMax + dx, rMin: extent.rMin, rMax: extent.rMax + dr },
    2 * Math.max(dx, dr),
  );
  // corners of the texel grid, shared by up to four texels
  const cornerCell = new Uint32Array((W + 1) * (H + 1)).fill(NO_CELL);
  for (let j = 0; j <= H; j++) {
    for (let i = 0; i <= W; i++) {
      const hit = locator.locate(extent.xMin + i * dx, extent.rMin + j * dr);
      if (hit !== null) cornerCell[j * (W + 1) + i] = hit.cell;
    }
  }
  const cells = new Uint32Array(4 * W * H).fill(NO_CELL);
  const weights = new Float32Array(4 * W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const t = j * W + i;
      const corners = [
        cornerCell[j * (W + 1) + i],
        cornerCell[j * (W + 1) + i + 1],
        cornerCell[(j + 1) * (W + 1) + i],
        cornerCell[(j + 1) * (W + 1) + i + 1],
      ].filter((c): c is number => c !== undefined && c !== NO_CELL);
      const hit = locator.locate(extent.xMin + (i + 0.5) * dx, extent.rMin + (j + 0.5) * dr);
      const fluid = (corners.length + (hit === null ? 0 : 1)) / 5;
      weights[4 * t + 3] = fluid;
      if (hit === null) {
        const c = corners[0];
        if (c !== undefined) cells.fill(c, 4 * t, 4 * t + 4);
        weights[4 * t] = c === undefined ? 0 : 1;
        continue;
      }
      const di = hit.xi >= 0.5 ? 1 : -1;
      const dj = hit.eta >= 0.5 ? 1 : -1;
      const tx = Math.abs(hit.xi - 0.5);
      const ty = Math.abs(hit.eta - 0.5);
      const c = hit.cell;
      const ni = cellAt(mesh, hit.block, hit.i + di, hit.j) ?? c;
      const nj = cellAt(mesh, hit.block, hit.i, hit.j + dj) ?? c;
      const blk = mesh.blocks[hit.block];
      const inside =
        blk !== undefined &&
        hit.i + di >= 0 &&
        hit.i + di < blk.ni &&
        hit.j + dj >= 0 &&
        hit.j + dj < blk.nj;
      const diag = inside ? (cellAt(mesh, hit.block, hit.i + di, hit.j + dj) ?? c) : c;
      cells.set([c, ni, nj, diag], 4 * t);
      if (inside) {
        weights.set([(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty], 4 * t);
      } else {
        weights.set([1 - tx - ty, tx, ty], 4 * t);
      }
    }
  }
  return { extent, cells, weights };
}
