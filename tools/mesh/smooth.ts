// Multi-block elliptic smoothing: the Winslow / Thompson-Thames-Mastin equations
//   alpha (x_xixi + phi x_xi) - 2 beta x_xieta + gamma (x_etaeta + psi x_eta) = 0   (same for r)
//   alpha = |x_eta|^2, beta = x_xi . x_eta, gamma = |x_xi|^2
// (Thompson, Warsi & Mastin, "Numerical Grid Generation", 1985, eq. 6.6 with P = phi |grad xi|^2,
// Q = psi |grad eta|^2), solved by point SOR with central differences.
//
// Control functions (spacing and clustering control), per direction:
// - 'boundary' (default): Thomas & Middlecoff, AIAA J. 18 (1980) 652-656. phi is evaluated along
//   the two block rows j = 0 and j = nj, phi = -(x_xi . x_xixi) / |x_xi|^2, and interpolated
//   between them by the normalised arc length up each column (psi likewise from the i = 0 and
//   i = ni columns). The boundary distributions therefore carry into the interior while interior
//   irregularities are smoothed out; a tensor-product stretched grid is an exact fixed point.
// - 'initial-grid': the same expression evaluated along every grid line of the algebraic grid.
//   It preserves a clustering that varies across the block (the C-block's wall-normal spacing,
//   finer at the lip than at either end face), at the price of also preserving any irregularity
//   of the algebraic grid, so it is only used where that grid is smooth by construction.
// - 'none': pure Winslow (drives towards uniform spacing).
// At floating-interface nodes the direction crossing the interface has no boundary row to take
// phi from, so it uses the initial-grid value through the halo stencil.
//
// Fixed nodes: every node on a block face, except the interior nodes of floating interface patches.
// Those are smoothed as if the interface were not there: their stencil reaches one layer into the
// neighbour block (the "halo"), both copies are one canonical node, and the copies are written back
// bitwise equal. Patch ends (block corners, T-junctions, the valence-5 points around the C-block)
// stay fixed.
import { faceNodeCount, faceNodeIJ, findPatch, inwardNodeIJ, mapIndex } from './topology';
import { BC, nodeIndex, type Block, type Face, type MultiBlockMesh } from './types';

export interface SmoothOptions {
  readonly sweeps: number;
  /** SOR relaxation factor (default 0.8; under-relaxed for the high-aspect-ratio far field). */
  readonly omega?: number;
  /** Let floating interface patches move (default true). */
  readonly floatInterfaces?: boolean;
  /** Control-function source for both directions (default 'boundary', Thomas-Middlecoff). */
  readonly control?: ControlSource;
  /** Per-block overrides by block name, per direction (phi along i, psi along j). */
  readonly blockControl?: Readonly<
    Record<string, { readonly phi?: ControlSource; readonly psi?: ControlSource }>
  >;
}

export type ControlSource = 'boundary' | 'initial-grid' | 'none';

export interface SmoothReport {
  readonly sweeps: number;
  readonly freeNodes: number;
  /** Largest node move in the first and the last sweep, relative to the local spacing. */
  readonly firstMaxMove: number;
  readonly lastMaxMove: number;
}

// Stencil slot order.
const E = 0;
const W = 1;
const N = 2;
const S = 3;
const NE = 4;
const NW = 5;
const SE = 6;
const SW = 7;
const OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function find(parent: Int32Array, a: number): number {
  let root = a;
  while (parent[root] !== root) root = parent[root] ?? root;
  let cur = a;
  while (parent[cur] !== root) {
    const next = parent[cur] ?? root;
    parent[cur] = root;
    cur = next;
  }
  return root;
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra < rb) parent[rb] = ra;
  else if (rb < ra) parent[ra] = rb;
}

