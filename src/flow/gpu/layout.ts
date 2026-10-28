// Host-side layout of the GPU solver's static buffers (docs/SOLVER.md section 2): everything the
// kernels index, built once from the solver's mesh view (src/flow/reference/solverMesh.ts, whose
// unit normals, areas and radii are computed in f64 from the asset's stored metrics) and rounded
// to f32 here, so the kernel and the oracle see the same numbers to one rounding.
//
// geo (array<vec4f>), in vec4 units:
//   [CELL_GEO + c]  (r_c, A_c, V_c, sum_f b_f S_f,x over the cell's flow faces: not slip walls)
//   [CELL_B + c]    (b_c, sum_f b_f S_f,x, sum_f b_f S_f,r, b_c V_c)   (outward face vectors)
//   [FACE + f]      (n_x, n_r, |S| = r_bar L, r_f) for the i-faces, then the j-faces
//   [EXT_B + e/4]   b of extended index e (cell, or a ghost's source cell), 4 per vec4,
//                   stored negative for a slip-wall ghost (the kernel's wall-face test)
// topo (array<vec4u>), in vec4 units:
//   [BLOCKS + 2b]   (cellOffset, ni, nj, ghostOffset), (iFaceOffset, nIFaces + jFaceOffset, 0, 0)
//   [TILES + w]     (block, tile i, tile j, 0) per stage-kernel workgroup
//   [GHOSTS + 2g]   (source 0, source 1, BC code after the remap, layer), (bits n_x, bits n_r, 0, 0)
//                   source 0 / 1 of a slip-wall ghost: the wall cell and the next cell inwards
import { BC_CODE } from '../reference/boundary';
import { GHOST_LAYERS, extIndex, type SolverMesh } from '../reference/solverMesh';

export interface Tile {
  readonly x: number;
  readonly y: number;
}

/** The default tile (D2-5: P1 measured at 16 x 8). */
export const DEFAULT_TILE: Tile = { x: 16, y: 8 };

export interface GpuLayout {
  readonly tile: Tile;
  readonly nCells: number;
  readonly nGhosts: number;
  readonly nIFaces: number;
  readonly nJFaces: number;
  /** Stage-kernel workgroups: the tiles of every block. */
  readonly workgroups: number;
  readonly geo: {
    readonly cellGeo: number;
    readonly cellB: number;
    readonly face: number;
    readonly extB: number;
    readonly size: number;
  };
  readonly topo: {
    readonly blocks: number;
    readonly tiles: number;
    readonly ghosts: number;
    readonly size: number;
  };
  /** The static geo sections (cellGeo, face); cellB and extB are written by blockageData. */
  readonly geoData: Float32Array;
  readonly topoData: Uint32Array;
  /** 1 per extended index (cells, then ghosts) that is a slip-wall ghost after the remap. */
  readonly wall: Uint8Array;
  /** Per workgroup: block, tile i, tile j (host copy of the TILES section). */
  readonly tiles: readonly { readonly block: number; readonly ti: number; readonly tj: number }[];
}

export interface LayoutOptions {
  readonly tile?: Tile;
  /** BC code -> BC code for physical ghosts (tests only, e.g. ladder L1; SOLVER.md section 5). */
  readonly bcRemap?: Readonly<Partial<Record<number, number>>>;
}

export function checkTile(t: Tile): void {
  const ok = (n: number) => Number.isInteger(n) && n >= 2;
  if (!ok(t.x) || !ok(t.y) || t.x * t.y > 256) {
    throw new Error(`unsupported tile ${t.x} x ${t.y} (integers >= 2, at most 256 threads)`);
  }
}

const f32Bits = (x: number): number => {
  const f = new Float32Array([x]);
  return new Uint32Array(f.buffer)[0] ?? 0;
};

