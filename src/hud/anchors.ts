// Callout anchors on the engine: each component's mid-length, mid-span point of the meridional
// flowpath (src/contracts/engine.ts), placed on the side of the axis that faces the camera (where
// the cutaway wedge opens), and projected to CSS pixels with the camera's view-projection matrix.

import { radiusAt, type ComponentId, type EngineDefinition } from '../contracts/engine';
import type { ViewMode } from '../contracts/ui';

export interface WorldAnchor {
  readonly id: ComponentId;
  readonly name: string;
  readonly x: number;
  readonly r: number;
  /** Callouts for the core components first, the ducts last. */
  readonly priority: number;
}

const PRIORITY: Partial<Record<ComponentId, number>> = {
  fan: 9,
  combustor: 8,
  hpc: 7,
  hpt: 6,
  lpt: 5,
  booster: 4,
  bypassDuct: 3,
  exhaust: 2,
};

export function componentAnchors(def: EngineDefinition): WorldAnchor[] {
  const out: WorldAnchor[] = [];
  for (const c of def.flowpath.components) {
    const p = PRIORITY[c.id];
    if (p === undefined) continue;
    const x = 0.5 * (c.xStart + c.xEnd);
    const hub = radiusAt(def.flowpath.curves[c.hub], x);
    const casing = radiusAt(def.flowpath.curves[c.casing], x);
    if (hub === null || casing === null) continue;
    out.push({ id: c.id, name: c.name, x, r: 0.5 * (hub + casing), priority: p });
  }
  return out;
}

/**
 * The parts the closed engine shows: the fan through the intake and the exhaust's nozzle. In
 * Realistic and Schlieren (whose engine is the closed one, as a silhouette) the nacelle is
 * opaque, so a callout on a core part would point at nothing seen (critic pass 13's visual note;
 * W2A-I3: fewer labels on the core, fewer crossings).
 */
const SEEN_CLOSED: ReadonlySet<ComponentId> = new Set(['fan', 'exhaust']);

/**
 * Whether a mode calls a component out: the cut modes (Cutaway, Data) all, the closed ones
 * (Realistic, Schlieren) what they show, Exploded none (the parts move off the anchors).
 */
export function calloutShownIn(mode: ViewMode, id: ComponentId): boolean {
  if (mode === 'exploded') return false;
  return mode === 'cutaway' || mode === 'data' || SEEN_CLOSED.has(id);
}

/**
 * The CSS-pixel position of a world point under a column-major view-projection matrix (three's
 * Matrix4.elements); not visible behind the camera or outside the depth range.
 */
export function projectPoint(
  m: ArrayLike<number>,
  p: readonly [number, number, number],
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  const e = (i: number) => m[i] ?? 0;
  const [x, y, z] = p;
  const cx = e(0) * x + e(4) * y + e(8) * z + e(12);
  const cy = e(1) * x + e(5) * y + e(9) * z + e(13);
  const cz = e(2) * x + e(6) * y + e(10) * z + e(14);
  const cw = e(3) * x + e(7) * y + e(11) * z + e(15);
  if (!(cw > 1e-6)) return { x: NaN, y: NaN, visible: false };
  const nx = cx / cw;
  const ny = cy / cw;
  const nz = cz / cw;
  return {
    x: ((nx + 1) / 2) * width,
    y: ((1 - ny) / 2) * height,
    visible: nz >= -1 && nz <= 1 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1,
  };
}

/** The world point of an anchor on the side of the axis at angle theta (atan2(z, y)). */
export const anchorWorld = (a: WorldAnchor, theta: number): [number, number, number] => [
  a.x,
  a.r * Math.cos(theta),
  a.r * Math.sin(theta),
];

/** Where the closed views' Fan callout can point (the intake's lip and the fan face). */
export interface CalloutGeometry {
  /** The intake highlight: its axial position and radius, m. */
  readonly lipX: number;
  readonly lipR: number;
  /** The fan face (the fan's leading edge plane), m. */
  readonly fanFaceX: number;
}

export function calloutGeometry(def: EngineDefinition): CalloutGeometry {
  const lip = def.flowpath.curves.nacelleInner.points[0];
  const fan = def.flowpath.components.find((c) => c.id === 'fan');
  if (lip === undefined || fan === undefined) throw new Error('anchors: no intake or fan');
  return { lipX: lip.x, lipR: lip.r, fanFaceX: fan.xStart };
}

/** The camera, and the cutaway wedge's centre and half-width (rad about +x), for the anchors. */
export interface CalloutView {
  readonly eye: readonly [number, number, number];
  readonly cutCenter: number;
  readonly cutHalf: number;
}

/**
 * Whether the eye sees the point through the intake: the sight line crosses the lip's plane
 * inside the lip (with a margin for the lip's own thickness), from in front of it.
 */
export function seenThroughIntake(
  eye: readonly [number, number, number],
  p: readonly [number, number, number],
  g: CalloutGeometry,
): boolean {
  if (!(eye[0] < g.lipX && p[0] > g.lipX)) return false;
  const t = (g.lipX - eye[0]) / (p[0] - eye[0]);
  const y = eye[1] + t * (p[1] - eye[1]);
  const z = eye[2] + t * (p[2] - eye[2]);
  return Math.hypot(y, z) < 0.92 * g.lipR;
}

/**
 * The world point a component's callout points at (D4-92 zz: labels on their parts).
 * - The cut views (Cutaway, Data): the part's mid-length, mid-span point on the upper cut face,
 *   where its section is drawn (the bypass duct's is in the duct, not on the core).
 * - The closed views (Realistic, Schlieren): the Fan at the fan face, on the far side of the
 *   axis, when the eye sees it through the intake, else at the intake lip on the eye's side; the
 *   other parts (the exhaust) on the eye's side, as before.
 */
export function calloutPoint(
  a: WorldAnchor,
  mode: ViewMode,
  v: CalloutView,
  g: CalloutGeometry,
): [number, number, number] {
  const theta = Math.atan2(v.eye[2], v.eye[1]);
  if (mode === 'cutaway' || mode === 'data') {
    const lo = v.cutCenter - v.cutHalf;
    const hi = v.cutCenter + v.cutHalf;
    return anchorWorld(a, Math.cos(hi) > Math.cos(lo) ? hi : lo);
  }
  if (a.id !== 'fan') return anchorWorld(a, theta);
  const face: [number, number, number] = [
    g.fanFaceX,
    a.r * Math.cos(theta + Math.PI),
    a.r * Math.sin(theta + Math.PI),
  ];
  if (seenThroughIntake(v.eye, face, g)) return face;
  return [g.lipX, g.lipR * Math.cos(theta), g.lipR * Math.sin(theta)];
}
