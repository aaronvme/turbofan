import { describe, expect, it } from 'vitest';
import {
  computeNormals,
  mergeMeshes,
  meshTopology,
  type MeshData,
} from '../../../src/geometry/mesh';

/** A unit cube with outward-facing triangles, 8 shared vertices. */
function cube(flip = false): MeshData {
  const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
  const quads = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [0, 4, 7, 3],
  ];
  const idx: number[] = [];
  for (const [a = 0, b = 0, c = 0, d = 0] of quads) {
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  }
  const positions = new Float32Array(p);
  const indices = new Uint32Array(idx);
  return {
    positions,
    indices,
    normals: computeNormals(positions, indices),
    uvs: new Float32Array(16),
    tangents: new Float32Array(32),
  };
}

const at = (a: Float32Array, i: number): number => a[i] ?? Number.NaN;

describe('meshTopology', () => {
  it('reports a closed, consistently outward cube', () => {
    const t = meshTopology(cube());
    expect(t.boundaryEdges).toBe(0);
    expect(t.nonManifoldEdges).toBe(0);
    expect(t.misorientedEdges).toBe(0);
    expect(t.degenerateTriangles).toBe(0);
    expect(t.signedVolume).toBeCloseTo(1, 6);
    expect(t.triangles).toBe(12);
    expect(t.vertices).toBe(8);
  });

  it('sees inverted winding as a negative volume', () => {
    expect(meshTopology(cube(true)).signedVolume).toBeCloseTo(-1, 6);
  });

  it('finds the hole when a face is missing', () => {
    const c = cube();
    const t = meshTopology({ ...c, indices: c.indices.slice(0, 30) });
    expect(t.boundaryEdges).toBe(4);
  });

  it('welds duplicated vertices before counting edges', () => {
    const c = cube();
    // split vertex 0 into a copy used by the first face only
    const positions = new Float32Array([...c.positions, 0, 0, 0]);
    const indices = Uint32Array.from(c.indices, (v, i) => (i < 6 && v === 0 ? 8 : v));
    const t = meshTopology({ ...c, positions, indices });
    expect(t.boundaryEdges).toBe(0);
    expect(t.vertices).toBe(8);
  });

  it('flags misoriented edges, non-manifold edges and degenerate triangles', () => {
    const c = cube();
    const flipped = Uint32Array.from(c.indices);
    const a = flipped[1] ?? 0;
    flipped[1] = flipped[2] ?? 0;
    flipped[2] = a;
    expect(meshTopology({ ...c, indices: flipped }).misorientedEdges).toBeGreaterThan(0);
    const deg = Uint32Array.from([...c.indices, 0, 0, 1]);
    expect(meshTopology({ ...c, indices: deg }).degenerateTriangles).toBe(1);
    const fin = Uint32Array.from([...c.indices, 0, 1, 6]);
    expect(meshTopology({ ...c, indices: fin }).nonManifoldEdges).toBeGreaterThan(0);
  });
});

describe('computeNormals and mergeMeshes', () => {
  it('area-weighted vertex normals are unit and point away from the cube centre', () => {
    const c = cube();
    for (let v = 0; v < 8; v++) {
      const n = [at(c.normals, 3 * v), at(c.normals, 3 * v + 1), at(c.normals, 3 * v + 2)];
      const d =
        (at(c.positions, 3 * v) - 0.5) * (n[0] ?? 0) +
        (at(c.positions, 3 * v + 1) - 0.5) * (n[1] ?? 0) +
        (at(c.positions, 3 * v + 2) - 0.5) * (n[2] ?? 0);
      expect(d).toBeGreaterThan(0);
      expect(Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0)).toBeCloseTo(1, 6);
    }
  });

  it('gives an isolated vertex a zero normal instead of NaN', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5]);
    const n = computeNormals(positions, new Uint32Array([0, 1, 2]));
    expect([n[9], n[10], n[11]]).toEqual([0, 0, 0]);
    expect(n[2]).toBeCloseTo(1, 6);
  });

  it('merges meshes with offset indices', () => {
    const m = mergeMeshes([cube(), cube()]);
    expect(m.positions.length).toBe(48);
    expect(m.indices.length).toBe(72);
    expect(m.indices[36]).toBe((m.indices[0] ?? 0) + 8);
    expect(m.tangents.length).toBe(64);
    expect(m.uvs.length).toBe(32);
    expect(mergeMeshes([]).indices.length).toBe(0);
  });
});
