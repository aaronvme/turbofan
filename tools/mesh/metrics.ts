// Finite-volume metrics for the per-radian, r-weighted axisymmetric scheme, and mesh quality.
//
// Per radian of revolution, a straight face from a to b has area integral(r dl) = rbar L with
// rbar = (r_a + r_b) / 2, and a straight-edged quad has volume integral(r dA) = A * r_centroid
// (Pappus). With these, sum over a cell's faces of n_r * rbar * L equals the planar area A exactly
// (Green's theorem on the field (0, r)), which is the discrete identity that lets the radial
// momentum pressure source p * A balance the face pressure fluxes in a quiescent field (ladder L1).
//
// Face vectors are computed from node differences ordered so that two blocks sharing an interface
// get bitwise-equal (min/max face pair) or bitwise-negated (max/max, min/min pair) vectors.
import { faceNodeCount, mapIndex } from './topology';
import { BC, nodeIndex, type Block, type Face, type MultiBlockMesh, type Patch } from './types';

export interface BlockGeometry {
  /** Planar centroid of each cell (ni * nj, i fastest). */
  readonly centreX: Float64Array;
  readonly centreR: Float64Array;
  /** Planar area of each cell (m^2). */
  readonly area: Float64Array;
  /** Per-radian volume integral(r dA) of each cell (m^3/rad). */
  readonly volR: Float64Array;
  /** i-faces ((ni + 1) * nj, index j * (ni + 1) + i): n * L pointing towards +i, and rbar * L. */
  readonly iFaceNx: Float64Array;
  readonly iFaceNr: Float64Array;
  readonly iFaceAreaR: Float64Array;
  /** j-faces (ni * (nj + 1), index j * ni + i): n * L pointing towards +j, and rbar * L. */
  readonly jFaceNx: Float64Array;
  readonly jFaceNr: Float64Array;
  readonly jFaceAreaR: Float64Array;
}

export function blockGeometry(b: Block): BlockGeometry {
  const { ni, nj, x, r } = b;
  const nc = ni * nj;
  const centreX = new Float64Array(nc);
  const centreR = new Float64Array(nc);
  const area = new Float64Array(nc);
  const volR = new Float64Array(nc);
  const X = (i: number, j: number): number => x[nodeIndex(b, i, j)] ?? NaN;
  const R = (i: number, j: number): number => r[nodeIndex(b, i, j)] ?? NaN;
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      // Two triangles (P0, P1, P2) and (P0, P2, P3), coordinates relative to P0.
      const x0 = X(i, j);
      const r0 = R(i, j);
      const x1 = X(i + 1, j) - x0;
      const r1 = R(i + 1, j) - r0;
      const x2 = X(i + 1, j + 1) - x0;
      const r2 = R(i + 1, j + 1) - r0;
      const x3 = X(i, j + 1) - x0;
      const r3 = R(i, j + 1) - r0;
      const a1 = 0.5 * (x1 * r2 - x2 * r1);
      const a2 = 0.5 * (x2 * r3 - x3 * r2);
      const A = a1 + a2;
      const cx = (a1 * (x1 + x2) + a2 * (x2 + x3)) / (3 * A);
      const cr = (a1 * (r1 + r2) + a2 * (r2 + r3)) / (3 * A);
      const c = j * ni + i;
      area[c] = A;
      centreX[c] = x0 + cx;
      centreR[c] = r0 + cr;
      volR[c] = A * (r0 + cr);
    }
  }
  const iFaceNx = new Float64Array((ni + 1) * nj);
  const iFaceNr = new Float64Array((ni + 1) * nj);
  const iFaceAreaR = new Float64Array((ni + 1) * nj);
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i <= ni; i++) {
      const xa = X(i, j);
      const ra = R(i, j);
      const xb = X(i, j + 1);
      const rb = R(i, j + 1);
      const f = j * (ni + 1) + i;
      iFaceNx[f] = rb - ra;
      iFaceNr[f] = xa - xb;
      iFaceAreaR[f] = 0.5 * (ra + rb) * Math.hypot(xb - xa, rb - ra);
    }
  }
  const jFaceNx = new Float64Array(ni * (nj + 1));
  const jFaceNr = new Float64Array(ni * (nj + 1));
  const jFaceAreaR = new Float64Array(ni * (nj + 1));
  for (let j = 0; j <= nj; j++) {
    for (let i = 0; i < ni; i++) {
      const xa = X(i, j);
      const ra = R(i, j);
      const xb = X(i + 1, j);
      const rb = R(i + 1, j);
      const f = j * ni + i;
      jFaceNx[f] = ra - rb;
      jFaceNr[f] = xb - xa;
      jFaceAreaR[f] = 0.5 * (ra + rb) * Math.hypot(xb - xa, rb - ra);
    }
  }
  return {
    centreX,
    centreR,
    area,
    volR,
    iFaceNx,
    iFaceNr,
    iFaceAreaR,
    jFaceNx,
    jFaceNr,
    jFaceAreaR,
  };
}

