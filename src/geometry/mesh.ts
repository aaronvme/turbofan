// Indexed triangle meshes as plain typed arrays (worker-transferable, no three.js), plus the
// checks the geometry tests rely on: watertightness, orientation and volume.

import { ix } from './num';

export interface MeshData {
  /** xyz per vertex, m (engine frame: x axial, y = r cos theta, z = r sin theta). */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** uv per vertex. */
  readonly uvs: Float32Array;
  /** xyzw per vertex (w = handedness, +1). */
  readonly tangents: Float32Array;
  readonly indices: Uint32Array;
}

export interface MeshTopology {
  /** Distinct vertex positions (after welding exact duplicates). */
  readonly vertices: number;
  readonly triangles: number;
  /** Edges used by one triangle only (holes). */
  readonly boundaryEdges: number;
  /** Edges used by more than two triangles. */
  readonly nonManifoldEdges: number;
  /** Edges whose two triangles traverse them in the same direction (inconsistent winding). */
  readonly misorientedEdges: number;
  /** Triangles with a repeated vertex or (near) zero area. */
  readonly degenerateTriangles: number;
  /** Divergence-theorem volume, m^3: positive for a closed, outward-facing surface. */
  readonly signedVolume: number;
}

/** Triangles smaller than this are degenerate, m^2 (well below a 0.05 mm x 0.05 mm sliver). */
const DEGENERATE_AREA = 1e-15;

/** Edge and volume statistics, welding vertices that share a position. */
export function meshTopology(mesh: Pick<MeshData, 'positions' | 'indices'>): MeshTopology {
  const p = mesh.positions;
  const nVert = p.length / 3;
  const weld = new Int32Array(nVert);
  const keys = new Map<string, number>();
  for (let v = 0; v < nVert; v++) {
    const key = `${p[3 * v]},${p[3 * v + 1]},${p[3 * v + 2]}`;
    let id = keys.get(key);
    if (id === undefined) {
      id = keys.size;
      keys.set(key, id);
    }
    weld[v] = id;
  }
  const n = keys.size;
  const forward = new Map<number, number>();
  const backward = new Map<number, number>();
  const idx = mesh.indices;
  let degenerate = 0;
  let volume = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = ix(idx, t);
    const i1 = ix(idx, t + 1);
    const i2 = ix(idx, t + 2);
    const w = [ix(weld, i0), ix(weld, i1), ix(weld, i2)] as const;
    const ax = ix(p, 3 * i0);
    const ay = ix(p, 3 * i0 + 1);
    const az = ix(p, 3 * i0 + 2);
    const bx = ix(p, 3 * i1);
    const by = ix(p, 3 * i1 + 1);
    const bz = ix(p, 3 * i1 + 2);
    const cx = ix(p, 3 * i2);
    const cy = ix(p, 3 * i2 + 1);
    const cz = ix(p, 3 * i2 + 2);
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (w[0] === w[1] || w[1] === w[2] || w[0] === w[2] || area < DEGENERATE_AREA) degenerate++;
    for (let e = 0; e < 3; e++) {
      const a = ix(w, e);
      const b = ix(w, (e + 1) % 3);
      if (a === b) continue;
      const map = a < b ? forward : backward;
      const key = Math.min(a, b) * n + Math.max(a, b);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  let misoriented = 0;
  const edges = new Set([...forward.keys(), ...backward.keys()]);
  for (const key of edges) {
    const f = forward.get(key) ?? 0;
    const b = backward.get(key) ?? 0;
    const uses = f + b;
    if (uses === 1) boundary++;
    else if (uses > 2) nonManifold++;
    else if (f === 2 || b === 2) misoriented++;
  }
  return {
    vertices: n,
    triangles: Math.floor(idx.length / 3),
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    misorientedEdges: misoriented,
    degenerateTriangles: degenerate,
    signedVolume: volume,
  };
}

/** Area-weighted vertex normals (unit; zero for a vertex no triangle uses). */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const acc = new Float64Array(positions.length);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = ix(indices, t);
    const i1 = ix(indices, t + 1);
    const i2 = ix(indices, t + 2);
    const ux = ix(positions, 3 * i1) - ix(positions, 3 * i0);
    const uy = ix(positions, 3 * i1 + 1) - ix(positions, 3 * i0 + 1);
    const uz = ix(positions, 3 * i1 + 2) - ix(positions, 3 * i0 + 2);
    const vx = ix(positions, 3 * i2) - ix(positions, 3 * i0);
    const vy = ix(positions, 3 * i2 + 1) - ix(positions, 3 * i0 + 1);
    const vz = ix(positions, 3 * i2 + 2) - ix(positions, 3 * i0 + 2);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [i0, i1, i2]) {
      acc[3 * i] = ix(acc, 3 * i) + nx;
      acc[3 * i + 1] = ix(acc, 3 * i + 1) + ny;
      acc[3 * i + 2] = ix(acc, 3 * i + 2) + nz;
    }
  }
  const out = new Float32Array(positions.length);
  for (let v = 0; v < positions.length / 3; v++) {
    const x = ix(acc, 3 * v);
    const y = ix(acc, 3 * v + 1);
    const z = ix(acc, 3 * v + 2);
    const len = Math.hypot(x, y, z);
    if (len > 0) {
      out[3 * v] = x / len;
      out[3 * v + 1] = y / len;
      out[3 * v + 2] = z / len;
    }
  }
  return out;
}

/** Concatenates meshes (indices offset). */
export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  const total = (f: (m: MeshData) => ArrayLike<number>) =>
    meshes.reduce((s, m) => s + f(m).length, 0);
  const positions = new Float32Array(total((m) => m.positions));
  const normals = new Float32Array(total((m) => m.normals));
  const uvs = new Float32Array(total((m) => m.uvs));
  const tangents = new Float32Array(total((m) => m.tangents));
  const indices = new Uint32Array(total((m) => m.indices));
  let pv = 0;
  let pu = 0;
  let pt = 0;
  let pi = 0;
  for (const m of meshes) {
    positions.set(m.positions, pv);
    normals.set(m.normals, pv);
    uvs.set(m.uvs, pu);
    tangents.set(m.tangents, pt);
    const base = pv / 3;
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = ix(m.indices, i) + base;
    pv += m.positions.length;
    pu += m.uvs.length;
    pt += m.tangents.length;
    pi += m.indices.length;
  }
  return { positions, normals, uvs, tangents, indices };
}

/** Reverses every triangle's winding in place (and the normals). */
export function flipMesh(mesh: MeshData): void {
  const idx = mesh.indices;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = ix(idx, t + 1);
    idx[t + 1] = ix(idx, t + 2);
    idx[t + 2] = a;
  }
  for (let i = 0; i < mesh.normals.length; i++) mesh.normals[i] = -ix(mesh.normals, i);
}
