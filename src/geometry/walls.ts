// The rendered engine's walls: the definition's curves, rounded (./profile), as r(x).
//
// - hub: spinner + coreInner + plug as one curve from the nose to the plug tip.
// - The splitter lip (coreOuter / coreCowl) and the intake highlight (nacelleInner /
//   nacelleOuter) are rounded: each curve names the other curve's second point as its phantom
//   neighbour, so the two halves of one fillet meet at its apex with one tangent.
// - Every other curve end stays on its definition point, so the nozzle lips keep the
//   definition's blunt bases.

import type { CurveId, EngineDefinition, FlowComponent, Polyline } from '../contracts/engine';
import { monotoneInX, roundedPolyline, WallCurve, type P2 } from './profile';

export const WALL_IDS = ['hub', 'coreOuter', 'coreCowl', 'nacelleInner', 'nacelleOuter'] as const;
export type WallId = (typeof WALL_IDS)[number];

/** A wall as a function of x, plus the full smoothed path (which may turn back at a lip). */
export class EngineWall extends WallCurve {
  readonly path: readonly P2[];
  constructor(path: readonly P2[]) {
    super(monotoneInX(path));
    this.path = path;
  }
}

export type EngineWalls = Readonly<Record<WallId, EngineWall>>;

const second = (c: Polyline): P2 => {
  const p = c.points[1];
  if (p === undefined) throw new Error('walls: a curve needs two points');
  return p;
};

/** Fillet leg used for the engine walls, m (see ./profile). */
export const WALL_BLEND = 0.025;
/**
 * Fillet legs at the lips, m. The splitter turns the wall by ~150 degrees, so a 4 mm leg
 * (about a real splitter's nose) keeps its apex within 2 mm of the point; the highlight turns
 * by only ~28 degrees and takes a 15 mm leg.
 */
export const SPLITTER_BLEND = 0.004;
export const HIGHLIGHT_BLEND = 0.015;

/** The rounded walls of the definition, `samplesPerFillet` samples on each fillet. */
export function engineWalls(def: EngineDefinition, samplesPerFillet: number): EngineWalls {
  const c = def.flowpath.curves;
  const o = { samplesPerFillet, blend: WALL_BLEND };
  const hubPoints = [
    ...c.spinner.points,
    ...c.coreInner.points.slice(1),
    ...c.plug.points.slice(1),
  ];
  const lip = (other: Polyline, endBlend: number) => ({ ...o, before: second(other), endBlend });
  return {
    hub: new EngineWall(roundedPolyline(hubPoints, o)),
    coreOuter: new EngineWall(roundedPolyline(c.coreOuter.points, lip(c.coreCowl, SPLITTER_BLEND))),
    coreCowl: new EngineWall(roundedPolyline(c.coreCowl.points, lip(c.coreOuter, SPLITTER_BLEND))),
    nacelleInner: new EngineWall(
      roundedPolyline(c.nacelleInner.points, lip(c.nacelleOuter, HIGHLIGHT_BLEND)),
    ),
    nacelleOuter: new EngineWall(
      roundedPolyline(c.nacelleOuter.points, lip(c.nacelleInner, HIGHLIGHT_BLEND)),
    ),
  };
}

/** Which rendered wall a definition curve is part of. */
export function wallOf(curve: CurveId): WallId {
  switch (curve) {
    case 'spinner':
    case 'coreInner':
    case 'plug':
      return 'hub';
    default:
      return curve;
  }
}

export interface AnnulusWalls {
  readonly hub: WallCurve;
  readonly casing: WallCurve;
}

/** The hub and casing walls of a flowpath component. */
export function componentWalls(walls: EngineWalls, component: FlowComponent): AnnulusWalls {
  return { hub: walls[wallOf(component.hub)], casing: walls[wallOf(component.casing)] };
}
