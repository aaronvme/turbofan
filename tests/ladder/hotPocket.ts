// Ladder L14 (PHYSICS.md 3.3, D5-2; W2S-I1): a hot gas pocket moving through still cold gas at the
// engine's defaults, shared by the CPU ladder (cases/l14.ts) and the GPU ladder
// (tests/gpu-ladder/l14.test.ts) so the two run the same cases and rows. The set-up is critic pass
// 19's probe (docs/reviews/probes/w2s-hot-pocket.probe.ts.txt): an annular duct r 0.30-0.45 m,
// x -0.3..0.3 m, 60 x 16 cells, slip walls on both sides, inflow at the ambient totals and outflow
// at p_inf, thermally perfect gas, ISA SLS at rest; a sharp pocket of T' = dT and Z 0.015 at
// pressure equilibrium over |x| < 0.06 m, at the outer wall (r > 0.41 m) or mid-channel
// (|r - 0.375| < 0.035 m), moving axially at u0.
import { THRESHOLDS } from '../../src/contracts/thresholds';
import {
  THERMALLY_PERFECT,
  cpMix,
  gasConstantMix,
  productsFraction,
} from '../../src/flow/reference/gas';
import type { SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { NP, NU, type PhysicalState } from '../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import type { LadderRow } from './common';
import { AMBIENT_AT_REST, ENGINE_PRECONDITIONING_CUT } from './oracle';

export interface HotPocketCase {
  /** T' of the pocket, K. */
  readonly dT: number;
  /** The pocket's axial velocity, m/s (negative: upstream, as the engine's failing cells moved). */
  readonly u0: number;
  readonly where: 'wall' | 'mid';
}

/**
 * PHYSICS.md 3.3 L14's cases: dT in {900, 1200} K x u0 in {-100, -300} m/s x {wall, mid}, then the
 * probe's two cases that were bounded before any fix (900 K at -50 m/s and 1200 K at rest, both at
 * the wall), which must stay bounded.
 */
export const HOT_POCKET_CASES: readonly HotPocketCase[] = [
  ...[900, 1200].flatMap((dT) =>
    [-100, -300].flatMap((u0) =>
      (['wall', 'mid'] as const).map((where): HotPocketCase => ({ dT, u0, where })),
    ),
  ),
  { dT: 900, u0: -50, where: 'wall' },
  { dT: 1200, u0: 0, where: 'wall' },
];

export const caseName = (c: HotPocketCase): string => `${c.dT} K, ${c.u0} m/s, ${c.where}`;

const L14 = THRESHOLDS.L14.values;
/** The run length of every case (PHYSICS.md 3.3 L14: finite to 2000 iterations). */
export const HOT_POCKET_ITERATIONS = L14.iterations.value;

/** The duct: 60 x 16 cells, slip walls both sides, inflow at imin and outflow at imax. */
export function hotPocketMesh(): SolverMesh {
  return solverMesh(
    singleBlock(rectangle('duct', -0.3, 0.3, 0.3, 0.45, 60, 16), {
      imin: BC.INFLOW,
      imax: BC.OUTFLOW,
      jmin: BC.SLIP_WALL,
      jmax: BC.SLIP_WALL,
    }),
  );
}

/**
 * The engine's defaults: thermally perfect gas, ISA SLS at rest, preconditioned tracking with
 * minMach = M_cut = 0.02 in force (D4-81's global cut, the GPU default's ENGINE_MACH_CUT), the
 * default preconditioned CFL (0.8, no `cfl` given) and the default (sharp) limiter.
 */
export const HOT_POCKET_OPTIONS: SolverOptions = {
  gas: THERMALLY_PERFECT,
  freeStream: AMBIENT_AT_REST,
  lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
};

const R_AIR = 287.05287;
/** The pocket's fuel (mixture fraction Z), PHYSICS.md 3.3 L14. */
export const POCKET_Z = 0.015;

export function inPocket(c: HotPocketCase, x: number, r: number): boolean {
  return Math.abs(x) < 0.06 && (c.where === 'wall' ? r > 0.41 : Math.abs(r - 0.375) < 0.035);
}

/** The start: the pocket at pressure equilibrium (p = p_inf), the rest the ambient at rest. */
export function hotPocketState(c: HotPocketCase): (x: number, r: number) => PhysicalState {
  const p = AMBIENT_AT_REST.pressure;
  return (x, r) => {
    const hot = inPocket(c, x, r);
    const T = AMBIENT_AT_REST.temperature + (hot ? c.dT : 0);
    return { rho: p / (R_AIR * T), u: hot ? c.u0 : 0, v: 0, w: 0, p, z: hot ? POCKET_Z : 0 };
  };
}

/**
 * L14's restated peak row (PHYSICS.md 3.3, amended by D5-5): the bound T'_s(p') = T_h (p /
 * p_inf)^((gamma - 1) / gamma) - T_inf, the start's hot gas (T_h = T_inf + dT, Z 0.015) compressed
 * isentropically to a cell's own pressure p = p_inf + p', with gamma = cp / (cp - R) of the
 * thermally perfect gas at T_h and Z 0.015 (SOLVER.md 3's mixture). It is the temperature the
 * physics makes from the start's hot gas at that pressure, so a cell above 1.03 x it is one the
 * scheme made.
 */
export function isentropicPocketBound(c: HotPocketCase): (pGauge: number) => number {
  const pInf = AMBIENT_AT_REST.pressure;
  const tInf = AMBIENT_AT_REST.temperature;
  const th = tInf + c.dT;
  const phi = productsFraction(THERMALLY_PERFECT, POCKET_Z);
  // (gamma - 1) / gamma = R / cp
  const k = gasConstantMix(THERMALLY_PERFECT, phi) / cpMix(THERMALLY_PERFECT, th, phi);
  return (pGauge) => th * ((pInf + pGauge) / pInf) ** k - tInf;
}

/**
 * W3S-N1 (critic pass 20): "max T' at 2000 <= its start" is read as end <= start x (1 + this), the
 * f64 rounding of the CPU at-rest case, which is a rest state to round-off. Measured (w3/scheme
 * round 3, scratch ; u = 2^-53): its max T' sits +4u, +2u, +6u and -9u
 * from its start after 1, 10, 100 and 2000 iterations, so the unallowed row's verdict there is a
 * coin toss. The bound: one ulp of the pocket cell's rho' or eta moves its T' by at most 6.8u or
 * 3.4u, so the half-ulp rounding of both in one iteration by at most 5.1u, and 2000 iterations by
 * 1.0e4 u = 1.1e-12; rounded up to one figure, 2e-12 (2.4e-9 K at the pocket's 1200 K; any heating
 * the row is for is many orders above it). On the GPU the start is f32-rounded and its pocket moves
 * (end 0.41 of the start), so no tie arises there; the GPU's state is read as f32 + low part in
 * f64 and the same allowance applies.
 */
export const END_ROUND_OFF_ALLOWANCE = 2e-12;

const AMBIENT_GAMMA = (() => {
  const cp = cpMix(THERMALLY_PERFECT, AMBIENT_AT_REST.temperature, 0);
  return cp / (cp - gasConstantMix(THERMALLY_PERFECT, 0));
})();
/** rho_inf c_inf of the ambient at rest: the acoustic impedance W3S-N3's p' is read against. */
const AMBIENT_IMPEDANCE =
  (AMBIENT_AT_REST.pressure / (R_AIR * AMBIENT_AT_REST.temperature)) *
  Math.sqrt(AMBIENT_GAMMA * R_AIR * AMBIENT_AT_REST.temperature);

/** One sample of the field: max and min T' over the cells, and whether every cell is sound. */
export interface PocketSample {
  readonly tMax: number;
  readonly tMin: number;
  /** max p' over the cells (W3S-N3: reported beside the peak row, whose bound moves with p'). */
  readonly pMax: number;
  /** The cell of pMax. */
  readonly pMaxAt: number;
  /**
   * max over the cells of T' / T'_s(p'), the restated peak row's measure (T' <= 1.03 T'_s). A
   * cell whose bound is not positive counts Infinity if it breaks T' <= 1.03 T'_s, else -Infinity.
   */
  readonly overBound: number;
  /** The cell of overBound. */
  readonly overBoundAt: number;
  /** Every conserved value and primitive is finite, and rho > 0 in every cell. */
  readonly sound: boolean;
}

/** The sample of the primitives P (cells first) and the conserved state U of n cells. */
export function samplePocket(
  P: ArrayLike<number>,
  U: ArrayLike<number>,
  rhoInf: number,
  n: number,
  bound: (pGauge: number) => number,
): PocketSample {
  const limit = L14.maxPeakOverIsentropicCompression.value;
  let tMax = -Infinity;
  let tMin = Infinity;
  let pMax = -Infinity;
  let pMaxAt = -1;
  let overBound = -Infinity;
  let overBoundAt = -1;
  let sound = true;
  for (let c = 0; c < n; c++) {
    for (let k = 0; k < NU; k++) if (!Number.isFinite(U[NU * c + k])) sound = false;
    for (let k = 0; k < NP; k++) if (!Number.isFinite(P[NP * c + k])) sound = false;
    if (!(rhoInf + (U[NU * c] as number) > 0)) sound = false;
    const t = P[NP * c + 6] as number;
    if (t > tMax) tMax = t;
    if (t < tMin) tMin = t;
    const pG = P[NP * c + 4] as number;
    if (pG > pMax) {
      pMax = pG;
      pMaxAt = c;
    }
    const ts = bound(pG);
    const r = ts > 0 ? t / ts : t <= limit * ts ? -Infinity : Infinity;
    if (r > overBound) {
      overBound = r;
      overBoundAt = c;
    }
  }
  return { tMax, tMin, pMax, pMaxAt, overBound, overBoundAt, sound };
}

/** A run of one case: the start sample, then one per iteration until the first unsound one. */
export interface PocketTrace {
  readonly start: PocketSample;
  /** Iterations completed with a sound state (HOT_POCKET_ITERATIONS when the run held). */
  readonly soundIterations: number;
  /** The largest max T' over the start and every sound iteration (reported; no row since D5-5). */
  readonly peak: number;
  /** The smallest min T' over the start and every sound iteration. */
  readonly low: number;
  /** Max T' at the last iteration (NaN unless the run held to the end). */
  readonly end: number;
  /** Where the run's peak sat (iteration, then cell), for the evidence. */
  readonly peakAt: readonly [number, number];
  /** The largest overBound over the start and every sound iteration: the restated peak row. */
  readonly peakOverBound: number;
  /** Where it sat (iteration, then cell). */
  readonly peakOverBoundAt: readonly [number, number];
  /** The largest max p' over the start and every sound iteration (W3S-N3, reported). */
  readonly peakP: number;
  /** Where it sat (iteration, then cell). */
  readonly peakPAt: readonly [number, number];
}

/** Runs one case through `step` (one iteration, then the sample of the new state). */
export async function tracePocket(
  start: PocketSample,
  step: () => Promise<PocketSample & { readonly at?: number }> | (PocketSample & { at?: number }),
): Promise<PocketTrace> {
  let peak = start.tMax;
  let low = start.tMin;
  let end = NaN;
  let peakAt: [number, number] = [0, -1];
  let peakOverBound = start.overBound;
  let peakOverBoundAt: [number, number] = [0, start.overBoundAt];
  let peakP = start.pMax;
  let peakPAt: [number, number] = [0, start.pMaxAt];
  let k = 0;
  while (k < HOT_POCKET_ITERATIONS) {
    const s = await step();
    if (!s.sound) break;
    k++;
    if (s.tMax > peak) {
      peak = s.tMax;
      peakAt = [k, s.at ?? -1];
    }
    if (s.overBound > peakOverBound) {
      peakOverBound = s.overBound;
      peakOverBoundAt = [k, s.overBoundAt];
    }
    if (s.pMax > peakP) {
      peakP = s.pMax;
      peakPAt = [k, s.pMaxAt];
    }
    low = Math.min(low, s.tMin);
    if (k === HOT_POCKET_ITERATIONS) end = s.tMax;
  }
  return {
    start,
    soundIterations: k,
    peak,
    low,
    end,
    peakAt,
    peakOverBound,
    peakOverBoundAt,
    peakP,
    peakPAt,
  };
}

/**
 * PHYSICS.md 3.3 L14's four rows of one case: finite to 2000 iterations with rho > 0; for every
 * cell and iteration T' <= 1.03 T'_s, the start's hot gas compressed isentropically to the cell's
 * own pressure (the peak row as amended by D5-5); max T' at 2000 <= its start (to
 * END_ROUND_OFF_ALLOWANCE, W3S-N1); min T' >= -0.03 dT (the run's minimum over every iteration and
 * cell, the stricter reading). A fifth row reports the run's peak p' (W3S-N3, not gated): the
 * peak row's bound moves with the cell's pressure, so a pressure overshoot shows here.
 */
export function hotPocketRows(c: HotPocketCase, t: PocketTrace, tag = ''): LadderRow[] {
  const name = `${tag}${caseName(c)}`;
  const held = t.soundIterations === HOT_POCKET_ITERATIONS;
  const peak = held ? t.peakOverBound : NaN;
  const end = held ? t.end / t.start.tMax : NaN;
  const low = held ? t.low / c.dT : NaN;
  return [
    {
      id: 'L14',
      metric: `${name}: iterations finite with rho > 0`,
      threshold: `= ${HOT_POCKET_ITERATIONS}`,
      value: t.soundIterations,
      pass: held,
    },
    {
      id: 'L14',
      metric: `${name}: peak T' / T'_s, the start's hot gas compressed isentropically to the cell's pressure`,
      threshold: `<= ${L14.maxPeakOverIsentropicCompression.value}`,
      value: peak,
      pass: peak <= L14.maxPeakOverIsentropicCompression.value,
    },
    {
      id: 'L14',
      metric: `${name}: peak p' over cells and iterations, Pa (beside the peak row; rho_inf c_inf |u0| = ${(AMBIENT_IMPEDANCE * Math.abs(c.u0)).toExponential(2)} Pa)`,
      threshold: 'reported',
      value: held ? t.peakP : NaN,
      pass: 'reported',
    },
    {
      id: 'L14',
      metric: `${name}: max T' at ${HOT_POCKET_ITERATIONS} / its start`,
      threshold: `<= 1 (+ ${END_ROUND_OFF_ALLOWANCE} round-off)`,
      value: end,
      pass: end <= 1 + END_ROUND_OFF_ALLOWANCE,
    },
    {
      id: 'L14',
      metric: `${name}: min T' / dT`,
      threshold: `>= -${L14.maxUndershootFractionOfDeltaT.value}`,
      value: low,
      pass: low >= -L14.maxUndershootFractionOfDeltaT.value,
    },
  ];
}
