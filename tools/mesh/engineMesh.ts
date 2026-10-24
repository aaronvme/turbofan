// The 12-block, point-matched engine mesh (docs/MESH.md has the diagram and the reasoning).
//
//   upstream  - inflow x = x_in to the face in front of the inlet lip, axis to far field
//   inlet     - inside the inlet: axis/spinner up to the C-block, from in front of the lip to the fan face
//   lip       - C-block wrapping the nacelle: fan face -> inner wall -> highlight -> outer wall -> bypass lip
//   fan       - fan face (x = 0) to the splitter plane, 48 cells hub to casing
//   bypass    - splitter plane to the bypass-nozzle exit plane, 32 cells
//   core      - one H-block from the splitter plane to the core-nozzle exit plane, 16 cells
//   afterbody - over the core cowl, bypass-nozzle exit to the core-nozzle exit plane
//   plug      - over the plug, core-nozzle exit to the plug tip
//   plume-core, plume-bypass, plume-outer - the three plume blocks, to x_out
//   farfield  - above the C-block and the plume, to r_out and x_out
//
// Construction: algebraic (TFI; normal extrusion for the C-block), with node distributions chosen
// so that cell sizes match across every interface, then multi-block elliptic smoothing. Station
// planes (fan face, splitter, both nozzle exits) are fixed straight lines; other interfaces float.
import { Polyline, bezier, hermitePoints, joinCurves } from './curve';
import { bySpacing, geometric, vinokur } from './distribution';
import {
  keyPoints,
  validateFlowpath,
  type BladeRow,
  type FlowpathGeometry,
} from './geometry/flowpath';
import { smoothMesh, type SmoothOptions, type SmoothReport } from './smooth';
import { tfi, twoBoundary } from './tfi';
import { connect, validateMesh } from './topology';
import { BC, nodeIndex, type Block, type Patch, type Pt } from './types';
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
  /** C-block: wall spacing at the highlight, first wall-normal spacing there, thickness there. */
  readonly highlightSpacing: number;
  readonly lipWallNormalSpacing: number;
  readonly lipThickness: number;
  readonly lipOuterSpacingMax: number;
  /** Radial growth ratio of the C-block column above the bypass lip. */
  readonly bypassLipGrowth: number;
  /** Growth allowed by the duct and nacelle spacing functions. */
  readonly gradation: number;
  /** Near plume: axial growth after the lips, plateau spacing, plateau end (D after the core lip). */
  readonly plumeGrowth: number;
  readonly plumeSpacingMax: number;
  readonly nearPlumeD: number;
  /** Growth beyond the near plume and upstream of the inlet. */
  readonly farGrowth: number;
  /** Uniform radial spacing of the plume blocks at the outflow boundary. */
  readonly outflowRadialSpacing: number;
  readonly upstreamD: number;
  readonly radialD: number;
  readonly downstreamD: number;
  readonly sweeps: number;
}

export const MESH_130K: MeshSpec = {
  name: '130k',
  targetCells: 130_000,
  nCore: 16,
  nBypass: 32,
  nLip: 16,
  nFar: 40,
  cellsPerChord: 6,
  lipRadialSpacing: 0.009,
  lipAxialSpacing: 0.01,
  fanFaceSpacing: 0.008,
  splitterSpacing: 0.005,
  fanSpacingMax: 0.009,
  coreSpacingMax: 0.008,
  bypassSpacingMax: 0.015,
  highlightSpacing: 0.0035,
  lipWallNormalSpacing: 0.003,
  lipThickness: 0.12,
  lipOuterSpacingMax: 0.02,
  bypassLipGrowth: 1.08,
  gradation: 0.08,
  plumeGrowth: 0.01,
  plumeSpacingMax: 0.03,
  nearPlumeD: 10,
  farGrowth: 0.1,
  outflowRadialSpacing: 0.045,
  upstreamD: 5,
  radialD: 5,
  downstreamD: 20,
  sweeps: 300,
};

export const MESH_80K: MeshSpec = {
  ...MESH_130K,
  name: '80k',
  targetCells: 80_000,
  cellsPerChord: 5,
  lipAxialSpacing: 0.012,
  plumeSpacingMax: 0.05,
  nearPlumeD: 8,
  nFar: 32,
};

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
}

