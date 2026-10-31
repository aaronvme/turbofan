// The per-dispatch uniform block of the GPU solver: one struct shared by every kernel of a stage
// (docs/SOLVER.md sections 3-10). The WGSL struct and the packer are generated from one field
// list, so the two cannot drift. Values are computed in f64 on the host (the reference state and
// the BC constants come from src/flow/reference, the shared gas code) and rounded to f32 once.
import { boundaryParams, type BoundaryParams } from '../reference/boundary';
import { cpMix, referenceState, type GasModel, type ReferenceState } from '../reference/gas';
import { DEFAULT_CFL, DEFAULT_CFL_PHYSICAL, RK3_ALPHA } from '../reference/solver';

type FieldType = 'f32' | 'u32';

/**
 * The tracking CFL with low-Mach preconditioning (minMach < 1) when the caller gives none: D4-32's
 * interim 0.8 (0.82 x the fully discrete 1D acoustic limit 0.972). It mirrors
 * DEFAULT_CFL_PRECONDITIONED of src/flow/reference/solver.ts at w2/reference c1094fc; import it
 * from there once main has it. Not final: the p_u trial may make it 1.15 (SOLVER.md 10).
 */
export const DEFAULT_CFL_PRECONDITIONED = 0.8;

/**
 * D4-89: the global M_cut of the engine's preconditioning (D4-81's Weiss-Smith/Turkel floor, tied
 * to the domain's peak velocity: the inlet Mach is about 0.5, so 0.02 is about 4 % of it, D4-59).
 * It mirrors the CPU reference ladder's GLOBAL_MACH_CUT (tests/ladder/oracle.ts on w2/reference-9
 * d05e16d), where it closed D4-63 (SOLVER.md 10). D4-40's 0.003 grew from rest on the engine mesh.
 */
export const ENGINE_MACH_CUT = 0.02;

/** The tracking mode's low-Mach preconditioning options (section 10; D4-10, D4-20, D4-22, D4-81). */
export interface LowMachPreconditioning {
  readonly minMach: number;
  /** M_cut of SLAU2's dissipation scaling (default minMach; >= 1 turns the scaling off). */
  readonly machCut?: number;
  /**
   * D4-81's global cutoff, the oracle's option of the same name (w2/reference-9): raises minMach
   * and M_cut to it, so beta >= globalMachCut everywhere (the far field included) and the flux's
   * M_cut >= globalMachCut. An M_cut >= 1 (the scaling off) and a minMach >= 1 (the plain scheme)
   * stay as they are. Absent: minMach and M_cut as given.
   */
  readonly globalMachCut?: number;
}

/**
 * The engine adapter's default (D4-40 as amended by D4-89): minMach = M_cut = the cut, a parameter
 * (default ENGINE_MACH_CUT). The kernel takes minMach^2 and M_cut as uniforms: no WGSL changes.
 */
export function enginePreconditioning(machCut: number = ENGINE_MACH_CUT): {
  readonly minMach: number;
  readonly machCut: number;
} {
  if (!(machCut > 0 && machCut < 1))
    throw new RangeError(`the engine's M_cut must be in (0, 1), not ${machCut}`);
  return { minMach: machCut, machCut };
}

/**
 * The adapter's preconditioning from its options (GpuFlowSolver): absent, the engine default at
 * `machCut` (default ENGINE_MACH_CUT); null, the plain scheme; otherwise as given. A `machCut`
 * beside explicit options would be ignored, so it is refused.
 */
export function adapterPreconditioning(
  given: LowMachPreconditioning | null | undefined,
  machCut?: number,
): LowMachPreconditioning | null {
  if (given !== undefined && machCut !== undefined)
    throw new Error(
      'machCut applies to the engine default only, not beside lowMachPreconditioning',
    );
  return given === undefined ? enginePreconditioning(machCut) : given;
}

/** minMach and M_cut in force: D4-81's global cut applied (the oracle's withGlobalCut). */
function inForce(pre: LowMachPreconditioning): { minMach: number; machCut: number } {
  const machCut = pre.machCut ?? pre.minMach;
  const cut = pre.globalMachCut;
  if (cut === undefined) return { minMach: pre.minMach, machCut };
  if (!(Number.isFinite(cut) && cut >= 0))
    throw new RangeError(`globalMachCut must be finite and >= 0, not ${cut}`);
  return { minMach: Math.max(pre.minMach, cut), machCut: Math.max(machCut, cut) };
}

