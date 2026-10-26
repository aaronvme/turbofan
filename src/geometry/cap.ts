// Cutaway caps. The engine's solids are solids of revolution, so a section plane through the
// axis cuts each one exactly along its meridional loop: the cap of a part is its loop,
// triangulated, in the plane z = 0 of the (x, r) frame, facing +z (the +theta side). The
// renderer turns it to the section angle and mirrors it for the other face of the wedge.

import type { MeshData } from './mesh';
import type { P2 } from './profile';
import { loopAreaCentroid } from './revolve';
import { ix } from './num';

const cross = (a: P2, b: P2, c: P2): number =>
  (b.x - a.x) * (c.r - a.r) - (b.r - a.r) * (c.x - a.x);

function inTriangle(p: P2, a: P2, b: P2, c: P2): boolean {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/**
 * Ear clipping (Meisters 1975) of a simple loop: 3 (n - 2) indices into the loop taken
 * counter-clockwise (a clockwise loop is reversed first, and its indices refer to that order).
 */
export function triangulateLoop(loop: readonly P2[]): Uint32Array {
  const n = loop.length;
  if (n < 3) throw new Error('triangulateLoop: needs at least three points');
  const ccw = loopAreaCentroid(loop).area > 0 ? loop : [...loop].reverse();
  const pt = (i: number): P2 => ccw[i] ?? { x: 0, r: 0 };
  const next = Int32Array.from({ length: n }, (_, i) => (i + 1) % n);
  const prev = Int32Array.from({ length: n }, (_, i) => (i + n - 1) % n);
  const out: number[] = [];
  let remaining = n;
  let i = 0;
  let guard = 0;
  while (remaining > 3) {
    const a = ix(prev, i);
    const c = ix(next, i);
    const pa = pt(a);
    const pb = pt(i);
    const pc = pt(c);
    let ear = cross(pa, pb, pc) > 0;
    if (ear) {
      for (let k = ix(next, c); k !== a; k = ix(next, k)) {
        const q = pt(k);
        // a reflex vertex inside the candidate would be cut off
        if (cross(pt(ix(prev, k)), q, pt(ix(next, k))) <= 0 && inTriangle(q, pa, pb, pc)) {
          if (!(q.x === pa.x && q.r === pa.r) && !(q.x === pc.x && q.r === pc.r)) {
            ear = false;
            break;
          }
        }
      }
    }
    if (ear) {
      out.push(a, i, c);
      next[a] = c;
      prev[c] = a;
      remaining--;
      guard = 0;
      i = c;
    } else {
      i = ix(next, i);
      if (++guard > 2 * remaining) {
        // no ear found (a degenerate or self-touching loop): clip the flattest corner
        out.push(ix(prev, i), i, ix(next, i));
        next[ix(prev, i)] = ix(next, i);
        prev[ix(next, i)] = ix(prev, i);
        remaining--;
        guard = 0;
        i = ix(next, i);
      }
    }
  }
  out.push(ix(prev, i), i, ix(next, i));
  return new Uint32Array(out);
}

/** The cap mesh of a loop: (x, r, 0) positions, normal +z, uv = (x, r) in metres. */
export function capMesh(loop: readonly P2[]): MeshData {
  const ccw = loopAreaCentroid(loop).area > 0 ? loop : [...loop].reverse();
  const n = ccw.length;
  const positions = new Float32Array(3 * n);
  const normals = new Float32Array(3 * n);
  const uvs = new Float32Array(2 * n);
  const tangents = new Float32Array(4 * n);
  ccw.forEach((p, i) => {
    positions.set([p.x, p.r, 0], 3 * i);
    normals.set([0, 0, 1], 3 * i);
    uvs.set([p.x, p.r], 2 * i);
    tangents.set([1, 0, 0, 1], 4 * i);
  });
  return { positions, normals, uvs, tangents, indices: triangulateLoop(ccw) };
}