/** Where a worst value occurs: cell indices and its centre. */
export interface Where {
  readonly i: number;
  readonly j: number;
  readonly x: number;
  readonly r: number;
}

export interface BlockQuality {
  readonly name: string;
  readonly ni: number;
  readonly nj: number;
  readonly cells: number;
  /** Corner Jacobians (cross product of the two edges at each cell corner), m^2. */
  readonly minJacobian: number;
  readonly maxJacobian: number;
  /** min over corners of sin(corner angle); 1 for rectangles. */
  readonly minScaledJacobian: number;
  /** Largest adjacent-cell length ratio along grid lines, including across interfaces. */
  readonly maxStretch: number;
  readonly maxStretchAt: Where;
  /** Largest deviation of a cell corner angle from 90 degrees. */
  readonly maxSkewDeg: number;
  readonly maxSkewAt: Where;
  /** Largest deviation from 90 degrees between a wall face and the grid line leaving it. */
  readonly wallOrthoMaxDeg: number;
  /** Same for interface faces (this block's side). */
  readonly interfaceOrthoMaxDeg: number;
  /** Largest change of direction of a grid line crossing an interface. */
  readonly interfaceKinkMaxDeg: number;
  readonly aspectMin: number;
  readonly aspectMax: number;
  readonly aspectMaxAt: Where;
  readonly minEdge: number;
  readonly maxEdge: number;
}

const DEG = 180 / Math.PI;

/** Cell lengths along i (between i-face midpoints) and along j (between j-face midpoints). */
function cellLengths(b: Block): { Li: Float64Array; Lj: Float64Array } {
  const { ni, nj } = b;
  const Li = new Float64Array(ni * nj);
  const Lj = new Float64Array(ni * nj);
  const X = (i: number, j: number): number => b.x[nodeIndex(b, i, j)] ?? NaN;
  const R = (i: number, j: number): number => b.r[nodeIndex(b, i, j)] ?? NaN;
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const wx = 0.5 * (X(i, j) + X(i, j + 1));
      const wr = 0.5 * (R(i, j) + R(i, j + 1));
      const ex = 0.5 * (X(i + 1, j) + X(i + 1, j + 1));
      const er = 0.5 * (R(i + 1, j) + R(i + 1, j + 1));
      const sx = 0.5 * (X(i, j) + X(i + 1, j));
      const sr = 0.5 * (R(i, j) + R(i + 1, j));
      const nx = 0.5 * (X(i, j + 1) + X(i + 1, j + 1));
      const nr = 0.5 * (R(i, j + 1) + R(i + 1, j + 1));
      Li[j * ni + i] = Math.hypot(ex - wx, er - wr);
      Lj[j * ni + i] = Math.hypot(nx - sx, nr - sr);
    }
  }
  return { Li, Lj };
}

/** The cell (i, j) touching face cell c of a face, `depth` cells inside. */
export function faceCellIJ(
  b: Pick<Block, 'ni' | 'nj'>,
  face: Face,
  c: number,
  depth: number,
): [number, number] {
  switch (face) {
    case 'imin':
      return [depth, c];
    case 'imax':
      return [b.ni - 1 - depth, c];
    case 'jmin':
      return [c, depth];
    case 'jmax':
      return [c, b.nj - 1 - depth];
  }
}