export function smoothMesh(mesh: MultiBlockMesh, opts: SmoothOptions): SmoothReport {
  const { blocks, patches } = mesh;
  const omega = opts.omega ?? 0.8;
  const floatInterfaces = opts.floatInterfaces ?? true;
  const control = opts.control ?? 'boundary';

  const offset: number[] = [];
  let total = 0;
  for (const b of blocks) {
    offset.push(total);
    total += (b.ni + 1) * (b.nj + 1);
  }
  const g = (bi: number, i: number, j: number): number =>
    (offset[bi] ?? 0) + nodeIndex(blocks[bi] as Block, i, j);

  const X = new Float64Array(total);
  const R = new Float64Array(total);
  blocks.forEach((b, bi) => {
    X.set(b.x, offset[bi]);
    R.set(b.r, offset[bi]);
  });

  // Canonical node per physical point: union of interface copies.
  const parent = new Int32Array(total);
  for (let n = 0; n < total; n++) parent[n] = n;
  for (const p of patches) {
    if (p.bc !== BC.INTERFACE || p.nbr === undefined) continue;
    const b = blocks[p.block] as Block;
    const nb = blocks[p.nbr.block] as Block;
    for (let k = p.start; k <= p.end; k++) {
      const [i, j] = faceNodeIJ(b, p.face, k);
      const [ni, nj] = faceNodeIJ(nb, p.nbr.face, mapIndex(p, k));
      union(parent, g(p.block, i, j), g(p.nbr.block, ni, nj));
    }
  }
  const canon = new Int32Array(total);
  for (let n = 0; n < total; n++) canon[n] = find(parent, n);

  // Pinned copies: all face nodes, minus the interior nodes of floating interfaces.
  const pinned = new Uint8Array(total);
  blocks.forEach((b, bi) => {
    for (let i = 0; i <= b.ni; i++) {
      pinned[g(bi, i, 0)] = 1;
      pinned[g(bi, i, b.nj)] = 1;
    }
    for (let j = 0; j <= b.nj; j++) {
      pinned[g(bi, 0, j)] = 1;
      pinned[g(bi, b.ni, j)] = 1;
    }
  });
  if (floatInterfaces) {
    for (const p of patches) {
      if (p.bc !== BC.INTERFACE || p.floating !== true) continue;
      const b = blocks[p.block] as Block;
      for (let k = p.start + 1; k < p.end; k++) {
        const [i, j] = faceNodeIJ(b, p.face, k);
        pinned[g(p.block, i, j)] = 0;
      }
    }
  }
  const canonPinned = new Uint8Array(total);
  for (let n = 0; n < total; n++) {
    if (pinned[n] === 1) canonPinned[canon[n] ?? n] = 1;
  }

  // Free canonical nodes and their stencils in the home block's index frame.
  const home: number[] = [];
  blocks.forEach((b, bi) => {
    for (let j = 0; j <= b.nj; j++) {
      for (let i = 0; i <= b.ni; i++) {
        const n = g(bi, i, j);
        if (canon[n] === n && canonPinned[n] === 0) home.push(bi, i, j);
      }
    }
  });
  const nFree = home.length / 3;
  const node = new Int32Array(nFree);
  const stencil = new Int32Array(nFree * 8);
  const neighbour = (bi: number, i: number, j: number): number => {
    const b = blocks[bi] as Block;
    if (i >= 0 && i <= b.ni && j >= 0 && j <= b.nj) return canon[g(bi, i, j)] ?? -1;
    let face: Face;
    let k: number;
    if (j > b.nj) [face, k] = ['jmax', i];
    else if (j < 0) [face, k] = ['jmin', i];
    else if (i > b.ni) [face, k] = ['imax', j];
    else [face, k] = ['imin', j];
    const p = findPatch(patches, bi, face, k);
    if (p?.nbr === undefined || k < 0 || k >= faceNodeCount(b, face)) {
      throw new Error(`smoothing stencil leaves block ${b.name} through a non-interface face`);
    }
    const nb = blocks[p.nbr.block] as Block;
    const [hi, hj] = inwardNodeIJ(nb, p.nbr.face, mapIndex(p, k), 1);
    return canon[g(p.nbr.block, hi, hj)] ?? -1;
  };
  for (let f = 0; f < nFree; f++) {
    const bi = home[3 * f] ?? 0;
    const i = home[3 * f + 1] ?? 0;
    const j = home[3 * f + 2] ?? 0;
    node[f] = g(bi, i, j);
    OFFSETS.forEach(([di, dj], s) => {
      stencil[8 * f + s] = neighbour(bi, i + di, j + dj);
    });
  }

  // Control functions, computed once from the algebraic grid.
  const lineControl = (a: number, c: number, b: number): number => {
    const tx = 0.5 * ((X[b] ?? 0) - (X[a] ?? 0));
    const tr = 0.5 * ((R[b] ?? 0) - (R[a] ?? 0));
    const sx = (X[b] ?? 0) - 2 * (X[c] ?? 0) + (X[a] ?? 0);
    const sr = (R[b] ?? 0) - 2 * (R[c] ?? 0) + (R[a] ?? 0);
    return -(tx * sx + tr * sr) / (tx * tx + tr * tr);
  };
  const boundaryControl = blocks.map((b, bi) => {
    const row = (j: number): Float64Array => {
      const out = new Float64Array(b.ni + 1);
      for (let i = 1; i < b.ni; i++)
        out[i] = lineControl(g(bi, i - 1, j), g(bi, i, j), g(bi, i + 1, j));
      return out;
    };
    const col = (i: number): Float64Array => {
      const out = new Float64Array(b.nj + 1);
      for (let j = 1; j < b.nj; j++)
        out[j] = lineControl(g(bi, i, j - 1), g(bi, i, j), g(bi, i, j + 1));
      return out;
    };
    return { south: row(0), north: row(b.nj), west: col(0), east: col(b.ni) };
  });
  // Normalised arc length of every node up its column (eta) and along its row (xi).
  const fractions = blocks.map((b, bi) => {
    const eta = new Float64Array((b.ni + 1) * (b.nj + 1));
    const xi = new Float64Array(eta.length);
    const dist = (p: number, q: number): number =>
      Math.hypot((X[p] ?? 0) - (X[q] ?? 0), (R[p] ?? 0) - (R[q] ?? 0));
    for (let i = 0; i <= b.ni; i++) {
      for (let j = 1; j <= b.nj; j++) {
        eta[nodeIndex(b, i, j)] =
          (eta[nodeIndex(b, i, j - 1)] ?? 0) + dist(g(bi, i, j), g(bi, i, j - 1));
      }
      const all = eta[nodeIndex(b, i, b.nj)] ?? 1;
      for (let j = 0; j <= b.nj; j++)
        eta[nodeIndex(b, i, j)] = (eta[nodeIndex(b, i, j)] ?? 0) / all;
    }
    for (let j = 0; j <= b.nj; j++) {
      for (let i = 1; i <= b.ni; i++) {
        xi[nodeIndex(b, i, j)] =
          (xi[nodeIndex(b, i - 1, j)] ?? 0) + dist(g(bi, i, j), g(bi, i - 1, j));
      }
      const all = xi[nodeIndex(b, b.ni, j)] ?? 1;
      for (let i = 0; i <= b.ni; i++) xi[nodeIndex(b, i, j)] = (xi[nodeIndex(b, i, j)] ?? 0) / all;
    }
    return { eta, xi };
  });
  const arcFraction = (bi: number, i: number, j: number, alongJ: boolean): number => {
    const fr = fractions[bi];
    const k = nodeIndex(blocks[bi] as Block, i, j);
    return (alongJ ? fr?.eta[k] : fr?.xi[k]) ?? 0;
  };
  const phi = new Float64Array(nFree);
  const psi = new Float64Array(nFree);
  for (let f = 0; f < nFree; f++) {
    const bi = home[3 * f] ?? 0;
    const i = home[3 * f + 1] ?? 0;
    const j = home[3 * f + 2] ?? 0;
    const b = blocks[bi] as Block;
    const bc = boundaryControl[bi];
    const override = opts.blockControl?.[b.name];
    const phiSource = override?.phi ?? control;
    const psiSource = override?.psi ?? control;
    const c = node[f] ?? 0;
    const o = 8 * f;
    if (phiSource === 'initial-grid' || (phiSource === 'boundary' && (i === 0 || i === b.ni))) {
      phi[f] = lineControl(stencil[o + W] ?? 0, c, stencil[o + E] ?? 0);
    } else if (phiSource === 'boundary' && bc !== undefined) {
      const eta = arcFraction(bi, i, j, true);
      phi[f] = (1 - eta) * (bc.south[i] ?? 0) + eta * (bc.north[i] ?? 0);
    }
    if (psiSource === 'initial-grid' || (psiSource === 'boundary' && (j === 0 || j === b.nj))) {
      psi[f] = lineControl(stencil[o + S] ?? 0, c, stencil[o + N] ?? 0);
    } else if (psiSource === 'boundary' && bc !== undefined) {
      const xi = arcFraction(bi, i, j, false);
      psi[f] = (1 - xi) * (bc.west[j] ?? 0) + xi * (bc.east[j] ?? 0);
    }
  }

  let firstMaxMove = 0;
  let lastMaxMove = 0;
  for (let sweep = 0; sweep < opts.sweeps; sweep++) {
    let maxMove = 0;
    for (let f = 0; f < nFree; f++) {
      const c = node[f] ?? 0;
      const o = 8 * f;
      const xe = X[stencil[o + E] ?? 0] ?? 0;
      const xw = X[stencil[o + W] ?? 0] ?? 0;
      const xn = X[stencil[o + N] ?? 0] ?? 0;
      const xs = X[stencil[o + S] ?? 0] ?? 0;
      const re = R[stencil[o + E] ?? 0] ?? 0;
      const rw = R[stencil[o + W] ?? 0] ?? 0;
      const rn = R[stencil[o + N] ?? 0] ?? 0;
      const rs = R[stencil[o + S] ?? 0] ?? 0;
      const xxi = 0.5 * (xe - xw);
      const rxi = 0.5 * (re - rw);
      const xeta = 0.5 * (xn - xs);
      const reta = 0.5 * (rn - rs);
      const alpha = xeta * xeta + reta * reta;
      const gamma = xxi * xxi + rxi * rxi;
      const beta = xxi * xeta + rxi * reta;
      const crossX =
        (X[stencil[o + NE] ?? 0] ?? 0) -
        (X[stencil[o + NW] ?? 0] ?? 0) -
        (X[stencil[o + SE] ?? 0] ?? 0) +
        (X[stencil[o + SW] ?? 0] ?? 0);
      const crossR =
        (R[stencil[o + NE] ?? 0] ?? 0) -
        (R[stencil[o + NW] ?? 0] ?? 0) -
        (R[stencil[o + SE] ?? 0] ?? 0) +
        (R[stencil[o + SW] ?? 0] ?? 0);
      const p = phi[f] ?? 0;
      const q = psi[f] ?? 0;
      const den = 2 * (alpha + gamma);
      const xNew =
        (alpha * (xe + xw + p * (xe - xw) * 0.5) +
          gamma * (xn + xs + q * (xn - xs) * 0.5) -
          0.5 * beta * crossX) /
        den;
      const rNew =
        (alpha * (re + rw + p * (re - rw) * 0.5) +
          gamma * (rn + rs + q * (rn - rs) * 0.5) -
          0.5 * beta * crossR) /
        den;
      const xOld = X[c] ?? 0;
      const rOld = R[c] ?? 0;
      const dx = omega * (xNew - xOld);
      const dr = omega * (rNew - rOld);
      X[c] = xOld + dx;
      R[c] = rOld + dr;
      const move = Math.hypot(dx, dr) / Math.sqrt(Math.min(alpha, gamma));
      if (move > maxMove) maxMove = move;
    }
    if (sweep === 0) firstMaxMove = maxMove;
    lastMaxMove = maxMove;
  }

  // Write back: every copy takes its canonical node's coordinates (bitwise equal across blocks).
  blocks.forEach((b, bi) => {
    const base = offset[bi] ?? 0;
    for (let k = 0; k < b.x.length; k++) {
      const c = canon[base + k] ?? base + k;
      b.x[k] = X[c] ?? 0;
      b.r[k] = R[c] ?? 0;
    }
  });
  return { sweeps: opts.sweeps, freeNodes: nFree, firstMaxMove, lastMaxMove };
}
