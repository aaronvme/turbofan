// Solids of revolution: a closed meridional loop in (x, r) turned about the +x axis.
//
// - Points on the axis (r = 0) become poles (one triangle per column); a loop edge lying on
//   the axis is not a surface and is skipped, so a body that touches the axis still closes.
// - A vertex where the profile turns by more than `sharpAngle` gets two profile nodes with
//   their own normals (a hard edge, e.g. a nozzle lip base); elsewhere normals are smooth.
// - Normals come from the profile (exact for a surface of revolution), tangents run around the
//   axis (lathe-turned surfaces: machining marks are circumferential), u = theta / 2 pi,
//   v = arc length along the loop / total.
// - The loop is taken counter-clockwise, which makes the faces outward (positive volume).

import type { MeshData } from './mesh';
import type { P2 } from './profile';
import { ix } from './num';

export interface RevolveOptions {
  /** Columns around the axis (>= 3). */
  readonly segments: number;
  /** Profile turn above which a vertex is a hard edge, rad. Default 35 degrees. */
  readonly sharpAngle?: number;
}

/** Shoelace area (positive counter-clockwise in x right, r up) and centroid of a loop. */
export function loopAreaCentroid(loop: readonly P2[]): { area: number; centroid: P2 } {
  let a = 0;
  let cx = 0;
  let cr = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    if (p === undefined || q === undefined) continue;
    const cross = p.x * q.r - q.x * p.r;
    a += cross;
    cx += (p.x + q.x) * cross;
    cr += (p.r + q.r) * cross;
  }
  a /= 2;
  return { area: a, centroid: a === 0 ? { x: 0, r: 0 } : { x: cx / (6 * a), r: cr / (6 * a) } };
}

interface ProfileNode {
  readonly p: P2;
  /** Outward 2D normal (nx, nr). */
  readonly n: readonly [number, number];
  readonly v: number;
}

const DEFAULT_SHARP = (35 * Math.PI) / 180;

/** A closed, outward-facing solid of revolution of `loop` (any orientation). */
export function revolveLoop(loop: readonly P2[], options: RevolveOptions): MeshData {
  const s = options.segments;
  if (!(Number.isInteger(s) && s >= 3)) throw new Error('revolveLoop: segments >= 3');
  if (loop.length < 3) throw new Error('revolveLoop: a loop needs at least three points');
  const ccw = loopAreaCentroid(loop).area > 0 ? loop : [...loop].reverse();
  const n = ccw.length;
  const sharp = options.sharpAngle ?? DEFAULT_SHARP;
  const at = (i: number): P2 => ccw[((i % n) + n) % n] ?? { x: 0, r: 0 };
  // counter-clockwise: the outward normal of a segment (dx, dr) is (dr, -dx)
  const segNormal = (i: number): [number, number] => {
    const a = at(i);
    const b = at(i + 1);
    const l = Math.hypot(b.x - a.x, b.r - a.r) || 1;
    return [(b.r - a.r) / l, -(b.x - a.x) / l];
  };
  const arc: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = at(i);
    const b = at(i + 1);
    arc.push(ix(arc, i) + Math.hypot(b.x - a.x, b.r - a.r));
  }
  const total = arc[n] ?? 1;
  // per loop vertex: [node used by the incoming segment, node used by the outgoing segment]
  const nodes: ProfileNode[] = [];
  const inNode: number[] = [];
  const outNode: number[] = [];
  for (let i = 0; i < n; i++) {
    const nIn = segNormal(i - 1);
    const nOut = segNormal(i);
    const turn = Math.acos(Math.max(-1, Math.min(1, nIn[0] * nOut[0] + nIn[1] * nOut[1])));
    const v = ix(arc, i) / total;
    if (turn > sharp) {
      inNode.push(nodes.length);
      nodes.push({ p: at(i), n: nIn, v });
      outNode.push(nodes.length);
      nodes.push({ p: at(i), n: nOut, v });
    } else {
      const mx = nIn[0] + nOut[0];
      const mr = nIn[1] + nOut[1];
      const l = Math.hypot(mx, mr) || 1;
      inNode.push(nodes.length);
      outNode.push(nodes.length);
      nodes.push({ p: at(i), n: [mx / l, mr / l], v });
    }
  }
  const cols = s + 1;
  const nv = nodes.length * cols;
  const positions = new Float32Array(3 * nv);
  const normals = new Float32Array(3 * nv);
  const uvs = new Float32Array(2 * nv);
  const tangents = new Float32Array(4 * nv);
  const cosA = Float64Array.from({ length: cols }, (_, j) =>
    j === s ? 1 : Math.cos((2 * Math.PI * j) / s),
  );
  const sinA = Float64Array.from({ length: cols }, (_, j) =>
    j === s ? 0 : Math.sin((2 * Math.PI * j) / s),
  );
  nodes.forEach((node, k) => {
    for (let j = 0; j < cols; j++) {
      const v = k * cols + j;
      const c = cosA[j] ?? 1;
      const sn = ix(sinA, j);
      positions[3 * v] = node.p.x;
      positions[3 * v + 1] = node.p.r * c;
      positions[3 * v + 2] = node.p.r * sn;
      normals[3 * v] = node.n[0];
      normals[3 * v + 1] = node.n[1] * c;
      normals[3 * v + 2] = node.n[1] * sn;
      uvs[2 * v] = j / s;
      uvs[2 * v + 1] = node.v;
      tangents[4 * v] = 0;
      tangents[4 * v + 1] = -sn;
      tangents[4 * v + 2] = c;
      tangents[4 * v + 3] = 1;
    }
  });
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = at(i);
    const b = at(i + 1);
    if (a.r === 0 && b.r === 0) continue; // on the axis: not a surface
    const ka = ix(outNode, i);
    const kb = ix(inNode, (i + 1) % n);
    for (let j = 0; j < s; j++) {
      const a0 = ka * cols + j;
      const a1 = ka * cols + j + 1;
      const b0 = kb * cols + j;
      const b1 = kb * cols + j + 1;
      if (a.r === 0) idx.push(a0, b0, b1);
      else if (b.r === 0) idx.push(a0, b0, a1);
      else idx.push(a0, b0, b1, a0, b1, a1);
    }
  }
  // (a0, b0, b1) on a counter-clockwise loop faces outward: the tests pin a positive volume
  return { positions, normals, uvs, tangents, indices: new Uint32Array(idx) };
}