export function buildLayout(mesh: SolverMesh, opts: LayoutOptions = {}): GpuLayout {
  const tile = opts.tile ?? DEFAULT_TILE;
  checkTile(tile);
  const nCells = mesh.nCells;
  const nGhosts = mesh.nGhosts;
  const nIFaces = mesh.iArea.length;
  const nJFaces = mesh.jArea.length;
  const nExt = nCells + nGhosts;
  const remap = (code: number): number => (code === 0 ? 0 : (opts.bcRemap?.[code] ?? code));

  const tiles: { block: number; ti: number; tj: number }[] = [];
  mesh.blocks.forEach((b, block) => {
    const nti = Math.ceil(b.ni / tile.x);
    const ntj = Math.ceil(b.nj / tile.y);
    for (let tj = 0; tj < ntj; tj++) for (let ti = 0; ti < nti; ti++) tiles.push({ block, ti, tj });
  });

  const geo = {
    cellGeo: 0,
    cellB: nCells,
    face: 2 * nCells,
    extB: 2 * nCells + nIFaces + nJFaces,
    size: 2 * nCells + nIFaces + nJFaces + Math.ceil(nExt / 4),
  };
  const geoData = new Float32Array(4 * geo.size);
  for (let c = 0; c < nCells; c++) {
    geoData.set(
      [mesh.cellR[c] ?? NaN, mesh.cellArea[c] ?? NaN, mesh.cellVolR[c] ?? NaN, 0],
      4 * (geo.cellGeo + c),
    );
  }
  const face = (k: number, nx: number, nr: number, area: number, rf: number) => {
    geoData.set([nx, nr, area, rf], 4 * (geo.face + k));
  };
  for (let f = 0; f < nIFaces; f++) {
    face(f, mesh.iNx[f] ?? NaN, mesh.iNr[f] ?? NaN, mesh.iArea[f] ?? NaN, mesh.iRf[f] ?? NaN);
  }
  for (let f = 0; f < nJFaces; f++) {
    face(
      nIFaces + f,
      mesh.jNx[f] ?? NaN,
      mesh.jNr[f] ?? NaN,
      mesh.jArea[f] ?? NaN,
      mesh.jRf[f] ?? NaN,
    );
  }

  const topo = {
    blocks: 0,
    tiles: 2 * mesh.blocks.length,
    ghosts: 2 * mesh.blocks.length + tiles.length,
    size: 2 * mesh.blocks.length + tiles.length + 2 * nGhosts,
  };
  const topoData = new Uint32Array(4 * topo.size);
  mesh.blocks.forEach((b, k) => {
    topoData.set([b.cellOffset, b.ni, b.nj, b.ghostOffset], 4 * (topo.blocks + 2 * k));
    topoData.set([b.iFaceOffset, nIFaces + b.jFaceOffset, 0, 0], 4 * (topo.blocks + 2 * k + 1));
  });
  tiles.forEach((t, w) => {
    topoData.set([t.block, t.ti, t.tj, 0], 4 * (topo.tiles + w));
  });
  const wall = new Uint8Array(nExt);
  for (let g = 0; g < nGhosts; g++) {
    const code = remap(mesh.ghostBc[g] ?? 0);
    const layer = mesh.ghostLayer[g] ?? 0;
    if (layer < 1 || layer > GHOST_LAYERS) throw new Error(`ghost ${g} has layer ${layer}`);
    const partner = mesh.ghostPartner[g] ?? 0;
    let s0 = mesh.ghostSrc[g] ?? 0;
    let s1 = s0;
    if (code === BC_CODE.SLIP_WALL) {
      wall[nCells + g] = 1;
      s0 = mesh.ghostSrc[layer === 1 ? g : partner] ?? 0;
      s1 = mesh.ghostSrc[layer === 1 ? partner : g] ?? 0;
    }
    const o = 4 * (topo.ghosts + 2 * g);
    topoData.set([s0, s1, code, layer], o);
    topoData.set([f32Bits(mesh.ghostNx[g] ?? NaN), f32Bits(mesh.ghostNr[g] ?? NaN), 0, 0], o + 4);
  }
  return {
    tile,
    nCells,
    nGhosts,
    nIFaces,
    nJFaces,
    workgroups: tiles.length,
    geo,
    topo,
    geoData,
    topoData,
    wall,
    tiles,
  };
}

/**
 * The blockage sections of geo for the field b (per cell, in (0, 1]): CELL_B, computed in f64
 * exactly as the oracle's setBlockage (the b-weighted outward face-vector sums for the pressure
 * source of section 8), and EXT_B (negative for slip-wall ghosts). Returns the two f32 ranges
 * and their vec4 offsets in geo.
 */