/** Field order of the WGSL struct `Params`. Every field is 4 bytes. */
export const PARAM_FIELDS = [
  // the reference state the gauges are measured from (section 4)
  ['rhoInf', 'f32'],
  ['pInf', 'f32'],
  ['tInf', 'f32'],
  ['uInf', 'f32'],
  ['rInf', 'f32'],
  ['cInf', 'f32'],
  /** cp of air and of products at T_inf: the linearised start of the T' Newton (section 3). */
  ['cpaInf', 'f32'],
  ['cppInf', 'f32'],
  /** h_products(T_inf) - h_air(T_inf). */
  ['dInf', 'f32'],
  // boundary conditions (section 5)
  ['p0', 'f32'],
  ['t0', 'f32'],
  /** p0 - p_inf and t0 - T_inf, in f64 before rounding: exact zeros for a free stream at rest. */
  ['dp0', 'f32'],
  ['dT0', 'f32'],
  /** cp of air at t0: the start of the stagnation-offset Newton. */
  ['cpaT0', 'f32'],
  /** p_out - p_inf. */
  ['pOutGauge', 'f32'],
  /** beta_inf^2 of the far field (1: the physical characteristics). */
  ['farBeta2', 'f32'],
  /** 1 if the free stream is supersonic (u_inf >= c_inf): the inflow ghost is the free stream. */
  ['supersonicInflow', 'u32'],
  // the scheme (sections 7, 10)
  ['cfl', 'f32'],
  ['cflPhysical', 'f32'],
  /** M_cut of SLAU2's low-Mach dissipation scaling (1: off, the plain flux bitwise). */
  ['machCut', 'f32'],
  ['minMach2', 'f32'],
  /** 1: low-Mach preconditioning of the tracking mode (beta^2 and the increment update). */
  ['precondition', 'u32'],
  /** 0 tracking (3-stage RK, local dt), 1 physical (SSP-RK3, global dt). */
  ['mode', 'u32'],
  /** 0, 1, 2. */
  ['stage', 'u32'],
  /** Tracking: alpha_k. */
  ['alpha', 'f32'],
  /** Physical: U = w0 U^n + w1 E(U^(k-1)) (stage 0 takes E alone). */
  ['w0', 'f32'],
  ['w1', 'f32'],
  /** Physical: the stage's Butcher weight (1/6, 1/6, 2/3) of the compensated update (SOLVER.md 14). */
  ['wInc', 'f32'],
  // sizes
  ['nCells', 'u32'],
  ['nGhosts', 'u32'],
  ['nWorkgroups', 'u32'],
] as const satisfies readonly (readonly [string, FieldType])[];

export type ParamName = (typeof PARAM_FIELDS)[number][0];
export type ParamValues = Readonly<Record<ParamName, number>>;

/** Struct size in bytes, padded to 16 (uniform layout). */
export const PARAMS_BYTES = Math.ceil((4 * PARAM_FIELDS.length) / 16) * 16;
/** Offset between the per-stage blocks in one uniform buffer (minUniformBufferOffsetAlignment). */
export const PARAMS_STRIDE = 256;

export function paramsStructWgsl(): string {
  const pad = PARAMS_BYTES / 4 - PARAM_FIELDS.length;
  const fields = PARAM_FIELDS.map(([n, t]) => `  ${n}: ${t},`);
  for (let k = 0; k < pad; k++) fields.push(`  pad${k}: u32,`);
  return `struct Params {\n${fields.join('\n')}\n}\n`;
}

export function packParams(v: ParamValues): ArrayBuffer {
  const buf = new ArrayBuffer(PARAMS_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  PARAM_FIELDS.forEach(([name, type], k) => {
    const x = v[name];
    if (!Number.isFinite(x)) throw new Error(`param ${name} is ${x}`);
    if (type === 'u32') {
      if (!(Number.isInteger(x) && x >= 0 && x <= 0xffffffff)) {
        throw new Error(`param ${name} = ${x} is not a u32`);
      }
      u[k] = x;
    } else {
      f[k] = x;
    }
  });
  return buf;
}

/** The scheme options the GPU solver takes (docs/SOLVER.md; the oracle's SolverOptions). */
export interface GpuSchemeOptions {
  readonly gas: GasModel;
  readonly freeStream: {
    readonly pressure: number;
    readonly temperature: number;
    readonly velocity: number;
  };
  readonly cfl?: number;
  readonly cflPhysical?: number;
  readonly inflowTotal?: { readonly p0: number; readonly t0: number };
  readonly outflowPressure?: number;
  /**
   * Low-Mach preconditioning of the tracking mode (section 10, D4-10, D4-20, D4-22). Implemented
   * as SOLVER.md states it; its CFL, minMach and dissipation are not final (critic pass 7, D4-30,
   * D4-32): the caller chooses them (the engine's: enginePreconditioning, D4-89).
   */
  readonly lowMachPreconditioning?: LowMachPreconditioning;
}

export interface StageParamSet {
  readonly ref: ReferenceState;
  /** The tracking mode's BC parameters (preconditioned far field if preconditioning is on). */
  readonly bcTracking: BoundaryParams;
  readonly bcPhysical: BoundaryParams;
  /** Three blocks per mode: tracking stages 1-3, then physical stages 1-3. */
  readonly tracking: readonly ParamValues[];
  readonly physical: readonly ParamValues[];
}

/** SSP-RK3 (Shu & Osher 1988): U = w0 U^n + w1 E(U^(k-1)); stage 1 takes E(U^n) alone. */
export const SSP_RK3_WEIGHTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [3 / 4, 1 / 4],
  [1 / 3, 2 / 3],
];

