// Algebraic block generation.
//
// tfi(): linear transfinite interpolation from four discrete edges (Gordon & Hall 1973) with the
// arc-length blending of Soni (1985): the interior parameter pair (xi, eta) at node (i, j) is
// solved from the normalised arc lengths of opposite edges, so clustering on the edges carries into
// the interior. Boundary nodes are copied, so they reproduce the input curves bitwise.
//
// twoBoundary(): straight connectors between an inner (wall) and an outer node row with a per-
// column distribution of fractions. Used for the C-block, where the wall-normal clustering must vary
// around the lip and so cannot come from the two end faces alone.
import { nodeIndex, type Block, type Pt } from './types';

function arcFractions(edge: readonly Pt[]): Float64Array {
  const n = edge.length - 1;
  const s = new Float64Array(n + 1);
  for (let k = 1; k <= n; k++) {
    const a = edge[k - 1] as Pt;
    const b = edge[k] as Pt;
    s[k] = (s[k - 1] ?? 0) + Math.hypot(b.x - a.x, b.r - a.r);
  }
  const total = s[n] ?? 1;
  for (let k = 1; k < n; k++) s[k] = (s[k] ?? 0) / total;
  s[n] = 1;
  return s;
}

function sameCorner(a: Pt | undefined, b: Pt | undefined, what: string): void {
  if (a === undefined || b === undefined || a.x !== b.x || a.r !== b.r) {
    throw new Error(`TFI corner mismatch at ${what}`);
  }
}

/**
 * Block from its four edges: south (j = 0) and north (j = nj) run in +i, west (i = 0) and east
 * (i = ni) run in +j. Corners must coincide bitwise.
 */
export function tfi(
  name: string,
  south: readonly Pt[],
  north: readonly Pt[],
  west: readonly Pt[],
  east: readonly Pt[],
): Block {
  const ni = south.length - 1;
  const nj = west.length - 1;
  if (north.length !== ni + 1 || east.length !== nj + 1 || ni < 1 || nj < 1) {
    throw new Error(`TFI edge counts disagree for block ${name}`);
  }
  sameCorner(south[0], west[0], `${name} SW`);
  sameCorner(south[ni], east[0], `${name} SE`);
  sameCorner(north[0], west[nj], `${name} NW`);
  sameCorner(north[ni], east[nj], `${name} NE`);
  const sS = arcFractions(south);
  const sN = arcFractions(north);
  const tW = arcFractions(west);
  const tE = arcFractions(east);
  const P00 = south[0] as Pt;
  const P10 = south[ni] as Pt;
  const P01 = north[0] as Pt;
  const P11 = north[ni] as Pt;
  const x = new Float64Array((ni + 1) * (nj + 1));
  const r = new Float64Array((ni + 1) * (nj + 1));
  const block: Block = { name, ni, nj, x, r };
  for (let j = 0; j <= nj; j++) {
    for (let i = 0; i <= ni; i++) {
      const k = nodeIndex(block, i, j);
      let p: Pt;
      if (j === 0) p = south[i] as Pt;
      else if (j === nj) p = north[i] as Pt;
      else if (i === 0) p = west[j] as Pt;
      else if (i === ni) p = east[j] as Pt;
      else {
        const a = sS[i] ?? 0;
        const b = sN[i] ?? 0;
        const c = tW[j] ?? 0;
        const d = tE[j] ?? 0;
        const den = 1 - (b - a) * (d - c);
        const xi = (a + c * (b - a)) / den;
        const eta = (c + a * (d - c)) / den;
        const S = south[i] as Pt;
        const N = north[i] as Pt;
        const W = west[j] as Pt;
        const E = east[j] as Pt;
        p = {
          x:
            (1 - eta) * S.x +
            eta * N.x +
            (1 - xi) * W.x +
            xi * E.x -
            ((1 - xi) * (1 - eta) * P00.x +
              xi * (1 - eta) * P10.x +
              (1 - xi) * eta * P01.x +
              xi * eta * P11.x),
          r:
            (1 - eta) * S.r +
            eta * N.r +
            (1 - xi) * W.r +
            xi * E.r -
            ((1 - xi) * (1 - eta) * P00.r +
              xi * (1 - eta) * P10.r +
              (1 - xi) * eta * P01.r +
              xi * eta * P11.r),
        };
      }
      x[k] = p.x;
      r[k] = p.r;
    }
  }
  return block;
}

/**
 * Block with node (i, j) on the straight segment from inner[i] to outer[i] at fraction
 * fractions(i)[j] (0 at the inner row, 1 at the outer row, nj + 1 entries).
 */
export function twoBoundary(
  name: string,
  inner: readonly Pt[],
  outer: readonly Pt[],
  fractions: (i: number) => ArrayLike<number>,
): Block {
  const ni = inner.length - 1;
  if (outer.length !== ni + 1 || ni < 1) throw new Error(`two-boundary rows disagree for ${name}`);
  const f0 = fractions(0);
  const nj = f0.length - 1;
  if (nj < 1) throw new Error(`two-boundary block ${name} needs at least one cell across`);
  const x = new Float64Array((ni + 1) * (nj + 1));
  const r = new Float64Array((ni + 1) * (nj + 1));
  const block: Block = { name, ni, nj, x, r };
  for (let i = 0; i <= ni; i++) {
    const f = i === 0 ? f0 : fractions(i);
    if (f.length !== nj + 1 || f[0] !== 0 || f[nj] !== 1) {
      throw new Error(
        `two-boundary fractions for ${name} column ${i} must run 0..1 with ${nj + 1} entries`,
      );
    }
    const w = inner[i] as Pt;
    const o = outer[i] as Pt;
    for (let j = 0; j <= nj; j++) {
      const k = nodeIndex(block, i, j);
      if (j === 0) {
        x[k] = w.x;
        r[k] = w.r;
      } else if (j === nj) {
        x[k] = o.x;
        r[k] = o.r;
      } else {
        const fj = f[j] ?? 0;
        x[k] = w.x + fj * (o.x - w.x);
        r[k] = w.r + fj * (o.r - w.r);
      }
    }
  }
  return block;
}
