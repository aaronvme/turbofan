// Which parts and rows the closed engine (realistic mode: cowls on, no cutaway, not exploded)
// can show at all, so the renderer can skip the rest (LD-6: 2,272 of the 2,296 blades and
// most internals sit behind the cowls).
//
// Something is hidden when it lies wholly
// - inside the inner body (strictly below the hub surface: disks, bores, shafts), which is a
//   closed shell from the spinner to the plug tip; or
// - inside the core cowl between two sight limits: aft of the booster's last row and ahead of
//   the first LPT row. Through the fan gaps one sees every booster row (pass 4, W1L-I1: the
//   old limit at the first booster stator culled rows 2-4, which show beside the hub), and
//   up the core nozzle every LPT stage (stages 1-3 show through the last one). The HPC, the
//   combustor, the HPT, the cases between and the disks are what stays culled.
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
  const booster = def.bladeRows.filter((r) => r.component === 'booster');
  const lpt = def.bladeRows.filter((r) => r.component === 'lpt');
  if (booster.length === 0 || lpt.length === 0)
    throw new Error('visibility: needs booster and LPT rows');
  return {
    xFront: Math.max(...booster.map((r) => Math.max(r.trailingEdge.hub.x, r.trailingEdge.tip.x))),
    xRear: Math.min(...lpt.map((r) => Math.min(r.leadingEdge.hub.x, r.leadingEdge.tip.x))),
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
