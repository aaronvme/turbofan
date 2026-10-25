// Placeholder flowpath with roughly CFM56-7B-class proportions, for the W0 mesh-topology spike only.
//
// NOT engine data. Only the fan tip diameter (1.55 m, the 61 in fan of the CFM56-7B) is a public
// figure; every other radius, length and chord below is an illustrative shape chosen to exercise
// the mesher (inlet lip, splitter, a 2-3 cm HPC rear annulus, a plugged core nozzle). W1 replaces
// this with an adapter from the researched EngineDefinition (src/contracts, docs/ENGINE_FACTS.md).
import { hermitePoints as hermite, type HermiteKnot as Knot } from '../curve';
import type { Pt } from '../types';
import type { BladeRow, FlowpathGeometry } from './flowpath';

/**
 * Quarter ellipse from the highlight (vertical tangent) to a horizontal tangent: semi-axis ax
 * downstream, br radially (negative br curves inwards, i.e. the inlet side of the lip).
 */
function lip(x0: number, r0: number, ax: number, br: number, n = 600): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const th = (k / n) * (Math.PI / 2);
    pts.push({ x: x0 + ax * (1 - Math.cos(th)), r: r0 + br * Math.sin(th) });
  }
  return pts;
}

/** Lip ellipse followed by Hermite knots; the first knot is the ellipse's exact end point. */
function lipThen(lipPts: Pt[], knots: readonly Omit<Knot, never>[]): Pt[] {
  const end = lipPts[lipPts.length - 1] as Pt;
  const rest = hermite([{ x: end.x, r: end.r, s: 0 }, ...knots]);
  return [...lipPts, ...rest.slice(1)];
}

/** Rows of a multistage machine: chords vary linearly, gaps are a common fraction of the chord. */
function rows(
  prefix: string,
  names: readonly string[],
  x0: number,
  x1: number,
  c0: number,
  c1: number,
): BladeRow[] {
  const n = names.length;
  const chords = names.map((_, k) => c0 + ((c1 - c0) * k) / Math.max(1, n - 1));
  const chordSum = chords.reduce((s, c) => s + c, 0);
  const gapWeights = chords.slice(0, -1).map((c, k) => 0.5 * (c + (chords[k + 1] ?? c)));
  const lambda = (x1 - x0 - chordSum) / gapWeights.reduce((s, w) => s + w, 0);
  const out: BladeRow[] = [];
  let x = x0;
  names.forEach((name, k) => {
    const c = chords[k] ?? 0;
    out.push({ name: `${prefix} ${name}`, duct: 'core', xLE: x, xTE: x + c });
    x += c + lambda * (gapWeights[k] ?? 0);
  });
  return out;
}

const SPLITTER: Pt = { x: 0.42, r: 0.44 };
const CORE_LIP: Pt = { x: 3.0, r: 0.335 };
const BYPASS_LIP: Pt = { x: 1.6, r: 0.72 };
const HIGHLIGHT: Pt = { x: -0.7, r: 0.8 };

