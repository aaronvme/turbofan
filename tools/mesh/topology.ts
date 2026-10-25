// Block-face index helpers and multi-block connectivity checks. Interfaces are point matched: the
// node at face index k of a patch is the same point as the node at the mapped index of the
// neighbour patch, bitwise. Every block is right-handed in (x, r), so the face vectors the two sides
// compute from the shared nodes are bitwise equal (a max face against a min face: both normals point
// from one block into the other) or bitwise negated (max against max, min against min).
import {
  BC,
  FACES,
  nodeIndex,
  type Block,
  type Face,
  type MultiBlockMesh,
  type Patch,
} from './types';

/** Number of nodes along a face (cells + 1). */
export function faceNodeCount(b: Pick<Block, 'ni' | 'nj'>, face: Face): number {
  return face === 'imin' || face === 'imax' ? b.nj + 1 : b.ni + 1;
}

/** (i, j) of the node at index k along a face. */
export function faceNodeIJ(b: Pick<Block, 'ni' | 'nj'>, face: Face, k: number): [number, number] {
  switch (face) {
    case 'imin':
      return [0, k];
    case 'imax':
      return [b.ni, k];
    case 'jmin':
      return [k, 0];
    case 'jmax':
      return [k, b.nj];
  }
}

/** (i, j) of the node `depth` layers inside the block from face node k (depth 0 = on the face). */
export function inwardNodeIJ(
  b: Pick<Block, 'ni' | 'nj'>,
  face: Face,
  k: number,
  depth: number,
): [number, number] {
  switch (face) {
    case 'imin':
      return [depth, k];
    case 'imax':
      return [b.ni - depth, k];
    case 'jmin':
      return [k, depth];
    case 'jmax':
      return [k, b.nj - depth];
  }
}

/** Neighbour-face node index matching index k of an interface patch. */
export function mapIndex(p: Patch, k: number): number {
  if (p.nbr === undefined) throw new Error(`patch ${p.label} is not an interface`);
  const sign = p.nbr.end >= p.nbr.start ? 1 : -1;
  return p.nbr.start + sign * (k - p.start);
}

/** The patch of block b's face containing node index k (first match; ends are shared by two). */
export function findPatch(
  patches: readonly Patch[],
  block: number,
  face: Face,
  k: number,
): Patch | undefined {
  return patches.find((p) => p.block === block && p.face === face && p.start <= k && k <= p.end);
}

/** The patch of block b's face containing face cell c (cells start..end-1; unique). */
export function findCellPatch(
  patches: readonly Patch[],
  block: number,
  face: Face,
  c: number,
): Patch | undefined {
  return patches.find((p) => p.block === block && p.face === face && p.start <= c && c < p.end);
}

/** The patch on the other side of an interface patch. */
export function partnerPatch(patches: readonly Patch[], p: Patch): Patch | undefined {
  const n = p.nbr;
  if (n === undefined) return undefined;
  return patches.find(
    (q) =>
      q.block === n.block &&
      q.face === n.face &&
      q.nbr?.block === p.block &&
      q.nbr.face === p.face &&
      Math.min(q.start, q.end) === Math.min(n.start, n.end) &&
      Math.max(q.start, q.end) === Math.max(n.start, n.end),
  );
}

/**
 * Structural and geometric consistency of a multi-block mesh. Returns human-readable problems
 * (empty when the mesh is consistent): every face covered exactly once by patches, interfaces
 * paired symmetrically with equal cell counts, interface nodes bitwise equal, axis nodes at r = 0.
 */
export function validateMesh(mesh: MultiBlockMesh): string[] {
  const errors: string[] = [];
  const { blocks, patches } = mesh;
  blocks.forEach((b, bi) => {
    if (b.x.length !== (b.ni + 1) * (b.nj + 1) || b.r.length !== b.x.length) {
      errors.push(`${b.name}: node arrays have the wrong length`);
    }
    for (const face of FACES) {
      const n = faceNodeCount(b, face) - 1;
      const cover = new Int32Array(n);
      for (const p of patches) {
        if (p.block !== bi || p.face !== face) continue;
        if (!(p.start < p.end) || p.start < 0 || p.end > n) {
          errors.push(`${b.name} ${face}: bad patch range ${p.start}..${p.end}`);
          continue;
        }
        for (let c = p.start; c < p.end; c++) cover[c] = (cover[c] ?? 0) + 1;
      }
      for (let c = 0; c < n; c++) {
        if (cover[c] !== 1)
          errors.push(`${b.name} ${face}: cell ${c} covered ${cover[c] ?? 0} times`);
      }
    }
  });
  for (const p of patches) {
    const b = blocks[p.block];
    if (b === undefined) {
      errors.push(`patch ${p.label}: unknown block ${p.block}`);
      continue;
    }
    if (p.bc === BC.AXIS) {
      for (let k = p.start; k <= p.end; k++) {
        const [i, j] = faceNodeIJ(b, p.face, k);
        if (b.r[nodeIndex(b, i, j)] !== 0)
          errors.push(`${b.name} ${p.label}: axis node ${k} has r != 0`);
      }
    }
    if (p.bc !== BC.INTERFACE) {
      if (p.nbr !== undefined)
        errors.push(`${b.name} ${p.label}: non-interface patch has a neighbour`);
      continue;
    }
    const n = p.nbr;
    const q = partnerPatch(patches, p);
    const nb = n === undefined ? undefined : blocks[n.block];
    if (n === undefined || q === undefined || nb === undefined) {
      errors.push(`${b.name} ${p.label}: interface has no partner patch`);
      continue;
    }
    if (Math.abs(n.end - n.start) !== p.end - p.start) {
      errors.push(`${b.name} ${p.label}: interface cell counts differ`);
      continue;
    }
    if (q.floating !== p.floating)
      errors.push(`${b.name} ${p.label}: floating flag differs from partner`);
    for (let k = p.start; k <= p.end; k++) {
      const [i, j] = faceNodeIJ(b, p.face, k);
      const [ni, nj] = faceNodeIJ(nb, n.face, mapIndex(p, k));
      const a = nodeIndex(b, i, j);
      const c = nodeIndex(nb, ni, nj);
      if (b.x[a] !== nb.x[c] || b.r[a] !== nb.r[c]) {
        errors.push(`${b.name} ${p.label}: node ${k} does not match ${nb.name} bitwise`);
      }
    }
  }
  return errors;
}

/** Add both sides of a point-matched interface. `a` and `b` ranges are node indices; b may run backwards. */
export function connect(
  patches: Patch[],
  a: { block: number; face: Face; start: number; end: number },
  b: { block: number; face: Face; start: number; end: number },
  label: string,
  floating: boolean,
): void {
  if (Math.abs(a.end - a.start) !== Math.abs(b.end - b.start)) {
    throw new Error(`interface ${label}: ranges have different lengths`);
  }
  // Store each side with start < end and the partner range mapped accordingly.
  const side = (
    p: { block: number; face: Face; start: number; end: number },
    q: { block: number; face: Face; start: number; end: number },
  ): Patch =>
    p.start < p.end
      ? {
          block: p.block,
          face: p.face,
          start: p.start,
          end: p.end,
          bc: BC.INTERFACE,
          label,
          floating,
          nbr: { ...q },
        }
      : {
          block: p.block,
          face: p.face,
          start: p.end,
          end: p.start,
          bc: BC.INTERFACE,
          label,
          floating,
          nbr: { block: q.block, face: q.face, start: q.end, end: q.start },
        };
  patches.push(side(a, b), side(b, a));
}
