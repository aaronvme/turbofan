// The whole procedural engine from the EngineDefinition: rounded walls, revolved and capped
// solid parts, and one lofted blade per row with its instance angles. Pure and
// deterministic; the renderer turns it into three.js objects (src/render).

import type { BladeRow, ComponentId, EngineDefinition, Spool } from '../contracts/engine';
import { loftBlade, type BladeGeometry, type BladeOptions } from './blade';
import { capMesh } from './cap';
import type { MeshData } from './mesh';
import { engineParts, type PartSpec } from './parts';
import { revolveLoop } from './revolve';
import { instanceAngles, rowPhase } from './rows';
import { frameStrutRows } from './struts';
import { componentWalls, engineWalls, type EngineWalls } from './walls';

export interface GeometryQuality {
  /** Samples per wall fillet. */
  readonly wallSamples: number;
  /** Columns around the axis for the largest parts (smaller radii get fewer, >= 24). */
  readonly segments: number;
  readonly fanBlade: BladeOptions;
  readonly coreBlade: BladeOptions;
  /** HPT and LPT rows: more span sections than the compressors (close-ups, pass-3 V1). */
  readonly turbineBlade: BladeOptions;
}

export const GEOMETRY_QUALITY = {
  test: {
    wallSamples: 3,
    segments: 24,
    fanBlade: { sections: 5, pointsPerSide: 9 },
    coreBlade: { sections: 3, pointsPerSide: 7 },
    turbineBlade: { sections: 3, pointsPerSide: 7 },
  },
  high: {
    wallSamples: 10,
    segments: 192,
    fanBlade: { sections: 25, pointsPerSide: 45 },
    coreBlade: { sections: 6, pointsPerSide: 15 },
    turbineBlade: { sections: 10, pointsPerSide: 15 },
  },
} as const satisfies Readonly<Record<string, GeometryQuality>>;

/**
 * Triangles per quality preset: the whole model (every part, row and strut, instances
 * counted) and what the closed engine draws (./visibility). The tests hold the geometry to
 * these, so a finer loft is a deliberate budget change.
 */
export const TRIANGLE_BUDGET = {
  test: { total: 260_000, closed: 215_000 },
  high: { total: 1_800_000, closed: 1_560_000 },
} as const satisfies Readonly<
  Record<keyof typeof GEOMETRY_QUALITY, { total: number; closed: number }>
>;

export const ROW_MATERIALS = [
  'fanBlade',
  'compressorBlade',
  'compressorVane',
  'hptBlade',
  'hptVane',
  'lptBlade',
  'lptVane',
  'strut',
] as const;
export type RowMaterial = (typeof ROW_MATERIALS)[number];

export interface RowGeometry {
  readonly row: BladeRow;
  readonly index: number;
  readonly blade: BladeGeometry;
  readonly angles: Float64Array;
  readonly phase: number;
  readonly spool: Spool | null;
  readonly module: ComponentId;
  readonly material: RowMaterial;
}

export interface PartGeometry {
  readonly spec: PartSpec;
  readonly mesh: MeshData;
  /** The cross-section face in the (x, r, 0) plane, facing +z. */
  readonly cap: MeshData;
  readonly rMax: number;
}

export interface EngineGeometry {
  readonly walls: EngineWalls;
  readonly parts: readonly PartGeometry[];
  /** One per definition row, in its order. */
  readonly rows: readonly RowGeometry[];
  /** Synthesized frame struts (./struts), visual only. */
  readonly struts: readonly RowGeometry[];
}

function rowMaterial(row: BladeRow): RowMaterial {
  const rotor = row.kind === 'rotor';
  if (row.component === 'fan') return 'fanBlade';
  if (row.component === 'hpt') return rotor ? 'hptBlade' : 'hptVane';
  if (row.component === 'lpt') return rotor ? 'lptBlade' : 'lptVane';
  return rotor ? 'compressorBlade' : 'compressorVane';
}

export function buildEngineGeometry(def: EngineDefinition, q: GeometryQuality): EngineGeometry {
  const walls = engineWalls(def, q.wallSamples);
  const parts = engineParts(def, walls).map((spec): PartGeometry => {
    const rMax = Math.max(...spec.loop.map((p) => p.r));
    // keep the chord error about constant: columns scale with radius
    const segments = Math.max(24, Math.round((q.segments * Math.min(1, rMax / 0.8)) / 4) * 4);
    return { spec, mesh: revolveLoop(spec.loop, { segments }), cap: capMesh(spec.loop), rMax };
  });
  const rows = def.bladeRows.map((row, index): RowGeometry => {
    const c = def.flowpath.components.find((k) => k.id === row.component);
    if (c === undefined) throw new Error(`engineGeometry: no component ${row.component}`);
    const turbine = row.component === 'hpt' || row.component === 'lpt';
    const options = row.component === 'fan' ? q.fanBlade : turbine ? q.turbineBlade : q.coreBlade;
    const phase = rowPhase(index);
    return {
      row,
      index,
      blade: loftBlade(row, componentWalls(walls, c), options),
      angles: instanceAngles(row.count, phase),
      phase,
      spool: row.kind === 'rotor' && row.spool !== 'none' ? row.spool : null,
      module: row.component,
      material: rowMaterial(row),
    };
  });
  const wallFor = (id: ComponentId) => {
    const c = def.flowpath.components.find((k) => k.id === id);
    if (c === undefined) throw new Error(`engineGeometry: no component ${id}`);
    return componentWalls(walls, c);
  };
  const struts = frameStrutRows(def, (id, side, x) =>
    side === 'hub' ? wallFor(id).hub.radiusAt(x) : wallFor(id).casing.radiusAt(x),
  ).map((row, k): RowGeometry => {
    const index = def.bladeRows.length + k;
    const phase = rowPhase(index);
    return {
      row,
      index,
      blade: loftBlade(row, wallFor(row.component), q.coreBlade),
      angles: instanceAngles(row.count, phase),
      phase,
      spool: null,
      module: row.component,
      material: 'strut',
    };
  });
  return { walls, parts, rows, struts };
}