export function placeholderFlowpath(): FlowpathGeometry {
  const hub = hermite([
    { x: -0.5, r: 0, s: 0.69 }, // spinner nose (cone half-angle ~35 deg)
    { x: 0.0, r: 0.24, s: 0.27 }, // fan face hub
    { x: 0.22, r: 0.3, s: 0.15 }, // fan trailing edge
    { x: SPLITTER.x, r: 0.318, s: 0.04 },
    { x: 0.8, r: 0.318, s: -0.02 }, // booster exit
    { x: 0.9, r: 0.27, s: -0.55 }, // gooseneck
    { x: 1.0, r: 0.228, s: -0.1 }, // HPC inlet
    { x: 1.55, r: 0.256, s: 0.05 }, // HPC exit
    { x: 1.62, r: 0.256, s: 0.0 },
    { x: 1.78, r: 0.236, s: 0.0 }, // combustor inner liner
    { x: 1.95, r: 0.262, s: 0.1 }, // HPT
    { x: 2.1, r: 0.268, s: 0.0 },
    { x: 2.55, r: 0.252, s: -0.05 }, // LPT exit
    { x: 2.65, r: 0.248, s: -0.1 },
    { x: CORE_LIP.x, r: 0.18, s: -0.3 }, // plug at the core-nozzle exit plane
    { x: 3.55, r: 0, s: -0.36 }, // plug tip
  ]);
  const coreOuter = hermite([
    { x: SPLITTER.x, r: SPLITTER.r, s: -0.1 },
    { x: 0.8, r: 0.405, s: -0.08 },
    { x: 0.92, r: 0.35, s: -0.55 },
    { x: 1.0, r: 0.318, s: -0.15 },
    { x: 1.55, r: 0.281, s: -0.03 }, // HPC exit: 2.5 cm annulus
    { x: 1.62, r: 0.29, s: 0.2 },
    { x: 1.78, r: 0.335, s: 0.0 },
    { x: 1.95, r: 0.33, s: -0.05 },
    { x: 2.1, r: 0.34, s: 0.15 },
    { x: 2.5, r: 0.415, s: 0.08 },
    { x: 2.6, r: 0.415, s: -0.05 },
    { x: CORE_LIP.x, r: CORE_LIP.r, s: -0.25 },
  ]);
  const coreCowl = hermite([
    { x: SPLITTER.x, r: SPLITTER.r, s: 0.3 },
    { x: 0.62, r: 0.48, s: 0.12 },
    { x: 0.9, r: 0.5, s: 0.02 },
    { x: BYPASS_LIP.x, r: 0.5, s: -0.03 },
    { x: 2.2, r: 0.49, s: -0.05 },
    { x: 2.7, r: 0.44, s: -0.18 },
    { x: CORE_LIP.x, r: CORE_LIP.r, s: -0.42 },
  ]);
  const nacelleInner = lipThen(lip(HIGHLIGHT.x, HIGHLIGHT.r, 0.16, -0.058), [
    { x: 0.0, r: 0.775, s: 0.02 }, // fan tip: D = 1.55 m
    { x: 0.22, r: 0.772, s: -0.03 },
    { x: SPLITTER.x, r: 0.765, s: -0.03 },
    { x: 0.8, r: 0.758, s: -0.02 },
    { x: 1.2, r: 0.745, s: -0.05 },
    { x: BYPASS_LIP.x, r: BYPASS_LIP.r, s: -0.08 },
  ]);
  const nacelleOuter = lipThen(lip(HIGHLIGHT.x, HIGHLIGHT.r, 0.55, 0.185), [
    { x: 0.6, r: 0.96, s: -0.07 },
    { x: 1.2, r: 0.86, s: -0.24 },
    { x: BYPASS_LIP.x, r: BYPASS_LIP.r, s: -0.42 },
  ]);

  const bladeRows: BladeRow[] = [
    { name: 'Fan rotor', duct: 'fan', xLE: 0.03, xTE: 0.2 },
    { name: 'Fan OGV', duct: 'bypass', xLE: 0.62, xTE: 0.78 },
    ...rows('Booster', ['IGV', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3'], 0.45, 0.8, 0.03, 0.03),
    ...rows(
      'HPC',
      ['IGV', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((s) => [`R${s}`, `S${s}`])],
      1.0,
      1.55,
      0.03,
      0.015,
    ),
    ...rows('HPT', ['NGV', 'R1'], 1.96, 2.055, 0.04, 0.035),
    ...rows('LPT', ['S1', 'R1', 'S2', 'R2', 'S3', 'R3', 'S4', 'R4'], 2.1, 2.5, 0.03, 0.045),
    { name: 'TRF struts', duct: 'core', xLE: 2.56, xTE: 2.63 },
  ];

  return {
    name: 'placeholder CFM56-7B-class flowpath (W0 mesh spike; not engine data)',
    fanTipDiameter: 1.55,
    curves: { hub, coreOuter, coreCowl, nacelleInner, nacelleOuter },
    bladeRows,
    combustor: { xStart: 1.65, xEnd: 1.92 },
  };
}
