// Which parts and rows the closed engine (realistic mode: cowls on, no cutaway, not exploded)
// can show at all, so the renderer can skip the rest (LD-6: 2,272 of the 2,296 blades and
// most internals sit behind the cowls).
//
// Something is hidden when it lies wholly
// - inside the inner body (strictly below the hub surface: disks, bores, shafts), which is a
//   closed shell from the spinner to the plug tip; or
// - inside the core cowl between two sight limits: through the fan one sees the booster
//   inlet (IGV, first rotor and stator), through the core nozzle the last LPT stage. The
//   limits are the trailing edge of the first booster stator and the leading edge of the last
//   LPT stator.
// Everything else is drawn. The tests pin both directions.

import type { EngineDefinition } from '../contracts/engine';
import type { EngineGeometry } from './engineGeometry';
import type { P2 } from './profile';
import type { EngineWalls } from './walls';

export interface ClosedViewLimits {
  /** Points aft of this (and inside the core cowl) cannot be seen through the fan, m. */
  readonly xFront: number;
  /** Points ahead of this cannot be seen through the core nozzle, m. */
  readonly xRear: number;
}

/** Depth below the hub surface that still counts as "on" it (drum shells), m. */
const HUB_SHELL = 0.004;
/** The core-cowl skin thickness (parts.ts), m. */
const COWL_SKIN = 0.006;

export function closedViewLimits(def: EngineDefinition): ClosedViewLimits {
  const rows = def.bladeRows;
  const boosterStators = rows.filter((r) => r.component === 'booster' && r.kind === 'stator');
  const lptStators = rows.filter((r) => r.component === 'lpt' && r.kind === 'stator');
  const s1 = boosterStators[0];
  const last = lptStators[lptStators.length - 1];
  if (s1 === undefined || last === undefined)
    throw new Error('visibility: needs a booster stator and an LPT stator');
  return {
    xFront: Math.max(s1.trailingEdge.hub.x, s1.trailingEdge.tip.x),
    xRear: Math.min(last.leadingEdge.hub.x, last.leadingEdge.tip.x),
  };
}

/** True if every point is hidden by the closed engine (see the header). */
export function hiddenWhenClosed(
  points: Iterable<P2>,
  walls: EngineWalls,
  lim: ClosedViewLimits,
): boolean {
  let insideBody = true;
  let insideCore = true;
  let any = false;
  for (const p of points) {
    any = true;
    if (insideBody) {
      const inRange = p.x >= walls.hub.xMin && p.x <= walls.hub.xMax;
      insideBody = inRange && p.r <= walls.hub.radiusAt(p.x) - HUB_SHELL;
    }
    if (insideCore) {
      insideCore =
        p.x > lim.xFront && p.x < lim.xRear && p.r < walls.coreCowl.radiusAt(p.x) - COWL_SKIN;
    }
    if (!insideBody && !insideCore) return false;
  }
  return any;
}

function* meshPoints(positions: Float32Array): Generator<P2> {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    yield { x: positions[i] ?? 0, r: Math.hypot(y, z) };
  }
}

export interface ClosedViewSet {
  /** Part ids drawn by the closed engine. */
  readonly parts: ReadonlySet<string>;
  /** Row ids (blade rows and struts) drawn by the closed engine. */
  readonly rows: ReadonlySet<string>;
}

export function closedViewVisibility(def: EngineDefinition, geo: EngineGeometry): ClosedViewSet {
  const lim = closedViewLimits(def);
  const parts = new Set<string>();
  const rows = new Set<string>();
  for (const p of geo.parts)
    if (!hiddenWhenClosed(p.spec.loop, geo.walls, lim)) parts.add(p.spec.id);
  for (const r of [...geo.rows, ...geo.struts])
    if (!hiddenWhenClosed(meshPoints(r.blade.mesh.positions), geo.walls, lim)) rows.add(r.row.id);
  return { parts, rows };
}
