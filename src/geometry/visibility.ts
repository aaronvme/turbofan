// Which parts and rows the closed engine (realistic mode: cowls on, no cutaway, not exploded)
// can show at all, so the renderer can skip the rest (LD-6: 2,272 of the 2,296 blades and
// most internals sit behind the cowls).
//
// Something is hidden when it lies wholly
// - inside the inner body (strictly below the hub surface: disks, bores, shafts), which is a
//   closed shell from the spinner to the plug tip; or
// - inside the core cowl between two sight limits: the combustor inlet and the first LPT
//   row. Through the fan gaps one sees every booster row, the transition duct and its
//   fan-frame struts, and the HPC (pass 4, W1L-I1: the old limit at the first booster stator
//   culled booster rows 2-4, which show beside the hub). The rotors are drawn by their own
//   pass, so the main pass's depth reaches past every rotor row into the HPC; the pixel test
//   tests/browser/culling.test.ts pins what shows. Up the core nozzle one sees every LPT
//   stage (stages 1-3 show through the last one). The combustor, the HPT and what the inner
//   body hides (disks, bores, shafts) are what stays culled.
// Everything else is drawn. The tests pin both directions.
//
// View-dependent (lookdev-3): inside the core cowl, what lies ahead of the combustor inlet
// (the booster, the transition duct, the HPC) is reached only through the fan, so only an
// eye ahead of the core inlet (the splitter) can see it; what lies aft of it (the LPT, the
// exhaust, the turbine rear frame) only up the core nozzle, so only an eye aft of the first
// LPT row. Both limits are conservative (the intake opens at the highlight, the nozzle at the
// core lip). The side view draws neither, the front views no LPT: about 0.3-0.8 M fewer
// triangles, and the opaque pass is geometry-bound (lookdev-3 measured it barely scaling with
// resolution).

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
  const hpc = def.flowpath.components.find((c) => c.id === 'combustor');
  const lpt = def.bladeRows.filter((r) => r.component === 'lpt');
  if (hpc === undefined || lpt.length === 0)
    throw new Error('visibility: needs an HPC and LPT rows');
  return {
    xFront: hpc.xStart,
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
  /** Drawn ids seen only through the intake (eye x < eye.front). */
  readonly frontOnly: ReadonlySet<string>;
  /** Drawn ids seen only up the core nozzle (eye x > eye.rear). */
  readonly rearOnly: ReadonlySet<string>;
  readonly eye: { readonly front: number; readonly rear: number };
}

/** Whether every point lies inside the core cowl, ahead of xMax and aft of xMin. */
function insideCoreCowl(points: Iterable<P2>, walls: EngineWalls, xMin: number, xMax: number) {
  const cowl = walls.coreCowl;
  let any = false;
  for (const p of points) {
    any = true;
    const inside =
      p.x >= Math.max(xMin, cowl.xMin) &&
      p.x <= Math.min(xMax, cowl.xMax) &&
      p.r < cowl.radiusAt(p.x) - COWL_SKIN;
    if (!inside) return false;
  }
  return any;
}

/** Whether the closed engine draws this part or row for an eye at x = eyeX (m). */
export function closedViewDraws(set: ClosedViewSet, id: string, eyeX: number): boolean {
  if (!set.parts.has(id) && !set.rows.has(id)) return false;
  if (set.frontOnly.has(id) && !(eyeX < set.eye.front)) return false;
  if (set.rearOnly.has(id) && !(eyeX > set.eye.rear)) return false;
  return true;
}

export function closedViewVisibility(def: EngineDefinition, geo: EngineGeometry): ClosedViewSet {
  const lim = closedViewLimits(def);
  const parts = new Set<string>();
  const rows = new Set<string>();
  const frontOnly = new Set<string>();
  const rearOnly = new Set<string>();
  const classify = (id: string, points: () => Iterable<P2>) => {
    if (insideCoreCowl(points(), geo.walls, -Infinity, lim.xFront)) frontOnly.add(id);
    else if (insideCoreCowl(points(), geo.walls, lim.xFront, Infinity)) rearOnly.add(id);
  };
  for (const p of geo.parts)
    if (!hiddenWhenClosed(p.spec.loop, geo.walls, lim)) {
      parts.add(p.spec.id);
      classify(p.spec.id, () => p.spec.loop);
    }
  for (const r of [...geo.rows, ...geo.struts])
    if (!hiddenWhenClosed(meshPoints(r.blade.mesh.positions), geo.walls, lim)) {
      rows.add(r.row.id);
      classify(r.row.id, () => meshPoints(r.blade.mesh.positions));
    }
  return {
    parts,
    rows,
    frontOnly,
    rearOnly,
    eye: { front: geo.walls.coreCowl.xMin, rear: lim.xRear },
  };
}
