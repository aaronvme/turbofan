// Small meshes for the reference-solver tests and the CPU ladder, built with the offline mesher's
// types and turned into the solver's mesh through the real binary format path
// (meshFileFromMesh -> solverMeshFromFile), so every test exercises the asset layout.
import { meshFileFromMesh } from '../../../tools/mesh/format';
import { connect, validateMesh } from '../../../tools/mesh/topology';
import {
  BC,
  type BcCode,
  type Block,
  type Face,
  type MultiBlockMesh,
  type Patch,
  type Pt,
} from '../../../tools/mesh/types';
import { solverMeshFromFile, type SolverMesh } from '../../../src/flow/reference/solverMesh';

/** A block of ni x nj cells whose node (i, j) is at(i, j); must be right-handed in (x, r). */
export function gridBlock(
  name: string,
  ni: number,
  nj: number,
  at: (i: number, j: number) => Pt,
): Block {
  const x = new Float64Array((ni + 1) * (nj + 1));
  const r = new Float64Array((ni + 1) * (nj + 1));
  for (let j = 0; j <= nj; j++) {
    for (let i = 0; i <= ni; i++) {
      const p = at(i, j);
      x[j * (ni + 1) + i] = p.x;
      r[j * (ni + 1) + i] = p.r;
    }
  }
  return { name, ni, nj, x, r };
}

export type FaceBcs = Readonly<Record<Face, BcCode>>;

/** Physical-boundary patches covering every face of block `block` with one BC each. */
export function facePatches(b: Block, block: number, bcs: Partial<FaceBcs>): Patch[] {
  const out: Patch[] = [];
  for (const face of ['imin', 'imax', 'jmin', 'jmax'] as const) {
    const bc = bcs[face];
    if (bc === undefined) continue;
    const n = face === 'imin' || face === 'imax' ? b.nj : b.ni;
    out.push({ block, face, start: 0, end: n, bc, label: `${b.name}-${face}` });
  }
  return out;
}

export function singleBlock(b: Block, bcs: FaceBcs): MultiBlockMesh {
  return { blocks: [b], patches: facePatches(b, 0, bcs) };
}

