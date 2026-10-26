// Lofted blades: sections from ./airfoil stacked from hub to tip of a definition row.
//
// - Span fraction eta in [0, 1]. Section parameters (metal angles, thickness) follow the
//   parabola through the definition's hub, mid and tip values.
// - Meridional placement: the leading and trailing edges run straight from the definition's
//   hub point to its tip point (that is the row's sweep), and a point at chord fraction f of a
//   section sits at x = lerp(x_LE, x_TE, f), r = (1 - eta) hub(x) + eta (casing(x) - gap), on
//   the rendered (smoothed) walls. The hub section therefore lies on the hub surface, the tip
//   section exactly one tip clearance (`gap`, rotors only) inside the casing, and the whole
//   blade inside its annulus.
// - Tangential placement: each section is stacked on its area centroid (rotor practice: no
//   centrifugal bending), the stacking line leaning by the row's `lean`; theta = t / r.
// - The mesh is closed: ring quads between sections plus flat hub and tip caps on their own
//   vertices (hard edges), triangulated station by station between the two sides.

import type { BladeRow, SpanValues } from '../contracts/engine';
import {
  airfoilSection,
  type AirfoilSection,
  type BladeToBladePoint,
  type ProfileFamily,
} from './airfoil';
import { computeNormals, flipMesh, meshTopology, type MeshData } from './mesh';
import type { P2 } from './profile';
import type { AnnulusWalls } from './walls';
import { ix } from './num';

/** The parabola through (0, hub), (0.5, mid), (1, tip). */
export function spanValue(v: SpanValues, eta: number): number {
  const a = v.hub;
  const b = -3 * v.hub + 4 * v.mid - v.tip;
  const c = 2 * v.hub - 4 * v.mid + 2 * v.tip;
  return a + b * eta + c * eta * eta;
}

/** The section family a row is drawn with (see ./airfoil). */
export function rowProfileFamily(row: BladeRow): ProfileFamily {
  if (row.component === 'hpt' || row.component === 'lpt') return 'turbine';
  if (row.component === 'fan' && row.kind === 'rotor') return 'dca';
  return 'naca65';
}

export interface BladeOptions {
  /** Sections from hub to tip (>= 2). */
  readonly sections: number;
  /** Chord stations per side (>= 3). */
  readonly pointsPerSide: number;
}

export interface BladeGeometry {
  readonly mesh: MeshData;
  readonly family: ProfileFamily;
  /** Angular extent of the vertices about +x, rad, around the stacking angle 0. */
  readonly thetaMin: number;
  readonly thetaMax: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly rMin: number;
  readonly rMax: number;
  /** Side-surface vertex indices of the hub and tip sections. */
  readonly hubRing: Uint32Array;
  readonly tipRing: Uint32Array;
  /** The leading-edge point of each section, hub to tip. */
  readonly leadingEdge: readonly P2[];
  /** Chord angle of each section, rad. */
  readonly sectionStagger: readonly number[];
}

