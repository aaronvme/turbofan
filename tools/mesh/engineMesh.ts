// The 12-block, point-matched engine mesh (docs/MESH.md has the diagram and the reasoning).
//
//   upstream  - inflow x = x_in to the face in front of the inlet lip, axis to far field
//   inlet     - inside the inlet: axis/spinner up to the C-block, from in front of the lip to the fan face
//   lip       - C-block wrapping the nacelle: fan face -> inner wall -> highlight -> outer wall -> bypass lip
//   fan       - fan face (x = 0) to the splitter plane, nCore + nBypass cells hub to casing
//   bypass    - splitter plane to the bypass-nozzle exit plane, nBypass cells
//   core      - one H-block from the splitter plane to the core-nozzle exit plane, nCore cells
//   afterbody - over the core cowl, bypass-nozzle exit to the core-nozzle exit plane
//   plug      - over the plug, core-nozzle exit to the plug tip
//   plume-core, plume-bypass, plume-outer - the three plume blocks, to x_out
//   farfield  - above the C-block and the plume, to r_out and x_out
//
// Construction is algebraic and designed so that the algebraic grid itself meets every quality
// requirement (positive Jacobians, stretching <= 1.15 including across interfaces); the production
// specs run no elliptic smoothing (docs/MESH.md, decision D3). The rules that make that work:
// - Duct walls: nodes are placed by a spacing function along the duct mean line and cut by a
//   smoothed mean-line normal that blends to radial at the station planes (fan face, splitter, both
//   nozzle exits stay exactly radial and exactly where the geometry puts them).
// - Shear layers: each jet boundary line (bypass shear, core shear) carries one radial spacing
//   function h(x) that both blocks on either side use as their end spacing, so the cells match
//   across the line by construction. The downstream blocks are built column by column.
// - Every block that meets the C-block, the far field and the plume blocks re-spaces its grid lines
//   so its first cell equals the neighbour's last, and the per-line targets are smoothed so that
//   grid lines do not step between neighbouring rows.
import {
  alongCurve,
  type DuctCut,
  wallRows,
  cellCount,
  clamp,
  colNodes,
  columnBlock,
  dist,
  ductWalls,
  geometricToEnd,
  nodeAt,
  radialLine,
  respaceColumn,
  rowNodes,
  segment,
  setNode,
  smoothLog,
  smoothstep,
  spacings,
  towardsEnd,
  twoSided,
} from './build';
import { Polyline, bezier, hermitePoints, joinCurves } from './curve';
import { bySpacing, geometric, uniform } from './distribution';
import {
  keyPoints,
  validateFlowpath,
  type BladeRow,
  type Duct,
  type FlowpathGeometry,
} from './geometry/flowpath';
import { smoothMesh, type SmoothOptions, type SmoothReport } from './smooth';
import { tfi, twoBoundary } from './tfi';
import { connect, validateMesh } from './topology';
import { BC, type Block, type Patch, type Pt } from './types';
import type { MultiBlockMesh } from './types';

export const BLOCK_NAMES = [
  'upstream',
  'inlet',
  'lip',
  'fan',
  'bypass',
  'core',
  'afterbody',
  'plug',
  'plume-core',
  'plume-bypass',
  'plume-outer',
  'farfield',
] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

/** Resolution and domain parameters. Lengths in metres; growth = (ratio - 1) per cell. */
export interface MeshSpec {
  readonly name: string;
  readonly targetCells: number;
  /** Cells across the core and the bypass; the fan has nCore + nBypass. */
  readonly nCore: number;
  readonly nBypass: number;
  /** Wall-normal cells of the C-block (also the outer-shear-layer block). */
  readonly nLip: number;
  /** Radial cells of the far-field block. */
  readonly nFar: number;
  /** Target cells per blade axial chord in the duct blocks (the requirement is >= 4). */
  readonly cellsPerChord: number;
  /** Radial spacing at both nozzle lips (the requirement is 8-10 mm). */
  readonly lipRadialSpacing: number;
  /** Axial spacing at both nozzle lips and along the plume lines there. */
  readonly lipAxialSpacing: number;
  readonly fanFaceSpacing: number;
  readonly splitterSpacing: number;
  readonly fanSpacingMax: number;
  readonly coreSpacingMax: number;
  readonly bypassSpacingMax: number;
  /** Axial spacing cap in the combustor (no blades there). */
  readonly combustorSpacing: number;
  /** C-block: wall spacing at the highlight, first wall-normal spacing there, thickness there. */
  readonly highlightSpacing: number;
  readonly lipWallNormalSpacing: number;
  readonly lipThickness: number;
  readonly lipOuterSpacingMax: number;
  /** Radial growth ratio of the C-block column above the bypass lip. */
  readonly bypassLipGrowth: number;
  /** Smoothing length of the C-block wall normals, in local C-block thicknesses. */
  readonly lipNormalSmoothing: number;
  /** Growth allowed by the duct and nacelle spacing functions. */
  readonly gradation: number;
  /** Near plume: axial growth after the lips, plateau spacing, plateau end (D after the core lip). */
  readonly plumeGrowth: number;
  readonly plumeSpacingMax: number;
  readonly nearPlumeD: number;
  /** Growth beyond the near plume and upstream of the inlet. */
  readonly farGrowth: number;
  /** Exponent of the growth of the radial spacing along both jet shear lines (lip -> outflow). */
  readonly shearExponent: number;
  /** Uniform radial spacing of the plume blocks at the outflow boundary. */
  readonly outflowRadialSpacing: number;
  readonly upstreamD: number;
  readonly radialD: number;
  readonly downstreamD: number;
  /** Smoothing passes (across rows) of the east-face copy that shapes the far-upstream columns. */
  readonly upstreamSmoothing: number;
  readonly sweeps: number;
}

/**
 * Production spec (~130k cells). Shared with the 80k fallback: the C-block, inlet, upstream and fan
 * (the topology's fixed counts: 16 core, 32 bypass, 48 fan, 16 C-block cells across), 8-10 mm radial
 * spacing at both nozzle lips, the domain. The extra ~50k cells go where the solver needs them:
 * 8 cells per blade chord in the core (2 mm axial cells in the HPC rear), 8 mm axial cells at the
 * nozzle lips growing at 0.5 % per cell, and a 25 mm axial plateau along the jets out to 11 D
 * after the core lip, so the shear layers stay resolved through the potential core.
 */
