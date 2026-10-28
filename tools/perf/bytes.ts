// A static count of the bytes each dispatch of one tracking iteration reads and writes (D4-54), from
// the layout and the WGSL's loads (no GPU). "upper": every load from memory, with no reuse across
// workgroups (the halo re-reads included); "unique": each element once (perfect cache reuse). The
// real DRAM traffic lies between. Update the record sizes here when the kernels' loads change.
import type { SolverMesh } from '../../src/flow/reference/solverMesh';

export interface KernelBytesModel {
  /** Bytes of one cell's primitive record read by the stage kernel's halo load. */
  readonly haloRecord: number;
  /** Bytes of one primitive record written by the prim/ghost pass. */
  readonly primRecord: number;
  /** Bytes the stage kernel reads per halo entry for b (extB). */
  readonly haloB: number;
  /** The stage kernel's own per-cell reads of the cell-only record (T', c and p', Z), bytes. */
  readonly cellOnly: number;
}

/** The kernel as merged (c661d5c): two vec4 per record everywhere, extB as a vec4 load. */
export const BASE_MODEL: KernelBytesModel = {
  haloRecord: 32,
  primRecord: 32,
  haloB: 16,
  cellOnly: 16,
};

interface LayoutLike {
  readonly nCells: number;
  readonly nGhosts: number;
  readonly workgroups: number;
  readonly tile?: { readonly x: number; readonly y: number };
}

export function haloAndFaces(
  mesh: SolverMesh,
  tile: { readonly x: number; readonly y: number },
): { halo: number; faces: number; workgroups: number } {
  let halo = 0;
  let faces = 0;
  let workgroups = 0;
  for (const b of mesh.blocks) {
    for (let i0 = 0; i0 < b.ni; i0 += tile.x) {
      for (let j0 = 0; j0 < b.nj; j0 += tile.y) {
        workgroups++;
        for (let jj = -2; jj < tile.y + 2; jj++) {
          for (let ii = -2; ii < tile.x + 2; ii++) {
            const gi = i0 + ii;
            const gj = j0 + jj;
            const inI = gi >= 0 && gi < b.ni;
            const inJ = gj >= 0 && gj < b.nj;
            if (
              (inI && inJ) ||
              (inJ && gi >= -2 && gi <= b.ni + 1) ||
              (inI && gj >= -2 && gj <= b.nj + 1)
            ) {
              halo++;
            }
          }
        }
        for (let fy = 0; fy < tile.y; fy++) {
          for (let fx = 0; fx <= tile.x; fx++) if (i0 + fx <= b.ni && j0 + fy < b.nj) faces++;
        }
        for (let fy = 0; fy <= tile.y; fy++) {
          for (let fx = 0; fx < tile.x; fx++) if (i0 + fx < b.ni && j0 + fy <= b.nj) faces++;
        }
      }
    }
  }
  return { halo, faces, workgroups };
}

/** MB per dispatch kind and stage of one tracking iteration (upper and unique). */
export function dispatchBytes(
  mesh: SolverMesh,
  layout: LayoutLike,
  model: KernelBytesModel = BASE_MODEL,
): Record<string, { upperMB: number; uniqueMB: number }> {
  const tile = layout.tile ?? { x: 16, y: 8 };
  const n = layout.nCells;
  const g = layout.nGhosts;
  const nFaces = mesh.iArea.length + mesh.jArea.length;
  const { halo, faces } = haloAndFaces(mesh, tile);
  const mb = (b: number) => +(b / 1e6).toFixed(2);
  // prim: U (2 vec4) + CELL_GEO (vec4) in, the record out
  const prim = n * (32 + 16 + model.primRecord);
  // ghost: topo (2 vec4u) + 1-2 source records in (the wall ghosts read two), the record out
  const ghost = g * (32 + 1.5 * model.primRecord + model.primRecord);
  // stage: the halo (record + b), one FACE vec4 per face, per cell the cell-only record, CELL_GEO,
  // CELL_B, U_in, U^n (2 vec4 each) in and U_out out; stage 1 the 4 FACE vec4 of the time step;
  // stage 3 the low parts in and out
  const perCell = model.cellOnly + 32 + 64 + 32;
  const stageUpper = (s: number) =>
    halo * (model.haloRecord + model.haloB) +
    faces * 16 +
    n * perCell +
    (s === 0 ? n * 64 : 0) +
    (s === 2 ? n * 64 : 0);
  const stageUnique = (s: number) =>
    (n + g) * (model.haloRecord + 4) + nFaces * 16 + n * perCell + (s === 2 ? n * 64 : 0);
  const out: Record<string, { upperMB: number; uniqueMB: number }> = {};
  let up = 0;
  let un = 0;
  for (let s = 0; s < 3; s++) {
    out[`prim s${s + 1}`] = { upperMB: mb(prim), uniqueMB: mb(prim) };
    out[`ghost s${s + 1}`] = { upperMB: mb(ghost), uniqueMB: mb(ghost) };
    out[`stage s${s + 1}`] = { upperMB: mb(stageUpper(s)), uniqueMB: mb(stageUnique(s)) };
    up += prim + ghost + stageUpper(s);
    un += prim + ghost + stageUnique(s);
  }
  out.total = { upperMB: mb(up), uniqueMB: mb(un) };
  return out;
}
