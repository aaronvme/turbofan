// Shared types for the offline multi-block mesher (tools/mesh). Everything is SI: metres in the
// meridional (x, r) plane, x axial with x = 0 at the fan face (station 2), positive downstream,
// r >= 0 from the engine axis.

/** A point in the meridional plane. */
export interface Pt {
  readonly x: number;
  readonly r: number;
}

/**
 * Boundary-condition codes stored per patch and per ghost cell. The numeric values are part of the
 * binary format (docs/MESH.md), so never renumber them; add new codes at the end.
 */
export const BC = {
  /** Point-matched block interface: the ghost is an index copy of the neighbour's interior cell. */
  INTERFACE: 0,
  /** Inviscid slip wall (losses are carried by the body force, not the wall). */
  SLIP_WALL: 1,
  /** Engine axis r = 0: mirror ghost cells. */
  AXIS: 2,
  /** Far-field lateral boundary r = r_out: characteristic. */
  FARFIELD: 3,
  /** Upstream far-field boundary x = x_in: characteristic, freestream total conditions. */
  INFLOW: 4,
  /** Downstream far-field boundary x = x_out: characteristic, ambient static pressure. */
  OUTFLOW: 5,
} as const;
export type BcCode = (typeof BC)[keyof typeof BC];

export const BC_NAMES: Readonly<Record<BcCode, string>> = {
  0: 'interface',
  1: 'slip-wall',
  2: 'axis',
  3: 'farfield',
  4: 'inflow',
  5: 'outflow',
};

/** Block faces in index space. imin/imax are lines of constant i (nodes run along j). */
export type Face = 'imin' | 'imax' | 'jmin' | 'jmax';
export const FACES: readonly Face[] = ['imin', 'imax', 'jmin', 'jmax'];

/**
 * A structured block of ni x nj cells, (ni+1) x (nj+1) nodes stored i-fastest:
 * node (i, j) is at index j * (ni + 1) + i. Every block is right-handed in (x, r):
 * (dX/di x dX/dj) > 0, which the metrics and the ghost map rely on.
 */
export interface Block {
  readonly name: string;
  readonly ni: number;
  readonly nj: number;
  readonly x: Float64Array;
  readonly r: Float64Array;
}

/** The far side of an interface patch. start -> end maps onto the owning patch's start -> end. */
export interface PatchNeighbour {
  readonly block: number;
  readonly face: Face;
  /** Node index on the neighbour face matching the owning patch's `start` (may be > `end`). */
  readonly start: number;
  readonly end: number;
}

/**
 * A contiguous range of a block face with one boundary condition. Node indices run along the face
 * (j for imin/imax, i for jmin/jmax); the patch covers nodes start..end (start < end), i.e. cells
 * start..end-1. Interfaces are stored once per side, each with `nbr` pointing at the other side.
 */
export interface Patch {
  readonly block: number;
  readonly face: Face;
  readonly start: number;
  readonly end: number;
  readonly bc: BcCode;
  /** Human label for walls and boundaries ("hub", "nacelle-outer", ...). */
  readonly label: string;
  readonly nbr?: PatchNeighbour;
  /**
   * Interface only: whether elliptic smoothing may move this interface's interior nodes (both
   * copies move together and stay bitwise equal). Station planes (fan face, splitter, nozzle exits)
   * are not floating, so they stay exactly where the geometry put them.
   */
  readonly floating?: boolean;
}

export interface MultiBlockMesh {
  readonly blocks: Block[];
  readonly patches: Patch[];
}

/** Node index of (i, j) in a block's arrays. */
export function nodeIndex(block: Pick<Block, 'ni'>, i: number, j: number): number {
  return j * (block.ni + 1) + i;
}