export const MESH_130K: MeshSpec = {
  name: '130k',
  targetCells: 130_000,
  nCore: 16,
  nBypass: 32,
  nLip: 16,
  nFar: 36,
  cellsPerChord: 8,
  lipRadialSpacing: 0.009,
  lipAxialSpacing: 0.008,
  fanFaceSpacing: 0.009,
  splitterSpacing: 0.005,
  fanSpacingMax: 0.009,
  coreSpacingMax: 0.01,
  bypassSpacingMax: 0.012,
  combustorSpacing: 0.008,
  highlightSpacing: 0.0035,
  lipWallNormalSpacing: 0.003,
  lipThickness: 0.12,
  lipOuterSpacingMax: 0.02,
  bypassLipGrowth: 1.08,
  lipNormalSmoothing: 0.5,
  gradation: 0.08,
  plumeGrowth: 0.005,
  plumeSpacingMax: 0.025,
  nearPlumeD: 11,
  farGrowth: 0.1,
  shearExponent: 2,
  outflowRadialSpacing: 0.045,
  upstreamD: 5,
  radialD: 5,
  downstreamD: 20,
  upstreamSmoothing: 100,
  sweeps: 0,
};

/**
 * The P1 fallback (~80k cells): the same engine resolution requirements (16/48/32 across, >= 4
 * cells per chord, 8-10 mm at the lips), with 6 cells per chord, 10 mm axial cells at the lips
 * growing at 0.8 % per cell, and a 50 mm plume plateau out to 7 D.
 */
export const MESH_80K: MeshSpec = {
  ...MESH_130K,
  name: '80k',
  targetCells: 80_000,
  cellsPerChord: 6,
  lipAxialSpacing: 0.01,
  bypassSpacingMax: 0.015,
  plumeGrowth: 0.008,
  plumeSpacingMax: 0.05,
  nearPlumeD: 7,
};

/** A station plane on the grid: the i-line (i-face index) of a duct block, across all its j. */
export interface StationGridLine {
  readonly id: string;
  readonly x: number;
  readonly block: Duct;
  readonly i: number;
}

/** A blade row's body-force zone: cells i0..i1-1 of a duct block, across all its j. */
export interface RowZone {
  readonly id: string;
  readonly block: Duct;
  readonly i0: number;
  readonly i1: number;
}

export interface EngineMesh extends MultiBlockMesh {
  readonly spec: MeshSpec;
  readonly geometry: FlowpathGeometry;
  readonly domain: {
    readonly xIn: number;
    readonly xOut: number;
    readonly rOut: number;
    readonly D: number;
  };
  readonly index: Readonly<Record<BlockName, number>>;
  readonly totalCells: number;
  readonly smoothing: SmoothReport;
  /** Station planes (geometry.stations) as grid lines. */
  readonly stations: readonly StationGridLine[];
  /** Blade rows (geometry.bladeRows) as whole-cell zones. */
  readonly rows: readonly RowZone[];
}

/** Axial target spacing in a duct: blade rows set chord / cellsPerChord, smoothly graded. */
function ductSpacing(
  rows: readonly BladeRow[],
  spec: MeshSpec,
  cap: number,
  ends: readonly { x: number; h: number }[],
  zones: readonly { x0: number; x1: number; h: number }[] = [],
): (x: number) => number {
  const g = spec.gradation;
  return (x) => {
    let h = cap;
    for (const e of ends) h = Math.min(h, e.h + g * Math.abs(x - e.x));
    for (const z of zones) {
      const d = x < z.x0 ? z.x0 - x : x > z.x1 ? x - z.x1 : 0;
      h = Math.min(h, z.h + g * d);
    }
    for (const row of rows) {
      const d = x < row.xLE ? row.xLE - x : x > row.xTE ? x - row.xTE : 0;
      h = Math.min(h, (row.xTE - row.xLE) / spec.cellsPerChord + g * d);
    }
    return h;
  };
}

// ---------------------------------------------------------------------------------------------

