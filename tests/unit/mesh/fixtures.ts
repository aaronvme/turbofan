// Small hand-built meshes shared by the mesh unit tests.
import { uniform } from '../../../tools/mesh/distribution';
import { tfi } from '../../../tools/mesh/tfi';
import { connect } from '../../../tools/mesh/topology';
import {
  BC,
  type Block,
  type MultiBlockMesh,
  type Patch,
  type Pt,
} from '../../../tools/mesh/types';

export function edge(fn: (u: number) => Pt, t: ArrayLike<number>): Pt[] {
  return Array.from(t, (u) => fn(u));
}

/** Axis-aligned rectangle [x0, x1] x [r0, r1] with uniform ni x nj cells (i along x, j along r). */
export function rectBlock(
  name: string,
  x0: number,
  x1: number,
  r0: number,
  r1: number,
  ni: number,
  nj: number,
): Block {
  const lerp = (a: number, b: number, u: number): number => a * (1 - u) + b * u;
  return tfi(
    name,
    edge((u) => ({ x: lerp(x0, x1, u), r: r0 }), uniform(ni)),
    edge((u) => ({ x: lerp(x0, x1, u), r: r1 }), uniform(ni)),
    edge((v) => ({ x: x0, r: lerp(r0, r1, v) }), uniform(nj)),
    edge((v) => ({ x: x1, r: lerp(r0, r1, v) }), uniform(nj)),
  );
}

/**
 * A = [0, 0.3] x [0, 0.2] (3 x 2 cells) and B = [0.3, 0.5] x [0, 0.2] (2 x 2 cells), meeting at
 * x = 0.3. A's south face is the axis, everything else outside is a slip wall or far field.
 */
export function sideBySide(): MultiBlockMesh {
  const A = rectBlock('A', 0, 0.3, 0, 0.2, 3, 2);
  const B = rectBlock('B', 0.3, 0.5, 0, 0.2, 2, 2);
  const patches: Patch[] = [
    { block: 0, face: 'imin', start: 0, end: 2, bc: BC.INFLOW, label: 'in' },
    { block: 0, face: 'jmin', start: 0, end: 3, bc: BC.AXIS, label: 'axis' },
    { block: 0, face: 'jmax', start: 0, end: 3, bc: BC.SLIP_WALL, label: 'wall' },
    { block: 1, face: 'imax', start: 0, end: 2, bc: BC.OUTFLOW, label: 'out' },
    { block: 1, face: 'jmin', start: 0, end: 2, bc: BC.AXIS, label: 'axis' },
    { block: 1, face: 'jmax', start: 0, end: 2, bc: BC.FARFIELD, label: 'top' },
  ];
  connect(
    patches,
    { block: 0, face: 'imax', start: 0, end: 2 },
    { block: 1, face: 'imin', start: 0, end: 2 },
    'A|B',
    false,
  );
  return { blocks: [A, B], patches };
}

/**
 * A = [0, 1] x [1, 2] (4 x 2 cells, i along +x). B sits on top of A with its i running up (+r) and
 * its j running in -x, so B's imin face (r = 2) matches A's jmax face in reverse - the same
 * relationship as the fan block and the C-block at the fan face.
 */
export function reversedPair(): MultiBlockMesh {
  const A = rectBlock('A', 0, 1, 1, 2, 4, 2);
  const lerp = (a: number, b: number, u: number): number => a * (1 - u) + b * u;
  const ni = 3;
  const nj = 4;
  const B = tfi(
    'B',
    edge((u) => ({ x: 1, r: lerp(2, 2.6, u) }), uniform(ni)),
    edge((u) => ({ x: 0, r: lerp(2, 2.6, u) }), uniform(ni)),
    edge((v) => ({ x: lerp(1, 0, v), r: 2 }), uniform(nj)),
    edge((v) => ({ x: lerp(1, 0, v), r: 2.6 }), uniform(nj)),
  );
  const patches: Patch[] = [
    { block: 0, face: 'imin', start: 0, end: 2, bc: BC.SLIP_WALL, label: 'w' },
    { block: 0, face: 'imax', start: 0, end: 2, bc: BC.SLIP_WALL, label: 'e' },
    { block: 0, face: 'jmin', start: 0, end: 4, bc: BC.SLIP_WALL, label: 's' },
    { block: 1, face: 'imax', start: 0, end: 4, bc: BC.FARFIELD, label: 'top' },
    { block: 1, face: 'jmin', start: 0, end: 3, bc: BC.SLIP_WALL, label: 'e' },
    { block: 1, face: 'jmax', start: 0, end: 3, bc: BC.SLIP_WALL, label: 'w' },
  ];
  connect(
    patches,
    { block: 0, face: 'jmax', start: 0, end: 4 },
    { block: 1, face: 'imin', start: 4, end: 0 },
    'A|B',
    true,
  );
  return { blocks: [A, B], patches };
}