interface PlacedSection {
  readonly eta: number;
  readonly section: AirfoilSection;
  /** xyz of each loop point. */
  readonly xyz: readonly (readonly [number, number, number])[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function placeSection(row: BladeRow, walls: AnnulusWalls, eta: number, n: number): PlacedSection {
  const gap = row.kind === 'rotor' ? row.tipClearance : 0;
  const rAt = (x: number) =>
    (1 - eta) * walls.hub.radiusAt(x) + eta * (walls.casing.radiusAt(x) - gap);
  const xLe = lerp(row.leadingEdge.hub.x, row.leadingEdge.tip.x, eta);
  const xTe = lerp(row.trailingEdge.hub.x, row.trailingEdge.tip.x, eta);
  const meridionalLength = Math.hypot(xTe - xLe, rAt(xTe) - rAt(xLe));
  const section = airfoilSection({
    family: rowProfileFamily(row),
    inletAngle: spanValue(row.inletMetalAngle, eta),
    exitAngle: spanValue(row.exitMetalAngle, eta),
    maxThickness: spanValue(row.maxThicknessRatio, eta),
    meridionalLength,
    pointsPerSide: n,
  });
  const rStack = rAt(lerp(xLe, xTe, 0.5));
  const rHubStack = walls.hub.radiusAt(lerp(row.leadingEdge.hub.x, row.trailingEdge.hub.x, 0.5));
  const leanOffset = Math.tan(row.lean) * (rStack - rHubStack);
  const xyz = section.points.map((p: BladeToBladePoint): [number, number, number] => {
    const f = p.m / meridionalLength;
    const x = lerp(xLe, xTe, f);
    const r = rAt(x);
    const theta = (p.t - section.centroid.t + leanOffset) / r;
    return [x, r * Math.cos(theta), r * Math.sin(theta)];
  });
  return { eta, section, xyz };
}

/** A closed, outward-facing blade mesh for one row, stacked at theta = 0. */
export function loftBlade(
  row: BladeRow,
  walls: AnnulusWalls,
  options: BladeOptions,
): BladeGeometry {
  const k = options.sections;
  const n = options.pointsPerSide;
  if (!(Number.isInteger(k) && k >= 2)) throw new Error('loftBlade: sections >= 2');
  if (!(Number.isInteger(n) && n >= 3)) throw new Error('loftBlade: pointsPerSide >= 3');
  const sections: PlacedSection[] = [];
  for (let j = 0; j < k; j++) sections.push(placeSection(row, walls, j / (k - 1), n));
  const loop = 2 * n - 2;
  const side = k * loop;
  const capVerts = 2 * loop;
  const nVert = side + capVerts;
  const positions = new Float32Array(3 * nVert);
  const uvs = new Float32Array(2 * nVert);
  const u = (i: number) => (i <= n - 1 ? i / (n - 1) : (loop - i) / (n - 1));
  const put = (v: number, p: readonly [number, number, number], uu: number, vv: number) => {
    positions.set(p, 3 * v);
    uvs[2 * v] = uu;
    uvs[2 * v + 1] = vv;
  };
  sections.forEach((s, j) => {
    s.xyz.forEach((p, i) => {
      put(j * loop + i, p, u(i), s.eta);
    });
  });
  const hubCap = side;
  const tipCap = side + loop;
  const hubSec = sections[0];
  const tipSec = sections[k - 1];
  if (hubSec === undefined || tipSec === undefined) throw new Error('loftBlade: no sections');
  hubSec.xyz.forEach((p, i) => {
    put(hubCap + i, p, u(i), 0);
  });
  tipSec.xyz.forEach((p, i) => {
    put(tipCap + i, p, u(i), 1);
  });

  const idx: number[] = [];
  for (let j = 0; j + 1 < k; j++) {
    for (let i = 0; i < loop; i++) {
      const a = j * loop + i;
      const b = j * loop + ((i + 1) % loop);
      const c = (j + 1) * loop + ((i + 1) % loop);
      const d = (j + 1) * loop + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  // caps: strip between the two sides, station by station; the hub cap runs against the
  // side triangles' hub edges (a -> b), the tip cap against their tip edges (c -> d)
  const lower = (i: number) => i;
  const upper = (i: number) => (i === 0 ? 0 : i === n - 1 ? n - 1 : loop - i);
  for (let i = 0; i + 1 < n; i++) {
    const l0 = lower(i);
    const l1 = lower(i + 1);
    const u0 = upper(i);
    const u1 = upper(i + 1);
    if (u1 !== l1) {
      idx.push(hubCap + l0, hubCap + u1, hubCap + l1);
      idx.push(tipCap + l0, tipCap + l1, tipCap + u1);
    }
    if (u0 !== l0) {
      idx.push(hubCap + l0, hubCap + u0, hubCap + u1);
      idx.push(tipCap + l0, tipCap + u1, tipCap + u0);
    }
  }
  const indices = new Uint32Array(idx);
  const mesh: MeshData = {
    positions,
    indices,
    uvs,
    normals: computeNormals(positions, indices),
    tangents: new Float32Array(4 * nVert),
  };
  if (meshTopology(mesh).signedVolume < 0) flipMesh(mesh);
  spanTangents(mesh, k, loop);

  let thetaMin = Infinity;
  let thetaMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  let rMin = Infinity;
  let rMax = -Infinity;
  for (let v = 0; v < nVert; v++) {
    const x = ix(positions, 3 * v);
    const y = ix(positions, 3 * v + 1);
    const z = ix(positions, 3 * v + 2);
    const th = Math.atan2(z, y);
    const r = Math.hypot(y, z);
    thetaMin = Math.min(thetaMin, th);
    thetaMax = Math.max(thetaMax, th);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  const ring = (j: number) => Uint32Array.from({ length: loop }, (_, i) => j * loop + i);
  return {
    mesh,
    family: rowProfileFamily(row),
    thetaMin,
    thetaMax,
    xMin,
    xMax,
    rMin,
    rMax,
    hubRing: ring(0),
    tipRing: ring(k - 1),
    leadingEdge: sections.map((s) => {
      const p = s.xyz[0] ?? [0, 0, 0];
      return { x: p[0], r: Math.hypot(p[1], p[2]) };
    }),
    sectionStagger: sections.map((s) => s.section.chordAngle),
  };
}

/**
 * Tangents for anisotropic shading: the spanwise direction on the side surface (polishing
 * marks on a fan blade run along the span), the chordwise direction on the caps, each made
 * orthogonal to the vertex normal.
 */
function spanTangents(mesh: MeshData, k: number, loop: number): void {
  const p = mesh.positions;
  const nrm = mesh.normals;
  const side = k * loop;
  const total = p.length / 3;
  for (let v = 0; v < total; v++) {
    let a: number;
    let b: number;
    if (v < side) {
      const j = Math.floor(v / loop);
      const i = v % loop;
      a = Math.min(j + 1, k - 1) * loop + i;
      b = Math.max(j - 1, 0) * loop + i;
    } else {
      // caps: from this vertex's station toward the trailing edge of its own ring
      const base = v < side + loop ? side : side + loop;
      a = base + Math.floor(loop / 2);
      b = base;
    }
    let tx = ix(p, 3 * a) - ix(p, 3 * b);
    let ty = ix(p, 3 * a + 1) - ix(p, 3 * b + 1);
    let tz = ix(p, 3 * a + 2) - ix(p, 3 * b + 2);
    const nx = ix(nrm, 3 * v);
    const ny = ix(nrm, 3 * v + 1);
    const nz = ix(nrm, 3 * v + 2);
    const d = tx * nx + ty * ny + tz * nz;
    tx -= d * nx;
    ty -= d * ny;
    tz -= d * nz;
    // never zero on a lofted blade: the span and chord directions are not along the normal
    const len = Math.hypot(tx, ty, tz) || 1;
    mesh.tangents[4 * v] = tx / len;
    mesh.tangents[4 * v + 1] = ty / len;
    mesh.tangents[4 * v + 2] = tz / len;
    mesh.tangents[4 * v + 3] = 1;
  }
}