/**
 * For face cell c of a face: the face midpoint, the face tangent and the transverse direction of
 * the adjacent cell (from the opposite face's midpoint to this face's midpoint, i.e. outwards).
 */
function faceFrame(
  b: Block,
  face: Face,
  c: number,
): { mx: number; mr: number; tx: number; tr: number; ox: number; or: number } {
  const X = (i: number, j: number): number => b.x[nodeIndex(b, i, j)] ?? NaN;
  const R = (i: number, j: number): number => b.r[nodeIndex(b, i, j)] ?? NaN;
  let a: [number, number];
  let e: [number, number];
  let oa: [number, number];
  let oe: [number, number];
  switch (face) {
    case 'imin':
      a = [0, c];
      e = [0, c + 1];
      oa = [1, c];
      oe = [1, c + 1];
      break;
    case 'imax':
      a = [b.ni, c];
      e = [b.ni, c + 1];
      oa = [b.ni - 1, c];
      oe = [b.ni - 1, c + 1];
      break;
    case 'jmin':
      a = [c, 0];
      e = [c + 1, 0];
      oa = [c, 1];
      oe = [c + 1, 1];
      break;
    case 'jmax':
      a = [c, b.nj];
      e = [c + 1, b.nj];
      oa = [c, b.nj - 1];
      oe = [c + 1, b.nj - 1];
      break;
  }
  const mx = 0.5 * (X(...a) + X(...e));
  const mr = 0.5 * (R(...a) + R(...e));
  const omx = 0.5 * (X(...oa) + X(...oe));
  const omr = 0.5 * (R(...oa) + R(...oe));
  return { mx, mr, tx: X(...e) - X(...a), tr: R(...e) - R(...a), ox: mx - omx, or: mr - omr };
}

function angleDeg(ax: number, ar: number, bx: number, br: number): number {
  const c = (ax * bx + ar * br) / (Math.hypot(ax, ar) * Math.hypot(bx, br));
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
}

function blockPatches(patches: readonly Patch[], block: number): Patch[] {
  return patches.filter((p) => p.block === block);
}