// ---------------------------------------------------------------------------------------------
// small helpers

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.r - b.r);
const smoothstep = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

function nodeAt(b: Block, i: number, j: number): Pt {
  const k = nodeIndex(b, i, j);
  return { x: b.x[k] ?? NaN, r: b.r[k] ?? NaN };
}

function setNode(b: Block, i: number, j: number, p: Pt): void {
  const k = nodeIndex(b, i, j);
  b.x[k] = p.x;
  b.r[k] = p.r;
}

function rowNodes(b: Block, j: number): Pt[] {
  return Array.from({ length: b.ni + 1 }, (_, i) => nodeAt(b, i, j));
}

function colNodes(b: Block, i: number): Pt[] {
  return Array.from({ length: b.nj + 1 }, (_, j) => nodeAt(b, i, j));
}

/** Straight radial line at x from r0 to r1 at fractions t (end points exact). */
function radialLine(x: number, r0: number, r1: number, t: ArrayLike<number>): Pt[] {
  const n = t.length - 1;
  return Array.from(t, (u, k) => ({ x, r: k === 0 ? r0 : k === n ? r1 : r0 * (1 - u) + r1 * u }));
}

/** Nodes along a polyline at fractions of its arc length (end points exact). */
function alongCurve(c: Polyline, t: ArrayLike<number>): Pt[] {
  const n = t.length - 1;
  const first = c.points[0] as Pt;
  const last = c.points[c.points.length - 1] as Pt;
  return Array.from(t, (u, k) => (k === 0 ? first : k === n ? last : c.at(u * c.length)));
}

/** Fractions with a geometric progression whose LAST spacing is dsLast. */
function geometricToEnd(n: number, dsLast: number): Float64Array {
  const g = geometric(n, dsLast);
  const t = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) t[k] = 1 - (g[n - k] ?? 0);
  t[0] = 0;
  t[n] = 1;
  return t;
}

/** Two-sided distribution over length L with last spacing h1 and a first spacing balancing the mean. */
function towardsEnd(n: number, L: number, h1: number): Float64Array {
  const h0 = Math.max(0.5 * (L / n), Math.min(2 * (L / n) - h1, 2 * (L / n)));
  return vinokur(n, h0 / L, h1 / L);
}

/** Cell count of a spacing function over [0, L] (continuous, for budgeting). */
function cellCount(L: number, h: (s: number) => number): number {
  const M = 2000;
  let sum = 0;
  for (let m = 0; m < M; m++) sum += L / M / h(((m + 0.5) * L) / M);
  return sum;
}

/** Re-sample the interior nodes of column i (j = 1..nj-1) along the column at fractions t. */
function respaceColumn(b: Block, i: number, t: ArrayLike<number>): void {
  const line = new Polyline(colNodes(b, i));
  for (let j = 1; j < b.nj; j++) setNode(b, i, j, line.at((t[j] ?? 0) * line.length));
}

/** Re-sample the interior nodes of row j (i = 1..ni-1) along the row at fractions t. */
function respaceRow(b: Block, j: number, t: ArrayLike<number>): void {
  const line = new Polyline(rowNodes(b, j));
  for (let i = 1; i < b.ni; i++) setNode(b, i, j, line.at((t[i] ?? 0) * line.length));
}

/** Axial target spacing in a duct: blade rows set chord / cellsPerChord, smoothly graded. */
function ductSpacing(
  rows: readonly BladeRow[],
  spec: MeshSpec,
  cap: number,
  ends: readonly { x: number; h: number }[],
): (x: number) => number {
  const g = spec.gradation;
  return (x) => {
    let h = cap;
    for (const e of ends) h = Math.min(h, e.h + g * Math.abs(x - e.x));
    for (const row of rows) {
      const d = x < row.xLE ? row.xLE - x : x > row.xTE ? x - row.xTE : 0;
      h = Math.min(h, (row.xTE - row.xLE) / spec.cellsPerChord + g * d);
    }
    return h;
  };
}