/** The solver mesh of a multi-block mesh, through the asset format (f64 metrics by default). */
export function solverMesh(mesh: MultiBlockMesh, precision: 'f64' | 'f32' = 'f64'): SolverMesh {
  const problems = validateMesh(mesh);
  if (problems.length > 0)
    throw new Error(`test mesh is invalid: ${problems.slice(0, 3).join('; ')}`);
  return solverMeshFromFile(meshFileFromMesh(mesh, precision));
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** Rectangle [x0, x1] x [r0, r1]; optional maps of the unit coordinates (clustering). */
export function rectangle(
  name: string,
  x0: number,
  x1: number,
  r0: number,
  r1: number,
  ni: number,
  nj: number,
  map: { x?: (u: number) => number; r?: (v: number) => number } = {},
): Block {
  const fx = map.x ?? ((u: number) => u);
  const fr = map.r ?? ((v: number) => v);
  return gridBlock(name, ni, nj, (i, j) => ({
    x: lerp(x0, x1, fx(i / ni)),
    r: j === 0 && r0 === 0 ? 0 : lerp(r0, r1, fr(j / nj)),
  }));
}

/**
 * A wiggled (curvilinear, non-orthogonal) rectangle: the interior nodes move by a smooth
 * displacement that vanishes on the edges, so the boundaries stay straight.
 */
export function wiggled(
  name: string,
  x0: number,
  x1: number,
  r0: number,
  r1: number,
  ni: number,
  nj: number,
  amplitude: number,
): Block {
  return gridBlock(name, ni, nj, (i, j) => {
    const u = i / ni;
    const v = j / nj;
    // zero on the edges exactly (sin(pi) is not 0), so shared interface nodes stay bitwise equal
    const edgeNode = i === 0 || i === ni || j === 0 || j === nj;
    const bump = edgeNode ? 0 : Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    return {
      x: lerp(x0, x1, u) + amplitude * (x1 - x0) * bump * Math.sin(2 * Math.PI * v),
      r: j === 0 && r0 === 0 ? 0 : lerp(r0, r1, v) + amplitude * (r1 - r0) * bump * Math.cos(3 * u),
    };
  });
}

/**
 * Three blocks in a row over [0, 3L] x [0, H] with both interface orientations: A (i along +x),
 * B rotated by 180 degrees (i along -x, j along -r, so A.imax meets B.imax: a max/max interface
 * with negated face vectors), C (i along +x, meeting B.imin: min/min). All blocks are wiggled.
 * The outer boundary codes are the caller's: { left, right, bottom, top }.
 */
export function threeBlockRow(
  L: number,
  H: number,
  n: number,
  m: number,
  bcs: { left: BcCode; right: BcCode; bottom: BcCode; top: BcCode },
  amplitude = 0.04,
): MultiBlockMesh {
  const A = wiggled('A', 0, L, 0, H, n, m, amplitude);
  const raw = wiggled('Bw', L, 2 * L, 0, H, n, m, amplitude);
  // B: node (i, j) = raw (n - i, m - j): still right-handed (a 180-degree rotation)
  const B = gridBlock('B', n, m, (i, j) => {
    const k = (m - j) * (n + 1) + (n - i);
    return { x: raw.x[k] ?? NaN, r: raw.r[k] ?? NaN };
  });
  const C = wiggled('C', 2 * L, 3 * L, 0, H, n, m, amplitude);
  const patches: Patch[] = [
    { block: 0, face: 'imin', start: 0, end: m, bc: bcs.left, label: 'left' },
    { block: 0, face: 'jmin', start: 0, end: n, bc: bcs.bottom, label: 'bottom' },
    { block: 0, face: 'jmax', start: 0, end: n, bc: bcs.top, label: 'top' },
    { block: 1, face: 'jmax', start: 0, end: n, bc: bcs.bottom, label: 'bottom' },
    { block: 1, face: 'jmin', start: 0, end: n, bc: bcs.top, label: 'top' },
    { block: 2, face: 'imax', start: 0, end: m, bc: bcs.right, label: 'right' },
    { block: 2, face: 'jmin', start: 0, end: n, bc: bcs.bottom, label: 'bottom' },
    { block: 2, face: 'jmax', start: 0, end: n, bc: bcs.top, label: 'top' },
  ];
  connect(
    patches,
    { block: 0, face: 'imax', start: 0, end: m },
    { block: 1, face: 'imax', start: m, end: 0 },
    'A|B',
    false,
  );
  connect(
    patches,
    { block: 1, face: 'imin', start: 0, end: m },
    { block: 2, face: 'imin', start: m, end: 0 },
    'B|C',
    false,
  );
  return { blocks: [A, B, C], patches };
}

/**
 * Polar mesh about the origin in the meridional half-plane: radius rIn..rOut (i, geometric with
 * ratio `growth` per cell), polar angle 0..pi (j). Both j faces lie on the axis (r = 0 exactly).
 * The inner and outer faces get the caller's codes.
 */
export function polarMesh(
  rIn: number,
  rOut: number,
  nR: number,
  nTheta: number,
  growth: number,
  inner: BcCode,
  outer: BcCode,
): MultiBlockMesh {
  const radii = new Float64Array(nR + 1);
  let w = 1;
  let total = 0;
  for (let i = 0; i < nR; i++) {
    total += w;
    w *= growth;
  }
  let acc = 0;
  w = 1;
  for (let i = 0; i <= nR; i++) {
    radii[i] = rIn + ((rOut - rIn) * acc) / total;
    acc += w;
    w *= growth;
  }
  radii[nR] = rOut;
  // theta runs from 0 (j = 0, downstream x > 0) to pi, so (radius, theta) is right-handed in (x, r)
  const b = gridBlock('polar', nR, nTheta, (i, j) => {
    const R = radii[i] ?? NaN;
    const th = (Math.PI * j) / nTheta;
    return {
      x: j === 0 ? R : j === nTheta ? -R : R * Math.cos(th),
      r: j === 0 || j === nTheta ? 0 : R * Math.sin(th),
    };
  });
  return singleBlock(b, { imin: inner, imax: outer, jmin: BC.AXIS, jmax: BC.AXIS });
}

export { BC };