export function buildEngineMesh(geometry: FlowpathGeometry, spec: MeshSpec): EngineMesh {
  const problems = validateFlowpath(geometry);
  if (problems.length > 0) throw new Error(`invalid flowpath: ${problems.join('; ')}`);
  const nFan = spec.nCore + spec.nBypass;
  const nInl = nFan - spec.nLip;
  if (nInl < 4) throw new Error('nLip leaves too few inlet cells at the fan face');

  const D = geometry.fanTipDiameter;
  const hub = new Polyline(geometry.curves.hub);
  const coreOuter = new Polyline(geometry.curves.coreOuter);
  const cowl = new Polyline(geometry.curves.coreCowl);
  const nacIn = new Polyline(geometry.curves.nacelleInner);
  const nacOut = new Polyline(geometry.curves.nacelleOuter);
  const kp = keyPoints(geometry);
  const { spinnerNose: N, plugTip: P, splitter: S, coreLip: C, highlight: HL, bypassLip: B } = kp;
  const g = spec.gradation;
  const lipR = spec.lipRadialSpacing;

  const nacMaxR = Math.max(...geometry.curves.nacelleOuter.map((p) => p.r));
  // domain extents rounded outwards to whole centimetres, plus one so that the stated minimum
  // distances also hold after floating-point subtraction
  const xIn = Math.floor((HL.x - spec.upstreamD * D) * 100) / 100 - 0.01;
  const xOut = Math.ceil((C.x + spec.downstreamD * D) * 100) / 100 + 0.01;
  const rOut = Math.ceil((nacMaxR + spec.radialD * D) * 100) / 100 + 0.01;

  // -- fan face (x = 0) and the C-block's fan-face column ----------------------------------------
  const H0 = hub.atX(0);
  const Cas0 = nacIn.atX(0);
  const fanWest = radialLine(0, H0.r, Cas0.r, uniform(nFan));

  // -- fan -----------------------------------------------------------------------------------------
  const Hs = hub.atX(S.x);
  const Cs = nacIn.atX(S.x);
  const hSplitR = 0.8 * Math.min((S.r - Hs.r) / spec.nCore, (Cs.r - S.r) / spec.nBypass);
  const coreIn = radialLine(S.x, Hs.r, S.r, towardsEnd(spec.nCore, S.r - Hs.r, hSplitR));
  const bypIn = radialLine(
    S.x,
    S.r,
    Cs.r,
    twoSided(spec.nBypass, Cs.r - S.r, hSplitR, (Cs.r - S.r) / spec.nBypass),
  );
  const fanEast = [...coreIn, ...bypIn.slice(1)];

  // -- the three ducts: grid lines on every blade edge and station plane ---------------------------
  // Each duct block is built from straight cuts between its walls (ductWalls), with a node row
  // exactly on every blade row's leading and trailing edge (so body-force zones are whole cells)
  // and on every station plane the solver reduces at (exact radial lines). The cross-duct
  // fractions blend linearly from the west to the east column along the duct.
  const stationMap: StationGridLine[] = [];
  const rowMap: RowZone[] = [];
  const ductBlock = (
    duct: Duct,
    lower: Polyline,
    upper: Polyline,
    west: readonly Pt[],
    east: readonly Pt[],
    h: (x: number) => number,
  ): Block => {
    const w0 = west[0] as Pt;
    const e0 = east[0] as Pt;
    const rows = geometry.bladeRows.filter((r) => r.duct === duct);
    const stations = geometry.stations.filter((s) => s.duct === duct);
    // interior fixed lines, deduplicated (a station may sit on a blade edge), in axial order
    const cuts: DuctCut[] = [];
    const key = (c: DuctCut): number => {
      const k = cuts.findIndex(
        (d) => Math.abs(d.hub.x - c.hub.x) < 1e-12 && Math.abs(d.tip.x - c.tip.x) < 1e-12,
      );
      if (k >= 0) return k;
      cuts.push(c);
      return cuts.length - 1;
    };
    const rowCuts = rows.map((r) => [key(r.le), key(r.te)] as const);
    const stationCuts = stations.map((s) =>
      s.x === w0.x ? -1 : s.x === e0.x ? -2 : key({ hub: lower.atX(s.x), tip: upper.atX(s.x) }),
    );
    const order = cuts
      .map((_, k) => k)
      .sort((a, b) => {
        const ca = cuts[a] as DuctCut;
        const cb = cuts[b] as DuctCut;
        return ca.hub.x + ca.tip.x - (cb.hub.x + cb.tip.x);
      });
    const rank = new Map(order.map((k, m) => [k, m + 1]));
    // a blade chord keeps at least nChordMin cells (the requirement is >= 4 per chord)
    const nChordMin = Math.max(4, Math.ceil(0.75 * spec.cellsPerChord));
    const chordMin = new Map<number, number>();
    for (const [le, te] of rowCuts) {
      const a = rank.get(le) ?? 0;
      const b = rank.get(te) ?? 0;
      for (let k = a; k < b; k++) chordMin.set(k, Math.ceil(nChordMin / (b - a)));
    }
    const wTop = west[west.length - 1] as Pt;
    const eTop = east[east.length - 1] as Pt;
    const fixedCuts = order.map((k) => cuts[k] as DuctCut);
    const minCells = (k: number): number => chordMin.get(k) ?? 1;
    // the fan's swept edges lean far more than the duct is long: each wall gets its own spacing
    const walls =
      duct === 'fan' || duct === 'core' || duct === 'bypass'
        ? wallRows(
            lower,
            upper,
            h,
            [{ hub: w0, tip: wTop }, ...fixedCuts, { hub: e0, tip: eTop }],
            minCells,
            spec.gradation,
          )
        : ductWalls(
            lower,
            upper,
            w0.x,
            e0.x,
            h,
            { lower0: w0, upper0: wTop, lower1: e0, upper1: eTop },
            { fixed: fixedCuts, minCells, gradation: spec.gradation },
          );
    const n = walls.lo.length - 1;
    const index = (cut: number): number =>
      cut === -1 ? 0 : cut === -2 ? n : (walls.fixed[(rank.get(cut) ?? 0) - 1] ?? -1);
    const fractions = (col: readonly Pt[]): number[] => {
      const d = spacings(col);
      const total = d.reduce((a, b) => a + b, 0);
      let acc = 0;
      return [0, ...d.map((v, k) => (k === d.length - 1 ? 1 : (acc += v) / total))];
    };
    const fW = fractions(west);
    const fE = fractions(east);
    const mid = walls.lo.map((p, i) => ({
      x: 0.5 * (p.x + (walls.up[i] as Pt).x),
      r: 0.5 * (p.r + (walls.up[i] as Pt).r),
    }));
    const along = [0];
    for (let i = 1; i <= n; i++)
      along.push((along[i - 1] ?? 0) + dist(mid[i - 1] as Pt, mid[i] as Pt));
    const total = along[n] ?? 1;
    const block = columnBlock(
      duct,
      walls.lo.map((lo, i) => {
        if (i === 0) return west;
        if (i === n) return east;
        const u = (along[i] ?? 0) / total;
        const last = fW.length - 1;
        const f = fW.map((a, j) => (j === 0 ? 0 : j === last ? 1 : a + u * ((fE[j] ?? a) - a)));
        return segment(lo, walls.up[i] as Pt, f);
      }),
    );
    stations.forEach((s, k) => {
      stationMap.push({ id: s.id, x: s.x, block: duct, i: index(stationCuts[k] ?? 0) });
    });
    rows.forEach((r, k) => {
      const [le, te] = rowCuts[k] ?? [0, 0];
      rowMap.push({ id: r.name, block: duct, i0: index(le), i1: index(te) });
    });
    return block;
  };

  const fan = ductBlock(
    'fan',
    hub,
    nacIn,
    fanWest,
    fanEast,
    ductSpacing(
      geometry.bladeRows.filter((r) => r.duct === 'fan'),
      spec,
      spec.fanSpacingMax,
      [
        { x: 0, h: spec.fanFaceSpacing },
        { x: S.x, h: spec.splitterSpacing },
      ],
    ),
  );
  const nFanI = fan.ni;
  // The fan block's first cell (fan face to the swept leading edge) is ~4 times wider at the tip
  // than at the hub. The inlet and the C-block take these widths as their last axial spacing at
  // the fan face, so the cells match across it at every radius.
  const fanFirst = (j: number): number => dist(nodeAt(fan, 0, j), nodeAt(fan, 1, j));
  const hubFirst = fanFirst(0);
  const casFirst = fanFirst(nFan);
  const junctionFirst = fanFirst(nInl);

  // -- lip: C-block around the nacelle, by extrusion along smoothed wall normals ------------------
  const innerPart = nacIn.sub(0, nacIn.sAtX(0)).reversed();
  const wallCurve = joinCurves([innerPart, nacOut]);
  const sHL = innerPart.length;
  const Lw = wallCurve.length;
  const hWall = (s: number): number =>
    Math.min(
      s < sHL ? Math.max(spec.fanSpacingMax, casFirst - g * s) : spec.lipOuterSpacingMax,
      spec.highlightSpacing + g * Math.abs(s - sHL),
      casFirst + g * s,
      spec.lipAxialSpacing + g * (Lw - s),
    );
  const sIn = bySpacing(sHL, hWall);
  const sOut = bySpacing(Lw - sHL, (s) => hWall(sHL + s));
  const wallS = [
    ...Array.from(sIn),
    ...Array.from(sOut)
      .slice(1)
      .map((s) => sHL + s),
  ];
  const iHL = sIn.length - 1;
  const nW = wallS.length - 1;
  const wall: Pt[] = wallS.map((s, k) =>
    k === 0 ? Cas0 : k === iHL ? HL : k === nW ? B : wallCurve.at(s),
  );
  // raw normals point into the fluid (left of +i), then smoothed; the fan-face column is radial
  let normals = wall.map((_, k) => {
    const a = wall[Math.max(0, k - 1)] as Pt;
    const b = wall[Math.min(nW, k + 1)] as Pt;
    const L = dist(a, b);
    return { x: -(b.r - a.r) / L, r: (b.x - a.x) / L };
  });
  normals[0] = { x: 0, r: -1 };
  const deltaIn = Cas0.r - (fanWest[nInl] as Pt).r;
  const qB = spec.bypassLipGrowth;
  const deltaB = (lipR * (qB ** spec.nLip - 1)) / (qB - 1);
  const blend = (s: number, atStart: number, atHL: number, atEnd: number): number =>
    s <= sHL
      ? atStart + (atHL - atStart) * smoothstep(s / sHL)
      : atHL + (atEnd - atHL) * smoothstep((s - sHL) / (Lw - sHL));
  const delta = wallS.map((s) => blend(s, deltaIn, spec.lipThickness, deltaB));
  // The outer edge is an offset curve at distance delta: its spacing is the wall spacing times
  // (1 + delta * curvature of the normals), so the normals are smoothed over a length that
  // scales with delta (Gaussian in arc length, sigma = lipNormalSmoothing * delta). A fixed
  // number of index passes left the polyline wall's kinks, amplified 0.27 m out, in the edge.
  const raw = normals;
  normals = raw.map((n, k) => {
    if (k === 0) return n;
    const sk = wallS[k] ?? 0;
    const sig = spec.lipNormalSmoothing * (delta[k] ?? 0);
    let x = 0;
    let r = 0;
    raw.forEach((m, q) => {
      const u = ((wallS[q] ?? 0) - sk) / sig;
      if (Math.abs(u) > 3) return;
      const w = Math.exp(-0.5 * u * u);
      x += w * m.x;
      r += w * m.r;
    });
    const L = Math.hypot(x, r);
    return { x: x / L, r: r / L };
  });
  // the columns next to the fan face start radial (C1 blend), so the C-block's outer edge is not
  // compressed against the fan block's first cell there
  normals = normals.map((n, k) => {
    const w = smoothstep((wallS[k] ?? 0) / deltaIn);
    const x = w * n.x;
    const r = (1 - w) * -1 + w * n.r;
    const L = Math.hypot(x, r);
    return { x: x / L, r: r / L };
  });
  const firstH = wallS.map((s) => blend(s, deltaIn / spec.nLip, spec.lipWallNormalSpacing, lipR));
  // near the fan face the outer edge is drawn towards it so that its spacing there is the fan
  // block's first-cell width at the C-block/inlet junction (the fan-face column stays radial)
  const rho = junctionFirst / casFirst;
  const outer: Pt[] = wall.map((w, k) => {
    const n = normals[k] as Pt;
    const d = delta[k] ?? 0;
    const sigma = 1 + (rho - 1) * (1 - smoothstep((wallS[k] ?? 0) / deltaIn));
    return { x: (w.x + d * n.x) * sigma, r: w.r + d * n.r };
  });
  const lip = twoBoundary('lip', wall, outer, (k) =>
    k === 0 ? uniform(spec.nLip) : geometric(spec.nLip, (firstH[k] ?? 0) / (delta[k] ?? 1)),
  );
  for (let j = 0; j <= spec.nLip; j++) setNode(lip, 0, j, fanWest[nFan - j] as Pt);
  // the valence-5 points where the C-block meets the inlet / upstream / far-field blocks:
  // where the smoothed wall normal turns through 45 degrees on either side of the highlight
  let iP1 = -1;
  let iP2 = -1;
  normals.forEach((n, k) => {
    if (iP1 < 0 && k > 0 && n.x <= n.r) iP1 = k;
    if (iP2 < 0 && k > iHL && n.r >= -n.x) iP2 = k;
  });
  if (iP1 <= 0 || iP2 <= iHL || iP1 >= iHL)
    throw new Error('could not place the C-block corner points');
  const nArc = iP2 - iP1;
  /** Radial (wall-normal) size of the C-block's outermost cell layer at column i. */
  const lipCross = (i: number): number =>
    dist(nodeAt(lip, i, spec.nLip), nodeAt(lip, i, spec.nLip - 1));
  /** Length of the C-block's outer edge from column i to i + 1. */
  const lipEdge = (i: number): number =>
    dist(nodeAt(lip, i, spec.nLip), nodeAt(lip, i + 1, spec.nLip));
  const P1 = nodeAt(lip, iP1, spec.nLip);
  const P2 = nodeAt(lip, iP2, spec.nLip);
  const O = nodeAt(lip, nW, spec.nLip);

  // -- core ----------------------------------------------------------------------------------------
  const plugC = hub.atX(C.x);
  const coreExit = radialLine(C.x, plugC.r, C.r, towardsEnd(spec.nCore, C.r - plugC.r, lipR));
  const core = ductBlock(
    'core',
    hub,
    coreOuter,
    coreIn,
    coreExit,
    ductSpacing(
      geometry.bladeRows.filter((r) => r.duct === 'core'),
      spec,
      spec.coreSpacingMax,
      [
        { x: S.x, h: spec.splitterSpacing },
        { x: C.x, h: spec.lipAxialSpacing },
      ],
      [
        {
          x0: geometry.combustor.xStart,
          x1: geometry.combustor.xEnd,
          h: spec.combustorSpacing,
        },
      ],
    ),
  );

  // -- bypass --------------------------------------------------------------------------------------
  const cowlB = cowl.atX(B.x);
  const bypExit = radialLine(B.x, cowlB.r, B.r, towardsEnd(spec.nBypass, B.r - cowlB.r, lipR));
  const bypass = ductBlock(
    'bypass',
    cowl,
    nacIn,
    bypIn,
    bypExit,
    ductSpacing(
      geometry.bladeRows.filter((r) => r.duct === 'bypass'),
      spec,
      spec.bypassSpacingMax,
      [
        { x: S.x, h: spec.splitterSpacing },
        { x: B.x, h: spec.lipAxialSpacing },
      ],
    ),
  );

  // -- plume axial distribution (shared by every plume line) --------------------------------------
  const xNear = C.x + spec.nearPlumeD * D;
  const hPlume = (x: number): number =>
    Math.min(
      spec.lipAxialSpacing + spec.plumeGrowth * Math.abs(x - B.x),
      spec.lipAxialSpacing + spec.plumeGrowth * Math.abs(x - C.x),
      spec.plumeSpacingMax + spec.farGrowth * Math.max(0, x - xNear),
    );
  const piece = (a: number, b: number): number[] =>
    Array.from(
      bySpacing(b - a, (s) => hPlume(a + s)),
      (s) => a + s,
    );
  const xs1 = piece(B.x, C.x);
  const xs2 = piece(C.x, P.x);
  const xs3 = piece(P.x, xOut);
  xs1[xs1.length - 1] = C.x;
  xs2[0] = C.x;
  xs2[xs2.length - 1] = P.x;
  xs3[0] = P.x;
  xs3[xs3.length - 1] = xOut;
  const xs = [...xs1, ...xs2.slice(1), ...xs3.slice(1)];
  const kC = xs1.length - 1;
  const kP = kC + xs2.length - 1;
  const kOut = xs.length - 1;

  // outflow face: uniform spacing over the plume blocks, geometric growth over the far field
  const hOut = spec.outflowRadialSpacing;
  const rCsOut = spec.nCore * hOut;
  const rBsOut = nFan * hOut;
  const rPoOut = (nFan + spec.nLip) * hOut;

  // jet boundary lines (free internal lines, shaped to follow the jets) and their radial spacing
  const line = (knots: { x: number; r: number; s: number }[]): Polyline =>
    new Polyline(hermitePoints(knots, 400));
  const bsMid = B.r - 0.05;
  const bypassShear = line([
    { x: B.x, r: B.r, s: -0.15 },
    { x: C.x, r: bsMid, s: 0 },
    { x: xOut, r: rBsOut, s: (rBsOut - bsMid) / (xOut - C.x) },
  ]);
  const csMid = C.r - 0.04;
  const coreShear = line([
    { x: C.x, r: C.r, s: -0.25 },
    { x: P.x, r: csMid, s: 0 },
    { x: xOut, r: rCsOut, s: (rCsOut - csMid) / (xOut - P.x) },
  ]);
  // radial spacing along each shear line: the lip value, growing like (distance / length)^p to the
  // uniform outflow spacing, which tracks the jets' slow spreading (a linear growth outruns the
  // jets' own mean cell size a few diameters downstream and forces a tan-type profile across them)
  const shearSpacing = (x: number, x0: number): number =>
    lipR + (hOut - lipR) * clamp((x - x0) / (xOut - x0), 0, 1) ** spec.shearExponent;
  const hBs = (x: number): number => shearSpacing(x, B.x);
  const hCs = (x: number): number => shearSpacing(x, C.x);
  const onLine = (c: Polyline, x: number, first: Pt, last: Pt, k: number, n: number): Pt =>
    k === 0 ? first : k === n ? last : c.atX(x);
  const bsNodes = xs.map((x, k) => onLine(bypassShear, x, B, { x: xOut, r: rBsOut }, k, kOut));
  const csNodes = xs
    .slice(kC)
    .map((x, k) => onLine(coreShear, x, C, { x: xOut, r: rCsOut }, k, kOut - kC));

  // The outer shear-layer block (plume-outer) is designed by its columns: each one rises from the
  // bypass shear line with first cell hBs(x) and grows geometrically to a top cell fTop(x), which
  // runs smoothly from the C-block's outermost cell at the bypass lip to the uniform outflow
  // spacing. Its thickness follows from those two, so the far field above starts from a smooth,
  // monotone first-cell size (a thin spot would force a fast-growing far-field column there).
  // The columns lean like the C-block's last column at the lip and turn radial within 2 m.
  const fTop0 = lipCross(nW);
  const ratio0 = fTop0 / lipR;
  const lipDir = { x: (O.x - B.x) / dist(O, B), r: (O.r - B.r) / dist(O, B) };
  const poTop = (k: number): Pt => {
    const x = xs[k] ?? 0;
    const bot = bsNodes[k] as Pt;
    const h = hBs(x);
    const u = (x - B.x) / (xOut - B.x);
    const q = ratio0 ** ((1 - u) / (spec.nLip - 1));
    const t = Math.abs(q - 1) < 1e-12 ? spec.nLip * h : (h * (q ** spec.nLip - 1)) / (q - 1);
    const w = smoothstep((x - B.x) / 2);
    const dx = (1 - w) * lipDir.x;
    const dr = (1 - w) * lipDir.r + w;
    const L = Math.hypot(dx, dr);
    return { x: bot.x + (t * dx) / L, r: bot.r + (t * dr) / L };
  };
  const topNodes = xs.map((_, k) => (k === 0 ? O : k === kOut ? { x: xOut, r: rPoOut } : poTop(k)));

  // -- afterbody, plug and the three plume blocks, column by column -------------------------------
  const cowlNodes = xs
    .slice(0, kC + 1)
    .map((x, k) => (k === 0 ? cowlB : k === kC ? C : cowl.atX(x)));
  const bsC = bsNodes[kC] as Pt;
  const aftEast = radialLine(C.x, C.r, bsC.r, twoSided(spec.nBypass, bsC.r - C.r, lipR, hBs(C.x)));
  const hCowl0 = spacings(bypExit)[0] ?? lipR;
  const afterbody = columnBlock(
    'afterbody',
    cowlNodes.map((bot, k) => {
      if (k === 0) return bypExit;
      if (k === kC) return aftEast;
      const x = xs[k] ?? 0;
      const top = bsNodes[k] as Pt;
      const u = (x - B.x) / (C.x - B.x);
      const hb = hCowl0 + (lipR - hCowl0) * u;
      return segment(bot, top, twoSided(spec.nBypass, dist(bot, top), hb, hBs(x)));
    }),
  );

  // The plug wall nodes are spaced by arc length (at the fractions of the shared plume x
  // stations), not by x: the plug steepens to a 45 degree cone at its tip, and x-spaced wall
  // nodes would make the wall cells 1/cos(45 deg) longer there than the axis cells behind the
  // tip. The plug columns therefore lean a little; their tops stay on the plume x stations.
  const sPlugC = hub.sAtX(C.x);
  const plugNodes = xs.slice(kC, kP + 1).map((x, k, a) => {
    if (k === 0) return plugC;
    if (k === a.length - 1) return P;
    return hub.at(sPlugC + ((hub.length - sPlugC) * (x - C.x)) / (P.x - C.x));
  });
  const csP = csNodes[kP - kC] as Pt;
  const hAxis = (x: number, height: number): number =>
    clamp(
      (2 * height) / spec.nCore - hCs(x),
      (0.5 * height) / spec.nCore,
      (2 * height) / spec.nCore,
    );
  const plugEast = radialLine(
    P.x,
    0,
    csP.r,
    twoSided(spec.nCore, csP.r, hAxis(P.x, csP.r), hCs(P.x)),
  );
  plugEast[0] = P;
  const phiPlug0 = (spacings(coreExit)[0] ?? lipR) / dist(plugC, C);
  const phiPlug1 = (spacings(plugEast)[0] ?? lipR) / csP.r;
  const plug = columnBlock(
    'plug',
    plugNodes.map((bot, k) => {
      if (k === 0) return coreExit;
      if (k === plugNodes.length - 1) return plugEast;
      const x = xs[kC + k] ?? 0;
      const top = csNodes[k] as Pt;
      const u = (x - C.x) / (P.x - C.x);
      const len = dist(bot, top);
      return segment(
        bot,
        top,
        twoSided(spec.nCore, len, len * (phiPlug0 + (phiPlug1 - phiPlug0) * u), hCs(x)),
      );
    }),
  );

  const plumeCore = columnBlock(
    'plume-core',
    xs.slice(kP).map((x, k, a) => {
      if (k === 0) return plugEast;
      const top = csNodes[kP - kC + k] as Pt;
      if (k === a.length - 1) return radialLine(xOut, 0, rCsOut, uniform(spec.nCore));
      return segment({ x, r: 0 }, top, twoSided(spec.nCore, top.r, hAxis(x, top.r), hCs(x)));
    }),
  );
  const plumeBypass = columnBlock(
    'plume-bypass',
    xs.slice(kC).map((x, k, a) => {
      if (k === 0) return aftEast;
      if (k === a.length - 1) return radialLine(xOut, rCsOut, rBsOut, uniform(spec.nBypass));
      const bot = csNodes[k] as Pt;
      const top = bsNodes[kC + k] as Pt;
      return segment(bot, top, twoSided(spec.nBypass, dist(bot, top), hCs(x), hBs(x)));
    }),
  );
  const plumeOuter = columnBlock(
    'plume-outer',
    xs.map((x, k) => {
      if (k === 0) return colNodes(lip, nW);
      if (k === kOut) return radialLine(xOut, rBsOut, rPoOut, uniform(spec.nLip));
      const bot = bsNodes[k] as Pt;
      const top = topNodes[k] as Pt;
      return segment(bot, top, geometric(spec.nLip, hBs(x) / dist(bot, top)));
    }),
  );

  // -- far field: TFI, then each column re-spaced so its first cell matches the block below -----
  // The north nodes take the south boundary's arc-length fractions, so the far field's columns
  // inherit a smooth version of the spacing along the C-block and the plume.
  const T = { x: P2.x - 0.6, r: rOut };
  const ffWestCurve = bezier(P2, { x: P2.x - 0.4, r: P2.r + 0.69 }, { x: T.x, r: P2.r + 2.5 }, T);
  const ffFirst = Math.sqrt(lipCross(iP2) * lipEdge(iP2 - 1));
  const ffWest = alongCurve(ffWestCurve, geometric(spec.nFar, ffFirst / ffWestCurve.length));
  const ffSouth = [...rowNodes(lip, spec.nLip).slice(iP2), ...topNodes.slice(1)];
  const nFF = ffSouth.length - 1;
  const southArc = [0];
  for (let k = 1; k <= nFF; k++)
    southArc.push((southArc[k - 1] ?? 0) + dist(ffSouth[k - 1] as Pt, ffSouth[k] as Pt));
  const southLen = southArc[nFF] ?? 1;
  const ffNorth = ffSouth.map((_, k) =>
    k === 0
      ? T
      : k === nFF
        ? { x: xOut, r: rOut }
        : { x: T.x + ((southArc[k] ?? 0) / southLen) * (xOut - T.x), r: rOut },
  );
  const ffEast = radialLine(xOut, rPoOut, rOut, geometric(spec.nFar, hOut / (rOut - rPoOut)));
  const farfield = tfi('farfield', ffSouth, ffNorth, ffWest, ffEast);
  const nLipOuter = nW - iP2;
  // first-cell targets: the cell below, smoothed along the far field so that neighbouring columns
  // get near-identical geometric ratios (a column-to-column ratio jump puts the nodes of one row at
  // different heights in neighbouring columns, i.e. skews the far-field cells)
  const ffBelow = smoothLog(
    Array.from({ length: nFF + 1 }, (_, k) =>
      k === 0
        ? ffFirst
        : k === nFF
          ? hOut
          : k <= nLipOuter
            ? lipCross(iP2 + k)
            : dist(
                nodeAt(plumeOuter, k - nLipOuter, spec.nLip),
                nodeAt(plumeOuter, k - nLipOuter, spec.nLip - 1),
              ),
    ),
    10,
  );
  for (let k = 1; k < nFF; k++) {
    const L = new Polyline(colNodes(farfield, k)).length;
    respaceColumn(farfield, k, geometric(spec.nFar, (ffBelow[k] ?? 0) / L));
  }

  // -- inlet: from in front of the lip to the fan face, axis/spinner up to the C-block ----------
  const F = { x: P1.x - 0.2, r: 0 };
  const inlWestCurve = bezier(
    F,
    { x: F.x, r: 0.35 * P1.r },
    { x: P1.x - 0.35 * P1.r * 0.5, r: P1.r - 0.35 * P1.r * 0.866 },
    P1,
  );
  // at P1 the inlet's corner cell sits between the C-block's outer layer (across) and the
  // C-block's outer edge (along the upstream block's east face): split the difference
  const inlLast = Math.sqrt(lipCross(iP1) * lipEdge(iP1));
  const inlWest = alongCurve(inlWestCurve, towardsEnd(nInl, inlWestCurve.length, inlLast));
  const spinner = hub.sub(0, hub.sAtX(0));
  const sN = N.x - F.x;
  const Ls = sN + spinner.length;
  const hAxisF = spacings(inlWest)[0] ?? lipCross(iP1);
  const hSouth =
    (cap: number) =>
    (s: number): number =>
      Math.min(
        cap,
        Math.max(hAxisF, lipEdge(iP1 - 1)) + g * s,
        spec.fanFaceSpacing + g * Math.abs(s - sN),
        hubFirst + g * (Ls - s),
      );
  // pick the cap so that the natural cell count equals the C-block's inner-leg count
  let lo = 1e-3;
  let hi = 1;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    if (cellCount(Ls, hSouth(mid)) > iP1) lo = mid;
    else hi = mid;
  }
  const hS = hSouth(0.5 * (lo + hi));
  const nAx = Math.max(2, Math.round((iP1 * cellCount(sN, hS)) / cellCount(Ls, hS)));
  const axisPart = bySpacing(sN, hS, nAx);
  const spinPart = bySpacing(spinner.length, (s) => hS(sN + s), iP1 - nAx);
  const inlSouth: Pt[] = [
    ...Array.from(axisPart, (s, k) => (k === nAx ? N : { x: F.x + s, r: 0 })),
    ...Array.from(spinPart)
      .slice(1)
      .map((s, k, a) => (k === a.length - 1 ? H0 : spinner.at(s))),
  ];
  inlSouth[0] = F;
  const inlNorth = rowNodes(lip, spec.nLip)
    .slice(0, iP1 + 1)
    .reverse();
  const inlet = tfi('inlet', inlSouth, inlNorth, inlWest, fanWest.slice(0, nInl + 1));
  for (let k = 1; k < iP1; k++) {
    const L = new Polyline(colNodes(inlet, k)).length;
    const first = dist(nodeAt(inlet, k, 0), nodeAt(inlet, k, 1));
    respaceColumn(inlet, k, twoSided(nInl, L, first, lipCross(iP1 - k)));
  }

  // -- upstream: inflow face to the composite east face (inlet west, C-block arc, far-field west) ---
  // Each row's last cell matches the block across the east face (smoothed targets).
  const upEast = [
    ...colNodes(inlet, 0),
    ...rowNodes(lip, spec.nLip).slice(iP1 + 1, iP2 + 1),
    ...ffWest.slice(1),
  ];
  const nUpJ = upEast.length - 1;
  const eastCross = (j: number): number =>
    j <= nInl
      ? dist(nodeAt(inlet, 0, j), nodeAt(inlet, 1, j))
      : j <= nInl + nArc
        ? lipCross(iP1 + (j - nInl))
        : dist(nodeAt(farfield, 0, j - nInl - nArc), nodeAt(farfield, 1, j - nInl - nArc));
  // the per-row targets are smoothed so that neighbouring rows get near-identical distributions
  // (rows with different geometric ratios would make the columns step between them)
  const hEast = smoothLog(
    Array.from({ length: nUpJ + 1 }, (_, j) => eastCross(j)),
    40,
  );
  const hMinUp = Math.min(...hEast);
  const qUp = 1 + spec.farGrowth;
  const nUpI = Math.ceil(Math.log(1 + ((F.x - xIn) * (qUp - 1)) / hMinUp) / Math.log(qUp));
  const eastArc = [0];
  for (let j = 1; j <= nUpJ; j++)
    eastArc.push((eastArc[j - 1] ?? 0) + dist(upEast[j - 1] as Pt, upEast[j] as Pt));
  const eastLen = eastArc[nUpJ] ?? 1;
  const upWest = upEast.map((_, j) => ({
    x: xIn,
    r: j === 0 ? 0 : j === nUpJ ? rOut : ((eastArc[j] ?? 0) / eastLen) * rOut,
  }));
  // The east face turns sharply at the valence-5 points P1 and P2. Node (k, j) is the linear blend
  // W_j + u (E_j - W_j) of the west and east nodes of row j. The west face takes the east face's
  // arc-length fractions, so west and east are two curves with the same parameterisation, and a
  // blend of them keeps the cell lengths along each column smooth through the turns (both legs of
  // each turn lean about equally from the vertical west face). The fraction u comes from the row's
  // geometric distribution, computed from the smoothed east target and a smoothed row length so
  // that u varies smoothly across the rows (a jump in u would shift whole rows axially).
  const rowLen = smoothLog(
    upEast.map((e, j) => dist(e, upWest[j] as Pt)),
    40,
  );
  const rowT = upEast.map((_, j) => geometricToEnd(nUpI, (hEast[j] ?? 0) / (rowLen[j] ?? 1)));
  // Further upstream, the east face is replaced by a progressively smoothed copy of itself,
  // resampled at the east face's own arc-length fractions, so the turns fade out of the columns
  // without changing the spacing along them.
  const sigma = eastArc.map((a) => a / eastLen);
  const smoothPass = (prev: readonly Pt[]): Pt[] =>
    prev.map((q, j) =>
      j === 0 || j === nUpJ
        ? q
        : {
            x: 0.25 * ((prev[j - 1] as Pt).x + 2 * q.x + (prev[j + 1] as Pt).x),
            r: 0.25 * ((prev[j - 1] as Pt).r + 2 * q.r + (prev[j + 1] as Pt).r),
          },
    );
  let smoothed = upEast.slice();
  let next = smoothPass(smoothed);
  let passesDone = 0;
  const upColumns: Pt[][] = [];
  for (let k = nUpI; k >= 0; k--) {
    const uMid = rowT[Math.round(nUpJ / 2)]?.[k] ?? 0;
    // the added displacement per column must stay small against the local column spacing, which
    // grows geometrically away from the east face: a continuous amount of smoothing ~ (1 - u)^2,
    // capped (fractional amounts blend two consecutive passes)
    const passes = Math.min(spec.upstreamSmoothing, 1000 * (1 - uMid) ** 2);
    for (; passesDone + 1 <= passes; passesDone++) {
      smoothed = next;
      next = smoothPass(smoothed);
    }
    const f = passes - passesDone;
    const shape = smoothed.map((p, j) => ({
      x: p.x + f * ((next[j] as Pt).x - p.x),
      r: p.r + f * ((next[j] as Pt).r - p.r),
    }));
    const guideLine = new Polyline(shape);
    const guide = sigma.map((sg, j) =>
      j === 0 || j === nUpJ ? (shape[j] as Pt) : guideLine.at(sg * guideLine.length),
    );
    upColumns[k] = upWest.map((w, j) => {
      if (k === 0) return w;
      if (k === nUpI) return upEast[j] as Pt;
      const e = guide[j] as Pt;
      const u = rowT[j]?.[k] ?? 0;
      return {
        x: w.x + u * (e.x - w.x),
        r: j === 0 ? 0 : j === nUpJ ? rOut : w.r + u * (e.r - w.r),
      };
    });
  }
  const upstream = columnBlock('upstream', upColumns);

  // -- assemble ------------------------------------------------------------------------------------
  const blocks = [
    upstream,
    inlet,
    lip,
    fan,
    bypass,
    core,
    afterbody,
    plug,
    plumeCore,
    plumeBypass,
    plumeOuter,
    farfield,
  ];
  const index = Object.fromEntries(BLOCK_NAMES.map((n, k) => [n, k])) as Record<BlockName, number>;
  const I = index;
  const patches: Patch[] = [];
  const wallP = (
    block: number,
    face: Patch['face'],
    start: number,
    end: number,
    label: string,
    bc: Patch['bc'] = BC.SLIP_WALL,
  ): void => {
    patches.push({ block, face, start, end, bc, label });
  };
  const nA = kC;
  const nPl = kP - kC;
  const n3 = kOut - kP;
  // physical boundaries
  wallP(I.upstream, 'imin', 0, nUpJ, 'inflow', BC.INFLOW);
  wallP(I.upstream, 'jmin', 0, nUpI, 'axis', BC.AXIS);
  wallP(I.upstream, 'jmax', 0, nUpI, 'farfield', BC.FARFIELD);
  wallP(I.inlet, 'jmin', 0, nAx, 'axis', BC.AXIS);
  wallP(I.inlet, 'jmin', nAx, iP1, 'hub');
  wallP(I.lip, 'jmin', 0, iHL, 'nacelle-inner');
  wallP(I.lip, 'jmin', iHL, nW, 'nacelle-outer');
  wallP(I.fan, 'jmin', 0, nFanI, 'hub');
  wallP(I.fan, 'jmax', 0, nFanI, 'nacelle-inner');
  wallP(I.core, 'jmin', 0, core.ni, 'hub');
  wallP(I.core, 'jmax', 0, core.ni, 'core-outer');
  wallP(I.bypass, 'jmin', 0, bypass.ni, 'core-cowl');
  wallP(I.bypass, 'jmax', 0, bypass.ni, 'nacelle-inner');
  wallP(I.afterbody, 'jmin', 0, nA, 'core-cowl');
  wallP(I.plug, 'jmin', 0, nPl, 'hub');
  wallP(I['plume-core'], 'jmin', 0, n3, 'axis', BC.AXIS);
  wallP(I['plume-core'], 'imax', 0, spec.nCore, 'outflow', BC.OUTFLOW);
  wallP(I['plume-bypass'], 'imax', 0, spec.nBypass, 'outflow', BC.OUTFLOW);
  wallP(I['plume-outer'], 'imax', 0, spec.nLip, 'outflow', BC.OUTFLOW);
  wallP(I.farfield, 'jmax', 0, nFF, 'farfield', BC.FARFIELD);
  wallP(I.farfield, 'imax', 0, spec.nFar, 'outflow', BC.OUTFLOW);
  // interfaces: station planes fixed, the rest floating
  const link = (
    a: [number, Patch['face'], number, number],
    b: [number, Patch['face'], number, number],
    floating: boolean,
  ): void => {
    const label = `${BLOCK_NAMES[a[0]] ?? '?'}|${BLOCK_NAMES[b[0]] ?? '?'}`;
    connect(
      patches,
      { block: a[0], face: a[1], start: a[2], end: a[3] },
      { block: b[0], face: b[1], start: b[2], end: b[3] },
      label,
      floating,
    );
  };
  link([I.upstream, 'imax', 0, nInl], [I.inlet, 'imin', 0, nInl], true);
  link([I.upstream, 'imax', nInl, nInl + nArc], [I.lip, 'jmax', iP1, iP2], true);
  link([I.upstream, 'imax', nInl + nArc, nUpJ], [I.farfield, 'imin', 0, spec.nFar], true);
  link([I.inlet, 'jmax', 0, iP1], [I.lip, 'jmax', iP1, 0], true);
  link([I.inlet, 'imax', 0, nInl], [I.fan, 'imin', 0, nInl], false);
  link([I.lip, 'imin', 0, spec.nLip], [I.fan, 'imin', nFan, nInl], false);
  link([I.lip, 'imax', 0, spec.nLip], [I['plume-outer'], 'imin', 0, spec.nLip], true);
  link([I.lip, 'jmax', iP2, nW], [I.farfield, 'jmin', 0, nLipOuter], true);
  link([I.fan, 'imax', 0, spec.nCore], [I.core, 'imin', 0, spec.nCore], false);
  link([I.fan, 'imax', spec.nCore, nFan], [I.bypass, 'imin', 0, spec.nBypass], false);
  link([I.core, 'imax', 0, spec.nCore], [I.plug, 'imin', 0, spec.nCore], false);
  link([I.bypass, 'imax', 0, spec.nBypass], [I.afterbody, 'imin', 0, spec.nBypass], false);
  link([I.afterbody, 'jmax', 0, nA], [I['plume-outer'], 'jmin', 0, nA], true);
  link([I.afterbody, 'imax', 0, spec.nBypass], [I['plume-bypass'], 'imin', 0, spec.nBypass], true);
  link([I.plug, 'jmax', 0, nPl], [I['plume-bypass'], 'jmin', 0, nPl], true);
  link([I.plug, 'imax', 0, spec.nCore], [I['plume-core'], 'imin', 0, spec.nCore], true);
  link([I['plume-core'], 'jmax', 0, n3], [I['plume-bypass'], 'jmin', nPl, nPl + n3], true);
  link([I['plume-bypass'], 'jmax', 0, nPl + n3], [I['plume-outer'], 'jmin', nA, kOut], true);
  link([I['plume-outer'], 'jmax', 0, kOut], [I.farfield, 'jmin', nLipOuter, nFF], true);

  const mesh: MultiBlockMesh = { blocks, patches };
  const before = validateMesh(mesh);
  if (before.length > 0)
    throw new Error(`engine mesh topology is inconsistent: ${before.slice(0, 5).join('; ')}`);
  const smoothing = smoothMesh(mesh, smoothingOptions(spec));
  const after = validateMesh(mesh);
  if (after.length > 0)
    throw new Error(`smoothing broke the topology: ${after.slice(0, 5).join('; ')}`);

  return {
    blocks,
    patches,
    spec,
    geometry,
    domain: { xIn, xOut, rOut, D },
    index,
    totalCells: blocks.reduce((s, b) => s + b.ni * b.nj, 0),
    smoothing,
    stations: stationMap,
    rows: rowMap,
  };
}

/**
 * Elliptic smoothing set-up (docs/MESH.md, decision on smoothing). The algebraic grid already
 * meets every requirement and the production specs run 0 sweeps. Measured with 300 sweeps and the
 * interfaces held: the TFI duct blocks (fan, core, bypass) are left essentially unchanged, while
 * smoothing the far field, upstream, inlet or C-block disturbs the cells next to the fixed
 * valence-5 points P1/P2 and the corner O (stretching up to 1.3-3 across interfaces), and floating
 * interfaces with pinned junction points spike there. So only the duct blocks are smoothed when
 * sweeps > 0, with Thomas-Middlecoff control from their boundaries.
 */
export function smoothingOptions(spec: MeshSpec): SmoothOptions {
  return {
    sweeps: spec.sweeps,
    omega: 0.8,
    floatInterfaces: false,
    blocks: ['fan', 'core', 'bypass'],
  };
}