/**
 * Wall node rows of a duct between `lower` and `upper` from x0 to x1: nodes are placed on the
 * duct's mean line by the spacing function, and each cut is the mean-line normal (blended to
 * radial over the last few cuts so the station planes at both ends stay radial). This keeps the
 * cross-duct grid lines near-orthogonal through bends such as the booster-HPC gooseneck.
 */
function ductWalls(
  lower: Polyline,
  upper: Polyline,
  x0: number,
  x1: number,
  h: (x: number) => number,
  ends: { lower0: Pt; upper0: Pt; lower1: Pt; upper1: Pt },
): { lo: Pt[]; up: Pt[] } {
  const mean = new Polyline(
    Array.from({ length: 1501 }, (_, m) => {
      const x = m === 1500 ? x1 : x0 + ((x1 - x0) * m) / 1500;
      return { x, r: 0.5 * (lower.atX(x).r + upper.atX(x).r) };
    }),
  );
  const s = bySpacing(mean.length, (sv) => h(mean.at(sv).x));
  const n = s.length - 1;
  const lo: Pt[] = [];
  const up: Pt[] = [];
  let lastLo = -Infinity;
  let lastUp = -Infinity;
  for (let k = 0; k <= n; k++) {
    if (k === 0 || k === n) {
      lo.push(k === 0 ? ends.lower0 : ends.lower1);
      up.push(k === 0 ? ends.upper0 : ends.upper1);
      continue;
    }
    const m = mean.at(s[k] ?? 0);
    const t = mean.tangent(s[k] ?? 0);
    const w = Math.min(1, k / 8, (n - k) / 8);
    const dx = w * -t.r;
    const dr = 1 - w + w * t.x;
    const len = Math.hypot(dx, dr);
    const dir = { x: dx / len, r: dr / len };
    const sl = lower.rayHit(m, dir);
    const su = upper.rayHit(m, dir);
    if (sl === null || su === null || !(sl > lastLo) || !(su > lastUp)) {
      throw new Error(`duct cut ${k} at x = ${m.x.toFixed(3)} does not cross both walls in order`);
    }
    lastLo = sl;
    lastUp = su;
    lo.push(lower.at(sl));
    up.push(upper.at(su));
  }
  return { lo, up };
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

  const nacMaxR = Math.max(...geometry.curves.nacelleOuter.map((p) => p.r));
  const xIn = Math.floor((HL.x - spec.upstreamD * D) * 100) / 100;
  const xOut = Math.ceil((C.x + spec.downstreamD * D) * 100) / 100;
  const rOut = Math.ceil((nacMaxR + spec.radialD * D) * 100) / 100;

  // -- fan face (x = 0) and the C-block's fan-face column ----------------------------------------
  const H0 = hub.atX(0);
  const Cas0 = nacIn.atX(0);
  const fanWest = radialLine(
    0,
    H0.r,
    Cas0.r,
    Array.from({ length: nFan + 1 }, (_, k) => k / nFan),
  );

  // -- lip: C-block around the nacelle, by extrusion along smoothed wall normals ------------------
  const innerPart = nacIn.sub(0, nacIn.sAtX(0)).reversed();
  const wallCurve = joinCurves([innerPart, nacOut]);
  const sHL = innerPart.length;
  const Lw = wallCurve.length;
  const hWall = (s: number): number =>
    Math.min(
      s < sHL ? spec.fanSpacingMax : spec.lipOuterSpacingMax,
      spec.highlightSpacing + g * Math.abs(s - sHL),
      spec.fanFaceSpacing + g * s,
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
  for (let pass = 0; pass < 30; pass++) {
    normals = normals.map((n, k) => {
      if (k === 0 || k === nW) return n;
      const a = normals[k - 1] as Pt;
      const b = normals[k + 1] as Pt;
      const x = a.x + 2 * n.x + b.x;
      const r = a.r + 2 * n.r + b.r;
      const L = Math.hypot(x, r);
      return { x: x / L, r: r / L };
    });
  }
  const deltaIn = Cas0.r - (fanWest[nInl] as Pt).r;
  const qB = spec.bypassLipGrowth;
  const deltaB = (spec.lipRadialSpacing * (qB ** spec.nLip - 1)) / (qB - 1);
  const blend = (s: number, atStart: number, atHL: number, atEnd: number): number =>
    s <= sHL
      ? atStart + (atHL - atStart) * smoothstep(s / sHL)
      : atHL + (atEnd - atHL) * smoothstep((s - sHL) / (Lw - sHL));
  const delta = wallS.map((s) => blend(s, deltaIn, spec.lipThickness, deltaB));
  const firstH = wallS.map((s) =>
    blend(s, deltaIn / spec.nLip, spec.lipWallNormalSpacing, spec.lipRadialSpacing),
  );
  const outer: Pt[] = wall.map((w, k) => {
    const n = normals[k] as Pt;
    const d = delta[k] ?? 0;
    return { x: w.x + d * n.x, r: w.r + d * n.r };
  });
  const lip = twoBoundary('lip', wall, outer, (k) =>
    geometric(spec.nLip, (firstH[k] ?? 0) / (delta[k] ?? 1)),
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
  const lipCross = (i: number): number =>
    dist(nodeAt(lip, i, spec.nLip), nodeAt(lip, i, spec.nLip - 1));
  const P1 = nodeAt(lip, iP1, spec.nLip);
  const P2 = nodeAt(lip, iP2, spec.nLip);
  const O = nodeAt(lip, nW, spec.nLip);

  // -- fan -----------------------------------------------------------------------------------------
  const Hs = hub.atX(S.x);
  const Cs = nacIn.atX(S.x);
  const hSplitR = 0.8 * Math.min((S.r - Hs.r) / spec.nCore, (Cs.r - S.r) / spec.nBypass);
  const coreIn = radialLine(S.x, Hs.r, S.r, towardsEnd(spec.nCore, S.r - Hs.r, hSplitR));
  const bypIn = radialLine(
    S.x,
    S.r,
    Cs.r,
    vinokur(spec.nBypass, hSplitR / (Cs.r - S.r), 1.2 / spec.nBypass),
  );
  const fanEast = [...coreIn, ...bypIn.slice(1)];
  const xFan = bySpacing(S.x, (x) =>
    Math.min(spec.fanSpacingMax, spec.fanFaceSpacing + g * x, spec.splitterSpacing + g * (S.x - x)),
  );
  const nFanI = xFan.length - 1;
  const fan = tfi(
    'fan',
    Array.from(xFan, (x, k) => (k === 0 ? H0 : k === nFanI ? Hs : hub.atX(x))),
    Array.from(xFan, (x, k) => (k === 0 ? Cas0 : k === nFanI ? Cs : nacIn.atX(x))),
    fanWest,
    fanEast,
  );

  // -- core ----------------------------------------------------------------------------------------
  const plugC = hub.atX(C.x);
  const coreRows = geometry.bladeRows.filter((r) => r.duct === 'core');
  const coreWalls = ductWalls(
    hub,
    coreOuter,
    S.x,
    C.x,
    ductSpacing(coreRows, spec, spec.coreSpacingMax, [
      { x: S.x, h: spec.splitterSpacing },
      { x: C.x, h: spec.lipAxialSpacing },
    ]),
    { lower0: Hs, upper0: S, lower1: plugC, upper1: C },
  );
  const coreExit = radialLine(
    C.x,
    plugC.r,
    C.r,
    towardsEnd(spec.nCore, C.r - plugC.r, spec.lipRadialSpacing),
  );
  const core = tfi('core', coreWalls.lo, coreWalls.up, coreIn, coreExit);

  // -- bypass --------------------------------------------------------------------------------------
  const cowlB = cowl.atX(B.x);
  const bypRows = geometry.bladeRows.filter((r) => r.duct === 'bypass');
  const bypWalls = ductWalls(
    cowl,
    nacIn,
    S.x,
    B.x,
    ductSpacing(bypRows, spec, spec.bypassSpacingMax, [
      { x: S.x, h: spec.splitterSpacing },
      { x: B.x, h: spec.lipAxialSpacing },
    ]),
    { lower0: S, upper0: Cs, lower1: cowlB, upper1: B },
  );
  const bypExit = radialLine(
    B.x,
    cowlB.r,
    B.r,
    towardsEnd(spec.nBypass, B.r - cowlB.r, spec.lipRadialSpacing),
  );
  const bypass = tfi('bypass', bypWalls.lo, bypWalls.up, bypIn, bypExit);

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

  // plume block boundary lines (free internal lines, shaped to follow the jets)
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
  const prevO = nodeAt(lip, nW - 1, spec.nLip);
  const sO = (O.r - prevO.r) / (O.x - prevO.x);
  const s1 = (rPoOut - O.r) / (xOut - O.x);
  const r1 = O.r + 2.5 * 0.5 * (sO + s1);
  const outerTop = line([
    { x: O.x, r: O.r, s: sO },
    { x: O.x + 2.5, r: r1, s: s1 },
    { x: xOut, r: rPoOut, s: s1 },
  ]);
  const onLine = (c: Polyline, x: number, first: Pt, last: Pt, k: number, n: number): Pt =>
    k === 0 ? first : k === n ? last : c.atX(x);

  const bsNodes = xs.map((x, k) => onLine(bypassShear, x, B, { x: xOut, r: rBsOut }, k, kOut));
  const csNodes = xs
    .slice(kC)
    .map((x, k) => onLine(coreShear, x, C, { x: xOut, r: rCsOut }, k, kOut - kC));
  const xTop = xs.map((x) => O.x + ((x - B.x) * (xOut - O.x)) / (xOut - B.x));
  const topNodes = xTop.map((x, k) => onLine(outerTop, x, O, { x: xOut, r: rPoOut }, k, kOut));

  // -- afterbody, plug, plume blocks ------------------------------------------------------------
  const cowlNodes = xs
    .slice(0, kC + 1)
    .map((x, k) => (k === 0 ? cowlB : k === kC ? C : cowl.atX(x)));
  const bsC = bsNodes[kC] as Pt;
  const aftEast = radialLine(
    C.x,
    C.r,
    bsC.r,
    vinokur(spec.nBypass, spec.lipRadialSpacing / (bsC.r - C.r), 0.012 / (bsC.r - C.r)),
  );
  const afterbody = tfi('afterbody', cowlNodes, bsNodes.slice(0, kC + 1), bypExit, aftEast);

  const plugNodes = xs
    .slice(kC, kP + 1)
    .map((x, k, a) => (k === 0 ? plugC : k === a.length - 1 ? P : hub.atX(x)));
  const csP = csNodes[kP - kC] as Pt;
  const plugEast = radialLine(P.x, 0, csP.r, towardsEnd(spec.nCore, csP.r, 0.011));
  plugEast[0] = P;
  const plug = tfi('plug', plugNodes, csNodes.slice(0, kP - kC + 1), coreExit, plugEast);

  const axisNodes = xs.slice(kP).map((x, k) => (k === 0 ? P : { x, r: 0 }));
  const uniformT = (n: number): Float64Array =>
    Float64Array.from({ length: n + 1 }, (_, k) => k / n);
  const plumeCore = tfi(
    'plume-core',
    axisNodes,
    csNodes.slice(kP - kC),
    plugEast,
    radialLine(xOut, 0, rCsOut, uniformT(spec.nCore)),
  );
  const plumeBypass = tfi(
    'plume-bypass',
    csNodes,
    bsNodes.slice(kC),
    aftEast,
    radialLine(xOut, rCsOut, rBsOut, uniformT(spec.nBypass)),
  );
  const plumeOuter = tfi(
    'plume-outer',
    bsNodes,
    topNodes,
    colNodes(lip, nW),
    radialLine(xOut, rBsOut, rPoOut, uniformT(spec.nLip)),
  );

  // -- far field: TFI, then each column re-spaced so its first cell matches the block below -----
  const T = { x: P2.x - 0.6, r: rOut };
  const ffWestCurve = bezier(P2, { x: P2.x - 0.4, r: P2.r + 0.69 }, { x: T.x, r: P2.r + 2.5 }, T);
  const ffWest = alongCurve(ffWestCurve, geometric(spec.nFar, lipCross(iP2) / ffWestCurve.length));
  const ffSouth = [...rowNodes(lip, spec.nLip).slice(iP2), ...topNodes.slice(1)];
  const nFF = ffSouth.length - 1;
  const ffNorth = ffSouth.map((p, k) =>
    k === 0
      ? T
      : k === nFF
        ? { x: xOut, r: rOut }
        : { x: T.x + ((p.x - P2.x) * (xOut - T.x)) / (xOut - P2.x), r: rOut },
  );
  const ffEast = radialLine(xOut, rPoOut, rOut, geometric(spec.nFar, hOut / (rOut - rPoOut)));
  const farfield = tfi('farfield', ffSouth, ffNorth, ffWest, ffEast);
  const nLipOuter = nW - iP2;
  for (let k = 1; k < nFF; k++) {
    const below =
      k <= nLipOuter
        ? lipCross(iP2 + k)
        : dist(
            nodeAt(plumeOuter, k - nLipOuter, spec.nLip),
            nodeAt(plumeOuter, k - nLipOuter, spec.nLip - 1),
          );
    const L = new Polyline(colNodes(farfield, k)).length;
    respaceColumn(farfield, k, geometric(spec.nFar, below / L));
  }

  // -- inlet: from in front of the lip to the fan face, axis/spinner up to the C-block ----------
  const F = { x: P1.x - 0.2, r: 0 };
  const inlWestCurve = bezier(
    F,
    { x: F.x, r: 0.35 * P1.r },
    { x: P1.x - 0.35 * P1.r * 0.5, r: P1.r - 0.35 * P1.r * 0.866 },
    P1,
  );
  const inlWest = alongCurve(inlWestCurve, towardsEnd(nInl, inlWestCurve.length, lipCross(iP1)));
  const spinner = hub.sub(0, hub.sAtX(0));
  const sN = N.x - F.x;
  const Ls = sN + spinner.length;
  const hF = lipCross(iP1);
  const hSouth =
    (cap: number) =>
    (s: number): number =>
      Math.min(
        cap,
        hF + g * s,
        spec.fanFaceSpacing + g * Math.abs(s - sN),
        spec.fanFaceSpacing + g * (Ls - s),
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
    respaceColumn(inlet, k, vinokur(nInl, first / L, lipCross(iP1 - k) / L));
  }

  // -- upstream: rows re-spaced so the last cell matches the block across the east face ---------
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
  const hMinUp = Math.min(...Array.from({ length: nUpJ + 1 }, (_, j) => eastCross(j)));
  const qUp = 1 + spec.farGrowth;
  const nUpI = Math.ceil(Math.log(1 + ((F.x - xIn) * (qUp - 1)) / hMinUp) / Math.log(qUp));
  const upSouth = Array.from(geometricToEnd(nUpI, eastCross(0) / (F.x - xIn)), (u, k) =>
    k === nUpI ? F : { x: xIn + u * (F.x - xIn), r: 0 },
  );
  const upNorth = Array.from(geometricToEnd(nUpI, eastCross(nUpJ) / (T.x - xIn)), (u, k) =>
    k === nUpI ? T : { x: xIn + u * (T.x - xIn), r: rOut },
  );
  const upWest = upEast.map((p, j) => ({ x: xIn, r: j === nUpJ ? rOut : p.r }));
  const upstream = tfi('upstream', upSouth, upNorth, upWest, upEast);
  for (let j = 1; j < nUpJ; j++) {
    const L = new Polyline(rowNodes(upstream, j)).length;
    respaceRow(upstream, j, geometricToEnd(nUpI, eastCross(j) / L));
  }

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
  };
}

/**
 * Smoothing set-up: Thomas-Middlecoff control everywhere, except the directions whose spacing was
 * designed column by column (C-block and far-field wall-normal, inlet radial, upstream axial),
 * which keep their algebraic spacing as control (see smooth.ts).
 */
export function smoothingOptions(spec: MeshSpec): SmoothOptions {
  return {
    sweeps: spec.sweeps,
    omega: 0.8,
    blockControl: {
      lip: { psi: 'initial-grid' },
      farfield: { psi: 'initial-grid' },
      inlet: { psi: 'initial-grid' },
      upstream: { phi: 'initial-grid' },
    },
  };
}