export function blockageData(
  mesh: SolverMesh,
  layout: GpuLayout,
  b: ArrayLike<number>,
): { cellGeo: Float32Array; cellB: Float32Array; extB: Float32Array } {
  const n = mesh.nCells;
  if (b.length !== n) throw new Error(`blockage has ${b.length} values for ${n} cells`);
  const bExt = new Float64Array(n + mesh.nGhosts);
  for (let c = 0; c < n; c++) {
    const v = b[c] ?? NaN;
    if (!(v > 0 && v <= 1)) throw new Error(`blockage of cell ${c} is ${v}, not in (0, 1]`);
    bExt[c] = v;
  }
  for (let g = 0; g < mesh.nGhosts; g++) bExt[n + g] = bExt[mesh.ghostSrc[g] ?? 0] ?? NaN;
  const cellB = new Float32Array(4 * n);
  const cellGeo = new Float32Array(4 * n);
  mesh.blocks.forEach((blk, bi) => {
    for (let j = 0; j < blk.nj; j++) {
      for (let i = 0; i < blk.ni; i++) {
        const c = blk.cellOffset + j * blk.ni + i;
        const w = blk.iFaceOffset + j * (blk.ni + 1) + i;
        const s = blk.jFaceOffset + j * blk.ni + i;
        const faces = [w, w + 1, s, s + blk.ni];
        const nbrs = [
          extIndex(mesh, bi, i - 1, j),
          extIndex(mesh, bi, i + 1, j),
          extIndex(mesh, bi, i, j - 1),
          extIndex(mesh, bi, i, j + 1),
        ];
        const bc = bExt[c] ?? NaN;
        let sx = 0;
        let sr = 0;
        let flowSx = 0;
        for (let k = 0; k < 4; k++) {
          const f = faces[k] ?? 0;
          const bf = 0.5 * (bc + (bExt[nbrs[k] ?? 0] ?? NaN));
          const iDir = k < 2;
          const sign = k % 2 === 0 ? -1 : 1;
          const area = (iDir ? mesh.iArea[f] : mesh.jArea[f]) ?? NaN;
          const fx = sign * bf * area * ((iDir ? mesh.iNx[f] : mesh.jNx[f]) ?? NaN);
          sx += fx;
          sr += sign * bf * area * ((iDir ? mesh.iNr[f] : mesh.jNr[f]) ?? NaN);
          if (layout.wall[nbrs[k] ?? 0] !== 1) flowSx += fx;
        }
        cellB.set([bc, sx, sr, bc * (mesh.cellVolR[c] ?? NaN)], 4 * c);
        cellGeo.set(
          [mesh.cellR[c] ?? NaN, mesh.cellArea[c] ?? NaN, mesh.cellVolR[c] ?? NaN, flowSx],
          4 * c,
        );
      }
    }
  });
  const extB = new Float32Array(4 * Math.ceil((n + mesh.nGhosts) / 4));
  for (let e = 0; e < n + mesh.nGhosts; e++) {
    extB[e] = layout.wall[e] === 1 ? -(bExt[e] ?? NaN) : (bExt[e] ?? NaN);
  }
  return { cellGeo, cellB, extB };
}

/**
 * D4-50: the stage kernel's storage buffers (U_in, U^n, U_out, geo, topo, reduction, the low parts,
 * the cells' beta^2 (D4-44); + the cell sources, + the test face dump; since D4-54 it computes its
 * primitives itself and no longer binds prim) against the device's
 * maxStorageBuffersPerShaderStage. A device short by one gets the packed form: the two read-only
 * static buffers (geo, topo) share one binding. Short by more: an error that says what to request.
 */
export function stageStorageBuffers(
  o: { readonly sources: boolean; readonly faceDump: boolean },
  deviceLimit: number,
  forcePacked = false,
): { buffers: number; packed: boolean } {
  const need = 8 + (o.sources ? 1 : 0) + (o.faceDump ? 1 : 0);
  if (!forcePacked && need <= deviceLimit) return { buffers: need, packed: false };
  if (need - 1 <= deviceLimit) return { buffers: need - 1, packed: true };
  throw new Error(
    `the flow solver's stage kernel needs ${need} storage buffers (${need - 1} packed) and the device allows ${deviceLimit}: request maxStorageBuffersPerShaderStage (src/gpu/device.ts FLOW_SOLVER_LIMITS, D4-50)`,
  );
}
