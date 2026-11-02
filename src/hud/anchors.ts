// Callout anchors on the engine: each component's mid-length, mid-span point of the meridional
// flowpath (src/contracts/engine.ts), placed on the side of the axis that faces the camera (where
// the cutaway wedge opens), and projected to CSS pixels with the camera's view-projection matrix.

import { radiusAt, type ComponentId, type EngineDefinition } from '../contracts/engine';
import { explodeOffsets } from '../geometry/explode';
import { engineParts } from '../geometry/parts';
import { engineWalls } from '../geometry/walls';
import type { ViewMode } from '../contracts/ui';

export interface WorldAnchor {
  readonly id: ComponentId;
  readonly name: string;
  readonly x: number;
  readonly r: number;
  /**
   * Higher first: D4-97 item 2's stated priority (fan, combustor, HPT, LPT, exhaust, then HPC,
   * booster, bypass duct), which picks the labels shown when the cut views' rows lack room.
   */
  readonly priority: number;
}

const PRIORITY: Partial<Record<ComponentId, number>> = {
  fan: 9,
  combustor: 8,
  hpt: 7,
  lpt: 6,
  exhaust: 5,
  hpc: 4,
  booster: 3,
  bypassDuct: 2,
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

/**
 * Points round the engine's outside, from the intake lip to `xEnd` (the nacelle, then the core
 * cowl, then the cowl's last radius): rings of 16 for its screen box (the cut views' label rows,
 * Schlieren's framing with its plume).
 */
export function engineRings(def: EngineDefinition, xEnd: number): [number, number, number][] {
  const g = calloutGeometry(def);
  const nac = def.flowpath.curves.nacelleOuter;
  const cowl = def.flowpath.curves.coreCowl;
  const cowlEnd = cowl.points.at(-1)?.r ?? 0;
  const out: [number, number, number][] = [];
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const x = g.lipX + ((xEnd - g.lipX) * k) / n;
    const r = radiusAt(nac, x) ?? radiusAt(cowl, x) ?? cowlEnd;
    for (let j = 0; j < 16; j++) {
      const t = (2 * Math.PI * j) / 16;
      out.push([x, r * Math.cos(t), r * Math.sin(t)]);
    }
  }
  return out;
}

/** Rings of 16 points round the axis at (x, r), appended to `out`. */
function pushRing(out: [number, number, number][], x: number, r: number): void {
  for (let j = 0; j < 16; j++) {
    const t = (2 * Math.PI * j) / 16;
    out.push([x, r * Math.cos(t), r * Math.sin(t)]);
  }
}

/** The wall fillets' samples for Exploded's framing content (the view's default quality's). */
const EXPLODED_WALL_SAMPLES = 3;

/**
 * Exploded's framing content: what the exploded view draws, slid apart at full explode
 * (geometry/explode.ts). W2A-I11 (critic pass 18): every part that is not a skin and every blade
 * row (its edges' hub and tip points), each slid by its module's offset; the skins and the stand
 * are hidden from explode 0.02 (engineView.ts), so of the intake only the fan case is drawn. Round
 * 7 took the intake at the nacelle's outside and the bypass duct, which the view does not draw:
 * Exploded sat off-centre (135 against 32 px at 1366) and 17-21 % smaller than the area allows.
 * Rings of 16 for its screen box.
 */
export function explodedRings(def: EngineDefinition, gap: number): [number, number, number][] {
  const off = explodeOffsets(def, 1, gap);
  const out: [number, number, number][] = [];
  for (const p of engineParts(def, engineWalls(def, EXPLODED_WALL_SAMPLES))) {
    if (p.skin) continue;
    const dx = p.module === null ? 0 : off[p.module];
    for (const q of p.loop) pushRing(out, q.x + dx, Math.abs(q.r));
  }
  for (const row of def.bladeRows)
    for (const e of [row.leadingEdge, row.trailingEdge])
      for (const q of [e.hub, e.tip]) pushRing(out, q.x + off[row.component], q.r);
  return out;
}

/**
 * Critic pass 18's visual note 2: the core jet behind the nozzle, which Schlieren draws as its
 * bands: the tube of the core nozzle's exit radius (the core cowl's last point) from the exit to
 * `xEnd` (the near field's end). Its screen box is kept clear of labels in Schlieren (the Core
 * exhaust label sat on it). Rings of 16.
 */
export function jetRings(def: EngineDefinition, xEnd: number): [number, number, number][] {
  const exit = def.flowpath.curves.coreCowl.points.at(-1);
  if (exit === undefined) throw new Error('anchors: no core nozzle');
  const out: [number, number, number][] = [];
  const n = 8;
  for (let k = 0; k <= n; k++) pushRing(out, exit.x + ((xEnd - exit.x) * k) / n, exit.r);
  return out;
}

/**
 * The core jet's CSS-pixel box behind the nozzle (null: off screen): jetRings' box, cut at the
 * nozzle exit's centre on the jet's side. The exit ring's near side projects in front of the
 * nozzle, over the engine's own silhouette, where Schlieren draws no bands; a label may go there.
 */
export function jetBox(
  m: ArrayLike<number>,
  def: EngineDefinition,
  xEnd: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  const box = screenBox(m, jetRings(def, xEnd), width, height);
  const exit = def.flowpath.curves.coreCowl.points.at(-1);
  if (box === null || exit === undefined) return box;
  const e = projectPoint(m, [exit.x, 0, 0], width, height);
  const f = projectPoint(m, [xEnd, 0, 0], width, height);
  if (!Number.isFinite(e.x) || !Number.isFinite(f.x)) return box;
  const right = f.x >= e.x;
  const x0 = right ? Math.max(box.x, e.x) : box.x;
  const x1 = right ? box.x + box.w : Math.min(box.x + box.w, e.x);
  return x1 > x0 ? { x: x0, y: box.y, w: x1 - x0, h: box.h } : null;
}

/** The CSS-pixel box of the points in view (null: none is). */
export function screenBox(
  m: ArrayLike<number>,
  points: readonly (readonly [number, number, number])[],
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const s = projectPoint(m, p, width, height);
    if (!s.visible) continue;
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
