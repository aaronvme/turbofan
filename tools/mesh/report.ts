// The numbers docs/MESH.md quotes for a built engine mesh: counts against the target, per-block
// quality, the worst value of each metric, cells across each annulus, cells per blade chord, the
// radial spacing at the nozzle lips and the domain extents. Pure (the generator script writes it).
import type { BlockName, EngineMesh } from './engineMesh';
import { keyPoints } from './geometry/flowpath';
import { meshQuality, type BlockQuality, type Where } from './metrics';
import { nodeIndex, type Block, type Pt } from './types';

export interface Worst {
  readonly value: number;
  readonly block: string;
  readonly at?: Where;
}

export interface EngineMeshReport {
  readonly spec: string;
  readonly targetCells: number;
  readonly totalCells: number;
  /** totalCells / targetCells - 1. */
  readonly deviation: number;
  readonly blocks: readonly BlockQuality[];
  readonly worst: {
    readonly minJacobian: Worst;
    readonly minScaledJacobian: Worst;
    readonly maxStretch: Worst;
    readonly maxSkewDeg: Worst;
    readonly maxAspect: Worst;
    readonly wallOrthoMaxDeg: Worst;
    readonly interfaceOrthoMaxDeg: Worst;
    readonly interfaceKinkMaxDeg: Worst;
    /** Shortest cell edge (sets the explicit time step). */
    readonly minEdge: Worst;
  };
  /** Cells across each block (its j direction): annulus counts for the ducts and jets. */
  readonly cellsAcross: Readonly<Record<BlockName, number>>;
  /** Cell centres inside each blade row's axial extent, on the duct block's mid-span grid line. */
  readonly cellsPerChord: readonly {
    readonly name: string;
    readonly duct: string;
    readonly chord: number;
    readonly cells: number;
  }[];
  /** Radial size of the cells touching both nozzle lips, inside and outside the lip (m). */
  readonly lipSpacing: {
    readonly bypassInside: number;
    readonly bypassOutside: number;
    readonly coreInside: number;
    readonly coreOutside: number;
  };
  readonly domain: {
    readonly xIn: number;
    readonly xOut: number;
    readonly rOut: number;
    readonly D: number;
    /** Highlight to inflow, maximum radius, and core lip to outflow, in fan diameters. */
    readonly upstreamD: number;
    readonly radialD: number;
    readonly downstreamD: number;
  };
}

function nodeAt(b: Block, i: number, j: number): Pt {
  const k = nodeIndex(b, i, j);
  return { x: b.x[k] ?? NaN, r: b.r[k] ?? NaN };
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.r - b.r);

function worstOf(
  q: readonly BlockQuality[],
  value: (b: BlockQuality) => number,
  pick: 'min' | 'max',
  at?: (b: BlockQuality) => Where,
): Worst {
  let best: BlockQuality | undefined;
  for (const b of q) {
    if (best === undefined || (pick === 'max' ? value(b) > value(best) : value(b) < value(best)))
      best = b;
  }
  if (best === undefined) throw new Error('a mesh report needs at least one block');
  return at === undefined
    ? { value: value(best), block: best.name }
    : { value: value(best), block: best.name, at: at(best) };
}

export function engineMeshReport(mesh: EngineMesh): EngineMeshReport {
  const q = meshQuality(mesh);
  const block = (name: BlockName): Block => {
    const b = mesh.blocks[mesh.index[name]];
    if (b === undefined) throw new Error(`no block ${name}`);
    return b;
  };
  const cellsAcross = Object.fromEntries(
    Object.keys(mesh.index).map((name) => [name, block(name as BlockName).nj]),
  ) as Record<BlockName, number>;

  const ductBlock = { fan: 'fan', bypass: 'bypass', core: 'core' } as const;
  const cellsPerChord = mesh.geometry.bladeRows.map((row) => {
    const b = block(ductBlock[row.duct]);
    const j = Math.floor(b.nj / 2);
    let cells = 0;
    for (let i = 0; i < b.ni; i++) {
      const xc =
        0.25 *
        (nodeAt(b, i, j).x +
          nodeAt(b, i + 1, j).x +
          nodeAt(b, i, j + 1).x +
          nodeAt(b, i + 1, j + 1).x);
      if (xc >= row.xLE && xc <= row.xTE) cells++;
    }
    return { name: row.name, duct: row.duct, chord: row.xTE - row.xLE, cells };
  });

  const aft = block('afterbody');
  const outer = block('plume-outer');
  const plug = block('plug');
  const pb = block('plume-bypass');
  const lipSpacing = {
    bypassInside: dist(nodeAt(aft, 0, aft.nj), nodeAt(aft, 0, aft.nj - 1)),
    bypassOutside: dist(nodeAt(outer, 0, 0), nodeAt(outer, 0, 1)),
    coreInside: dist(nodeAt(plug, 0, plug.nj), nodeAt(plug, 0, plug.nj - 1)),
    coreOutside: dist(nodeAt(pb, 0, 0), nodeAt(pb, 0, 1)),
  };

  const kp = keyPoints(mesh.geometry);
  const { xIn, xOut, rOut, D } = mesh.domain;
  return {
    spec: mesh.spec.name,
    targetCells: mesh.spec.targetCells,
    totalCells: mesh.totalCells,
    deviation: mesh.totalCells / mesh.spec.targetCells - 1,
    blocks: q,
    worst: {
      minJacobian: worstOf(q, (b) => b.minJacobian, 'min'),
      minScaledJacobian: worstOf(q, (b) => b.minScaledJacobian, 'min'),
      maxStretch: worstOf(
        q,
        (b) => b.maxStretch,
        'max',
        (b) => b.maxStretchAt,
      ),
      maxSkewDeg: worstOf(
        q,
        (b) => b.maxSkewDeg,
        'max',
        (b) => b.maxSkewAt,
      ),
      maxAspect: worstOf(
        q,
        (b) => b.aspectMax,
        'max',
        (b) => b.aspectMaxAt,
      ),
      wallOrthoMaxDeg: worstOf(q, (b) => b.wallOrthoMaxDeg, 'max'),
      interfaceOrthoMaxDeg: worstOf(q, (b) => b.interfaceOrthoMaxDeg, 'max'),
      interfaceKinkMaxDeg: worstOf(q, (b) => b.interfaceKinkMaxDeg, 'max'),
      minEdge: worstOf(q, (b) => b.minEdge, 'min'),
    },
    cellsAcross,
    cellsPerChord,
    lipSpacing,
    domain: {
      xIn,
      xOut,
      rOut,
      D,
      upstreamD: (kp.highlight.x - xIn) / D,
      radialD: rOut / D,
      downstreamD: (xOut - kp.coreLip.x) / D,
    },
  };
}