/**
 * The same scheme's Butcher weights: U^n+1 = U^n + sum_k b_k dt L(U^(k-1)), the form the kernel's
 * compensated update accumulates (SOLVER.md 14).
 */
export const SSP_RK3_BUTCHER: readonly number[] = [1 / 6, 1 / 6, 2 / 3];

/** The six uniform blocks of a solver (3 tracking stages, 3 physical stages). */
export function stageParams(
  opts: GpuSchemeOptions,
  sizes: { readonly nCells: number; readonly nGhosts: number; readonly nWorkgroups: number },
): StageParamSet {
  // a negative or non-finite CFL is a caller error (W2S-B-N7; 0 stays: solver-exact freezes tau with it)
  for (const [name, v] of [
    ['cfl', opts.cfl],
    ['cflPhysical', opts.cflPhysical],
  ] as const) {
    if (v !== undefined && !(v >= 0 && Number.isFinite(v)))
      throw new Error(`${name} ${v} must be >= 0`);
  }
  const ref = referenceState(opts.gas, opts.freeStream);
  const bcOpts = {
    ...(opts.inflowTotal === undefined ? {} : { inflowTotal: opts.inflowTotal }),
    ...(opts.outflowPressure === undefined ? {} : { outflowPressure: opts.outflowPressure }),
  };
  const bcPhysical = boundaryParams(ref, bcOpts);
  const pre =
    opts.lowMachPreconditioning === undefined ? undefined : inForce(opts.lowMachPreconditioning);
  const mInf2 = (ref.u * ref.u) / (ref.c * ref.c);
  const bcTracking =
    pre === undefined
      ? bcPhysical
      : boundaryParams(ref, {
          ...bcOpts,
          farFieldBeta2: Math.min(1, Math.max(mInf2, pre.minMach * pre.minMach)),
        });
  const g = opts.gas;
  const base = (bc: BoundaryParams) => ({
    rhoInf: ref.rho,
    pInf: ref.p,
    tInf: ref.t,
    uInf: ref.u,
    rInf: ref.r,
    cInf: ref.c,
    cpaInf: cpMix(g, ref.t, 0),
    cppInf: cpMix(g, ref.t, 1),
    dInf: ref.dInf,
    p0: bc.p0,
    t0: bc.t0,
    dp0: bc.p0 - ref.p,
    dT0: bc.t0 - ref.t,
    cpaT0: cpMix(g, bc.t0, 0),
    pOutGauge: bc.pOut - ref.p,
    farBeta2: bc.farFieldBeta2,
    supersonicInflow: ref.u >= ref.c ? 1 : 0,
    cfl:
      opts.cfl ?? (pre !== undefined && pre.minMach < 1 ? DEFAULT_CFL_PRECONDITIONED : DEFAULT_CFL),
    cflPhysical: opts.cflPhysical ?? DEFAULT_CFL_PHYSICAL,
    minMach2: pre === undefined ? 0 : pre.minMach * pre.minMach,
    nCells: sizes.nCells,
    nGhosts: sizes.nGhosts,
    nWorkgroups: sizes.nWorkgroups,
  });
  const tracking = RK3_ALPHA.map((alpha, stage) => ({
    ...base(bcTracking),
    machCut: pre === undefined ? 1 : Math.min(1, pre.machCut),
    precondition: pre === undefined ? 0 : 1,
    mode: 0,
    stage,
    alpha,
    w0: 0,
    w1: 1,
    wInc: 0,
  }));
  const physical = SSP_RK3_WEIGHTS.map(([w0, w1], stage) => ({
    ...base(bcPhysical),
    machCut: 1,
    precondition: 0,
    mode: 1,
    stage,
    alpha: 1,
    w0,
    w1,
    wInc: SSP_RK3_BUTCHER[stage] ?? NaN,
  }));
  return { ref, bcTracking, bcPhysical, tracking, physical };
}
