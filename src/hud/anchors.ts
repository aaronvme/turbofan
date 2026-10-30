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
 * Realistic the nacelle is opaque, so a callout on a core part would point at nothing seen
 * (critic pass 13's visual note; W2A-I3: fewer labels on the core, fewer crossings).
 */
const SEEN_CLOSED: ReadonlySet<ComponentId> = new Set(['fan', 'exhaust']);

/** Whether a mode calls a component out: the open modes all, Realistic what it shows, Exploded none. */
export function calloutShownIn(mode: ViewMode, id: ComponentId): boolean {
  if (mode === 'exploded') return false;
  return mode !== 'realistic' || SEEN_CLOSED.has(id);
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