export function meshQuality(mesh: MultiBlockMesh): BlockQuality[] {
  const lengths = mesh.blocks.map((b) => cellLengths(b));
  return mesh.blocks.map((b, bi) => {
    const { ni, nj } = b;
    const { Li, Lj } = lengths[bi] as { Li: Float64Array; Lj: Float64Array };
    const X = (i: number, j: number): number => b.x[nodeIndex(b, i, j)] ?? NaN;
    const R = (i: number, j: number): number => b.r[nodeIndex(b, i, j)] ?? NaN;
    const where = (i: number, j: number): Where => ({
      i,
      j,
      x: 0.25 * (X(i, j) + X(i + 1, j) + X(i, j + 1) + X(i + 1, j + 1)),
      r: 0.25 * (R(i, j) + R(i + 1, j) + R(i, j + 1) + R(i + 1, j + 1)),
    });
    let minJ = Infinity;
    let maxJ = -Infinity;
    let minScaled = Infinity;
    let maxSkew = 0;
    let maxSkewAt = where(0, 0);
    let aspectMin = Infinity;
    let aspectMax = 0;
    let aspectMaxAt = where(0, 0);
    let minEdge = Infinity;
    let maxEdge = 0;
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        // CCW corners P0 (i,j), P1 (i+1,j), P2 (i+1,j+1), P3 (i,j+1)
        const px = [X(i, j), X(i + 1, j), X(i + 1, j + 1), X(i, j + 1)];
        const pr = [R(i, j), R(i + 1, j), R(i + 1, j + 1), R(i, j + 1)];
        for (let k = 0; k < 4; k++) {
          const n = (k + 1) % 4;
          const p = (k + 3) % 4;
          const ax = (px[n] ?? 0) - (px[k] ?? 0);
          const ar = (pr[n] ?? 0) - (pr[k] ?? 0);
          const bx = (px[p] ?? 0) - (px[k] ?? 0);
          const br = (pr[p] ?? 0) - (pr[k] ?? 0);
          const cross = ax * br - ar * bx;
          const la = Math.hypot(ax, ar);
          const lb = Math.hypot(bx, br);
          minJ = Math.min(minJ, cross);
          maxJ = Math.max(maxJ, cross);
          minScaled = Math.min(minScaled, cross / (la * lb));
          minEdge = Math.min(minEdge, la);
          maxEdge = Math.max(maxEdge, la);
          const skew = Math.abs(angleDeg(ax, ar, bx, br) - 90);
          if (skew > maxSkew) {
            maxSkew = skew;
            maxSkewAt = where(i, j);
          }
        }
        const c = j * ni + i;
        const li = Li[c] ?? 0;
        const lj = Lj[c] ?? 0;
        const ar = Math.max(li, lj) / Math.min(li, lj);
        aspectMin = Math.min(aspectMin, ar);
        if (ar > aspectMax) {
          aspectMax = ar;
          aspectMaxAt = where(i, j);
        }
      }
    }

    let maxStretch = 1;
    let maxStretchAt = where(0, 0);
    const stretch = (a: number, c: number, i: number, j: number): void => {
      const s = a > c ? a / c : c / a;
      if (s > maxStretch) {
        maxStretch = s;
        maxStretchAt = where(i, j);
      }
    };
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i + 1 < ni; i++) stretch(Li[j * ni + i] ?? 0, Li[j * ni + i + 1] ?? 0, i, j);
    }
    for (let j = 0; j + 1 < nj; j++) {
      for (let i = 0; i < ni; i++) stretch(Lj[j * ni + i] ?? 0, Lj[(j + 1) * ni + i] ?? 0, i, j);
    }

    let wallOrtho = 0;
    let ifaceOrtho = 0;
    let kink = 0;
    for (const p of blockPatches(mesh.patches, bi)) {
      if (p.bc !== BC.SLIP_WALL && p.bc !== BC.INTERFACE) continue;
      const cross = (f: Face): Float64Array => (f === 'imin' || f === 'imax' ? Li : Lj);
      for (let c = p.start; c < p.end; c++) {
        const fr = faceFrame(b, p.face, c);
        const ortho = Math.abs(angleDeg(fr.tx, fr.tr, fr.ox, fr.or) - 90);
        if (p.bc === BC.SLIP_WALL) {
          wallOrtho = Math.max(wallOrtho, ortho);
          continue;
        }
        ifaceOrtho = Math.max(ifaceOrtho, ortho);
        const nbr = p.nbr;
        const nb = nbr === undefined ? undefined : mesh.blocks[nbr.block];
        if (nbr === undefined || nb === undefined || c >= faceNodeCount(b, p.face) - 1) continue;
        const cb = Math.min(mapIndex(p, c), mapIndex(p, c + 1));
        const fb = faceFrame(nb, nbr.face, cb);
        // fb.o points out of the neighbour, i.e. back into this block: the line continues along -fb.o
        kink = Math.max(kink, angleDeg(fr.ox, fr.or, -fb.ox, -fb.or));
        const [ia, ja] = faceCellIJ(b, p.face, c, 0);
        const [ib, jb] = faceCellIJ(nb, nbr.face, cb, 0);
        const la = cross(p.face)[ja * ni + ia] ?? 0;
        const lb =
          (nbr.face === 'imin' || nbr.face === 'imax'
            ? lengths[nbr.block]?.Li
            : lengths[nbr.block]?.Lj)?.[jb * nb.ni + ib] ?? 0;
        stretch(la, lb, ia, ja);
      }
    }

    return {
      name: b.name,
      ni,
      nj,
      cells: ni * nj,
      minJacobian: minJ,
      maxJacobian: maxJ,
      minScaledJacobian: minScaled,
      maxStretch,
      maxStretchAt,
      maxSkewDeg: maxSkew,
      maxSkewAt,
      wallOrthoMaxDeg: wallOrtho,
      interfaceOrthoMaxDeg: ifaceOrtho,
      interfaceKinkMaxDeg: kink,
      aspectMin,
      aspectMax,
      aspectMaxAt,
      minEdge,
      maxEdge,
    };
  });
}
