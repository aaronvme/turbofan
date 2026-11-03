// The engine definition's blade rows on the solver mesh (PHYSICS.md 3.3 CP1). The mesh asset
// carries each row's body-force zone as whole cells between its leading- and trailing-edge grid
// lines (docs/MESH.md "Station map and blade-row zones"); this module gives every zone cell the
// row's local geometry from the definition: the chord fraction xi between the edge lines at the
// cell's radius, the span fraction eta between the hub and tip lines, the camber angle, the pitch
// and the blockage of the metal (SOLVER.md 8).
import type { BladeRow, EdgeLine, EngineDefinition, SpanValues } from '../../contracts/engine';
import type { SolverMesh } from '../reference/solverMesh';

/**
 * The smallest |cos kappa| the tangential thickness and the loading use: kappa -> 90 deg would put
 * a blade's whole pitch into metal. The definition's largest camber angle is 1.334 rad (the HPT
 * nozzle's trailing edge, |cos| 0.235), so this floor only guards the formula.
 */
export const MIN_COS_KAMBER = 0.1;

export interface MeshRow {
  readonly row: BladeRow;
  /** The zone's cells (global indices). */
  readonly cells: Int32Array;
  /** Per zone cell: chord fraction (0 at the leading edge, 1 at the trailing edge). */
  readonly xi: Float64Array;
  /** Per zone cell: span fraction (0 at the hub line, 1 at the tip line), clamped to [0, 1]. */
  readonly eta: Float64Array;
  /** Per zone cell: the design camber angle (rad, geometric convention), without a VSV closure. */
  readonly kappa: Float64Array;
  /** Per zone cell: the blade pitch 2 pi r / B, m. */
  readonly pitch: Float64Array;
  /** Per zone cell: the blockage of the metal at the design camber (metalBlockage). */
  readonly blockage: Float64Array;
}

/** x of an edge line (hub point to tip point, straight) at radius r. */
export function edgeX(edge: EdgeLine, r: number): number {
  const dr = edge.tip.r - edge.hub.r;
  if (dr === 0) return edge.hub.x;
  return edge.hub.x + ((edge.tip.x - edge.hub.x) * (r - edge.hub.r)) / dr;
}

/** The chord fraction of (x, r): 0 on the leading-edge line, 1 on the trailing-edge line. */
export function chordFraction(row: BladeRow, x: number, r: number): number {
  const le = edgeX(row.leadingEdge, r);
  return (x - le) / (edgeX(row.trailingEdge, r) - le);
}

/** The span fraction of (x, r) between the hub and tip lines at its chord fraction, in [0, 1]. */
export function spanFraction(row: BladeRow, x: number, r: number): number {
  const xi = chordFraction(row, x, r);
  const hub = row.leadingEdge.hub.r + xi * (row.trailingEdge.hub.r - row.leadingEdge.hub.r);
  const tip = row.leadingEdge.tip.r + xi * (row.trailingEdge.tip.r - row.leadingEdge.tip.r);
  return Math.min(1, Math.max(0, (r - hub) / (tip - hub)));
}

/** A hub/mid/tip value at span fraction eta: piecewise linear, held beyond the ends. */
export function spanValue(v: SpanValues, eta: number): number {
  if (eta <= 0) return v.hub;
  if (eta >= 1) return v.tip;
  return eta < 0.5 ? v.hub + 2 * eta * (v.mid - v.hub) : v.mid + 2 * (eta - 0.5) * (v.tip - v.mid);
}

/**
 * The camber angle at (xi, eta): linear along the chord from the inlet to the exit metal angle,
 * the circular-arc camber line's (its slope angle changes uniformly with the chord).
 */
export function camberAngle(row: BladeRow, xi: number, eta: number): number {
  const a = spanValue(row.inletMetalAngle, eta);
  return a + xi * (spanValue(row.exitMetalAngle, eta) - a);
}

/**
 * The blockage of the metal: 1 - B t / (2 pi r |cos kappa|), the tangential thickness t / |cos kappa|
 * of B blades over the circumference, with the biconvex (circular-arc) thickness
 * t = 4 xi (1 - xi) t_max, t_max = maxThicknessRatio x chord: 1 at both edges, so the gas area is
 * continuous through them.
 */
export function metalBlockage(
  row: BladeRow,
  xi: number,
  eta: number,
  r: number,
  kappa: number,
): number {
  const x = Math.min(1, Math.max(0, xi));
  const t = 4 * x * (1 - x) * spanValue(row.maxThicknessRatio, eta) * spanValue(row.chord, eta);
  const cos = Math.max(Math.abs(Math.cos(kappa)), MIN_COS_KAMBER);
  return 1 - (row.count * t) / (2 * Math.PI * r * cos);
}

/**
 * The camber shift of a variable stator at a VSV closure (rad, positive = closed): the whole vane
 * turns on its spindle toward the HP rotor's direction (more pre-swirl with the rotation, less
 * flow), so both metal angles move by rotation_hp x closure x the row's gain. 0 for a fixed row.
 */
export function vsvCamberShift(def: EngineDefinition, row: BladeRow, closureRad: number): number {
  if (row.vsv === null) return 0;
  return def.rotation.hp * closureRad * row.vsv.gain;
}

/** Every blade row of the definition on its mesh zone, in the definition's order. */
export function meshRows(mesh: SolverMesh, def: EngineDefinition): MeshRow[] {
  return def.bladeRows.map((row) => {
    const zone = mesh.rows.find((z) => z.id === row.id);
    if (zone === undefined) throw new Error(`meshRows: the mesh has no zone for row ${row.id}`);
    const block = mesh.blocks[zone.block];
    if (block === undefined) throw new Error(`meshRows: row ${row.id} names block ${zone.block}`);
    const n = (zone.i1 - zone.i0) * block.nj;
    const out = {
      row,
      cells: new Int32Array(n),
      xi: new Float64Array(n),
      eta: new Float64Array(n),
      kappa: new Float64Array(n),
      pitch: new Float64Array(n),
      blockage: new Float64Array(n),
    };
    let k = 0;
    for (let j = 0; j < block.nj; j++) {
      for (let i = zone.i0; i < zone.i1; i++) {
        const c = block.cellOffset + j * block.ni + i;
        const x = mesh.cellX[c] as number;
        const r = mesh.cellR[c] as number;
        const xi = chordFraction(row, x, r);
        const eta = spanFraction(row, x, r);
        const kappa = camberAngle(row, xi, eta);
        out.cells[k] = c;
        out.xi[k] = xi;
        out.eta[k] = eta;
        out.kappa[k] = kappa;
        out.pitch[k] = (2 * Math.PI * r) / row.count;
        out.blockage[k] = metalBlockage(row, xi, eta, r, kappa);
        k++;
      }
    }
    return out;
  });
}

/** The blockage field of the rows' metal (1 outside every row), per cell. */
export function rowBlockageField(mesh: SolverMesh, rows: readonly MeshRow[]): Float64Array {
  const b = new Float64Array(mesh.nCells).fill(1);
  for (const r of rows) r.cells.forEach((c, k) => (b[c] = r.blockage[k] as number));
  return b;
}
