// The flow solver contract: the 2D axisymmetric + swirl WebGPU solver (W2) and the render
// textures it hands to three.js. src/mocks/mockFlowField.ts fills the same layout on the CPU.

import { R_AIR, type AmbientConditions } from './ambient';
import type { CycleState } from './cycle';
import type { EngineDefinition } from './engine';
import type { FlowStatus } from './sim';
import { HALF_MAX, fromHalfBits, toHalfBits } from './half';
import { SOLVER_REDUCTION_STATIONS, type SolverReductionStationId } from './stations';

/** tracking: local time stepping toward the cycle-model targets; physical: SSP-RK3 in real time (slow motion). */
export type SolverMode = 'tracking' | 'physical';
export const SOLVER_MODES = ['tracking', 'physical'] as const satisfies readonly SolverMode[];

/**
 * The offline-generated multi-block mesh (tools/mesh). Its binary layout is owned by the mesh
 * generator (w1/mesh); the solver only needs this header to validate what it was given.
 */
export interface MeshAsset {
  readonly format: 'turbofan-mesh';
  readonly version: number;
  readonly cellCount: number;
  readonly blockCount: number;
  /** The rectangle the mesh covers; both render extents must lie inside it (W0M-I5). */
  readonly domain: SolverDomain;
  readonly bytes: ArrayBuffer;
}

/**
 * The solver domain (docs/MESH.md, boundary conditions): inflow at x = xIn, outflow at
 * x = xOut, the characteristic far-field boundary at r = rOut, the axis at r = 0. The engine
 * walls are holes inside it (fluidFraction 0 in the render textures).
 */
export interface SolverDomain {
  readonly xIn: number;
  readonly xOut: number;
  readonly rOut: number;
}

/**
 * The domain size docs/MESH.md requires, in fan tip diameters D: at least 5 D upstream of the
 * nacelle highlight, 5 D radially above the largest nacelle radius, and 20 D downstream of the
 * core nozzle lip. The mesher rounds these outwards (MESH.md D7).
 */
export const SOLVER_DOMAIN_MIN_D = { upstream: 5, radial: 5, downstream: 20 } as const;

/**
 * The smallest domain a mesh of this engine may have (SOLVER_DOMAIN_MIN_D), with D from the
 * fan rotor's leading-edge tip. Render extents sized inside it hold solver data in every texel
 * for any conforming mesh.
 */
export function minimumSolverDomain(def: EngineDefinition): SolverDomain {
  const fan = def.bladeRows.find((r) => r.component === 'fan' && r.kind === 'rotor');
  const highlight = def.flowpath.curves.nacelleInner.points[0];
  const coreLip = def.flowpath.curves.coreOuter.points.at(-1);
  if (fan === undefined || highlight === undefined || coreLip === undefined)
    throw new Error('minimumSolverDomain: needs a fan rotor, a nacelle highlight and a core lip');
  const d = 2 * fan.leadingEdge.tip.r;
  const nacelleMaxR = Math.max(...def.flowpath.curves.nacelleOuter.points.map((p) => p.r));
  return {
    xIn: highlight.x - SOLVER_DOMAIN_MIN_D.upstream * d,
    xOut: coreLip.x + SOLVER_DOMAIN_MIN_D.downstream * d,
    rOut: nacelleMaxR + SOLVER_DOMAIN_MIN_D.radial * d,
  };
}

/**
 * Problems if any texel of the extent lies outside the domain (empty when inside). The W2
 * resample has no data there, so a mesh whose domain fails this must be rejected on load.
 */
export function fieldExtentDomainProblems(extent: FieldExtent, domain: SolverDomain): string[] {
  const problems: string[] = [];
  const p = (msg: string) => problems.push(`${extent.id}: ${msg}`);
  if (extent.xMin < domain.xIn)
    p(`xMin ${extent.xMin} is upstream of the inflow xIn ${domain.xIn}`);
  if (extent.xMax > domain.xOut)
    p(`xMax ${extent.xMax} is downstream of the outflow xOut ${domain.xOut}`);
  if (extent.rMin < 0) p(`rMin ${extent.rMin} is below the axis`);
  if (extent.rMax > domain.rOut)
    p(`rMax ${extent.rMax} is beyond the far-field boundary rOut ${domain.rOut}`);
  return problems;
}

export interface FlowSolverInit {
  readonly device: GPUDevice;
  readonly mesh: MeshAsset;
  readonly definition: EngineDefinition;
}

export interface StationTarget {
  readonly ptPa: number;
  readonly ttK: number;
  readonly wKgPerS: number;
  readonly fuelAirRatio: number;
}

/** What the coupling trims the solver toward (the cycle model is the truth). */
export interface FlowTargets {
  readonly timeS: number;
  /**
   * Shaft speeds as unsigned magnitudes, rad/s (from rpm). Body forces need the signed angular
   * velocity about +x: multiply by EngineDefinition.rotation[spool] (W0C-N3), as blade design
   * and StationReduction torques ("sign about +x") do.
   */
  readonly n1RadPerS: number;
  readonly n2RadPerS: number;
  readonly fuelFlowKgPerS: number;
  readonly vsvClosureRad: number;
  readonly ambient: AmbientConditions;
  readonly stations: Readonly<Record<SolverReductionStationId, StationTarget>>;
}

export interface StepBudget {
  /** GPU time the solver may use this frame, ms (the plan's budget is about 7 ms). */
  readonly gpuTimeBudgetMs: number;
  readonly maxIterations: number;
}

export interface FlowStepStats {
  readonly iterationsThisStep: number;
  readonly totalIterations: number;
  /**
   * Latest resolved timestamp-query GPU time of a whole solver frame (the iterations and the
   * render resample), ms; null until one resolves or if unsupported.
   */
  readonly gpuTimeMs: number | null;
  /** L2 norm of the density residual from the latest readback; null before the first one. */
  readonly residualDensityL2: number | null;
  /** Simulated physical time in physical mode, s (0 in tracking mode). */
  readonly physicalTimeS: number;
}

/** One station plane, averaged over the solver field. */
export interface ReducedStation {
  readonly massFlowKgPerS: number;
  readonly ptMassAvgPa: number;
  readonly ttMassAvgK: number;
  readonly psAreaAvgPa: number;
  /** Mass-averaged absolute swirl angle atan(u_theta / u_x), rad (geometric sign). */
  readonly swirlAngleMassAvgRad: number;
  readonly areaM2: number;
}

/** Async station reduction (every ~10 iterations): what the coupling compares with FlowTargets. */
export interface StationReduction {
  readonly iteration: number;
  readonly stations: Readonly<Record<SolverReductionStationId, ReducedStation>>;
  /** Momentum plus pressure thrust integrated over both nozzle exits, N. */
  readonly grossThrustN: number;
  /** Shaft torques from the body forces, N m (sign about +x). */
  readonly lpTorqueNm: number;
  readonly hpTorqueNm: number;
}

export interface FlowSolver {
  readonly mode: SolverMode;
  init(params: FlowSolverInit): Promise<void>;
  setTargets(targets: FlowTargets): void;
  setMode(mode: SolverMode): void;
  /** Runs as many iterations as fit the budget; returns at once (GPU work is queued). */
  step(budget: StepBudget): FlowStepStats;
  /** The newest completed station reduction, or null before the first one. */
  latestReduction(): StationReduction | null;
  /** The render textures; the same GPUTexture objects for the solver's lifetime. */
  fields(): FlowField;
  /**
   * The solver's FlowStatus for the snapshot (W1F-I1; W2S-A-I10): initialising, running, lost (a
   * lost device or an uncaptured GPU error) or diverged. The app routes its device's error sink
   * (src/gpu/device.ts onError) to reportGpuError.
   */
  status(): FlowStatus;
  /** An uncaptured GPU error reported by the device's error sink: the solver stops (lost). */
  reportGpuError(message: string): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------
// Render textures

export const FIELD_TEXTURE_FORMAT = 'rgba16float' as const satisfies GPUTextureFormat;

/**
 * State texture channels (R, G, B, A), and why each is encoded this way for f16:
 * - pGaugeRatio = (p - p_inf) / p_inf. f16 has 11 significant bits, so p / p_inf near 1
 *   would quantise at ~1e-3 (about 100 Pa); the gauge ratio is exactly 0 in the ambient and
 *   keeps 11 bits of the perturbation itself, which acoustics and schlieren need. The
 *   largest value (P3/p_inf - 1, about 28) is far below the f16 maximum.
 * - rhoGaugeRatio = (rho - rho_inf) / rho_inf, for the same reason: the Gladstone-Dale
 *   schlieren and heat haze use the density gradient, which is tiny in the far field.
 * - temperatureK: absolute static temperature, for blackbody emissive and colour maps; the
 *   f16 step is 0.25 K at 300 K and 1 K up to 2048 K, below anything visible.
 * - fuelAirRatio: 0 outside the core jet; 0..0.068 keeps ~1e-5 absolute resolution.
 */
export const STATE_CHANNELS = [
  'pGaugeRatio',
  'rhoGaugeRatio',
  'temperatureK',
  'fuelAirRatio',
] as const;

/**
 * Velocity texture channels (R, G, B, A):
 * - uxMPerS, urMPerS, uthetaMPerS: velocity components in m/s (u_theta along +theta);
 *   at most ~600 m/s, where the f16 step is 0.5 m/s, fine for particles.
 * - fluidFraction: 1 in fluid, 0 in solid (blades are body forces, so solids are the
 *   nacelle, casings, spinner and plug); fractional at resampled walls. Values in solid
 *   texels are finite but unspecified: weight by fluidFraction when filtering.
 */
export const VELOCITY_CHANNELS = ['uxMPerS', 'urMPerS', 'uthetaMPerS', 'fluidFraction'] as const;

export type FieldExtentId = 'near' | 'far';

/**
 * A uniform (x, r) raster. Texel (i, j) covers x in [xMin + i dx, xMin + (i + 1) dx) and
 * r in [rMin + j dr, ...): row j = 0 is next to the axis, and texture coordinate
 * v = (r - rMin) / (rMax - rMin). Data index of channel k is 4 (j width + i) + k.
 */
export interface FieldExtent {
  readonly id: FieldExtentId;
  readonly width: number;
  readonly height: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly rMin: number;
  readonly rMax: number;
}

/**
 * near: the engine and the start of the jets, 7 m x 1.75 m at 6.8 mm texels.
 * far: 8 m (>5 fan diameters) upstream to 32 m (~20 D) downstream and 8.44 m radially, in
 * 78 mm square texels, for the plume and the intake streamtube. Both lie inside the minimum
 * solver domain of the reference engine (x -8.52..33.74 m, r_out 8.81 m; the W0 placeholder
 * mesh: -8.46..34.01 m, 8.75 m), so every texel holds solver data (W0M-I5; it used to reach
 * r = 10 m). 108 rows keep the texels square at the 512-column x spacing.
 */
export const FIELD_EXTENTS: Readonly<Record<FieldExtentId, FieldExtent>> = {
  near: { id: 'near', width: 1024, height: 256, xMin: -2, xMax: 5, rMin: 0, rMax: 1.75 },
  far: { id: 'far', width: 512, height: 108, xMin: -8, xMax: 32, rMin: 0, rMax: 8.4375 },
};

/** The ambient state the gauge channels are relative to. */
export interface FieldReference {
  readonly pInfPa: number;
  readonly rhoInfKgPerM3: number;
  readonly tInfK: number;
}

export function fieldReferenceFromAmbient(ambient: AmbientConditions): FieldReference {
  return {
    pInfPa: ambient.pressurePa,
    rhoInfKgPerM3: ambient.pressurePa / (R_AIR * ambient.temperatureK),
    tInfK: ambient.temperatureK,
  };
}

/** Physical values at one point (decoded). */
export interface FieldSample {
  readonly pPa: number;
  readonly rhoKgPerM3: number;
  readonly tK: number;
  readonly fuelAirRatio: number;
  readonly uxMPerS: number;
  readonly urMPerS: number;
  readonly uthetaMPerS: number;
  readonly fluidFraction: number;
}

export type Texel = readonly [number, number, number, number];

export function encodeTexel(
  sample: FieldSample,
  ref: FieldReference,
): { state: Texel; velocity: Texel } {
  return {
    state: [
      (sample.pPa - ref.pInfPa) / ref.pInfPa,
      (sample.rhoKgPerM3 - ref.rhoInfKgPerM3) / ref.rhoInfKgPerM3,
      sample.tK,
      sample.fuelAirRatio,
    ],
    velocity: [sample.uxMPerS, sample.urMPerS, sample.uthetaMPerS, sample.fluidFraction],
  };
}

export function decodeTexel(state: Texel, velocity: Texel, ref: FieldReference): FieldSample {
  return {
    pPa: ref.pInfPa * (1 + state[0]),
    rhoKgPerM3: ref.rhoInfKgPerM3 * (1 + state[1]),
    tK: state[2],
    fuelAirRatio: state[3],
    uxMPerS: velocity[0],
    urMPerS: velocity[1],
    uthetaMPerS: velocity[2],
    fluidFraction: velocity[3],
  };
}

export function texelCenter(extent: FieldExtent, i: number, j: number): { x: number; r: number } {
  const dx = (extent.xMax - extent.xMin) / extent.width;
  const dr = (extent.rMax - extent.rMin) / extent.height;
  return { x: extent.xMin + (i + 0.5) * dx, r: extent.rMin + (j + 0.5) * dr };
}

/** The texel containing (x, r), or null outside the extent. */
export function texelIndexAt(
  extent: FieldExtent,
  x: number,
  r: number,
): { i: number; j: number } | null {
  if (x < extent.xMin || x > extent.xMax || r < extent.rMin || r > extent.rMax) return null;
  const i = Math.min(
    extent.width - 1,
    Math.floor(((x - extent.xMin) / (extent.xMax - extent.xMin)) * extent.width),
  );
  const j = Math.min(
    extent.height - 1,
    Math.floor(((r - extent.rMin) / (extent.rMax - extent.rMin)) * extent.height),
  );
  return { i, j };
}

/**
 * Where field data comes from: the W2 solver, or the labelled stand-in in src/mocks. It travels
 * with the data (CpuFlowField -> FlowField -> SimSnapshot.sources.flow) so that a MOCK raster
 * uploaded to the GPU keeps its label (W0C-I3).
 */
export type FlowFieldSource = 'mock' | 'solver';
export const FLOW_FIELD_SOURCES = ['mock', 'solver'] as const satisfies readonly FlowFieldSource[];

/**
 * D4-82 (critic pass 12; a minimal, flagged contract addition): how far a field is the engine's
 * answer. mock: the labelled stand-in (src/mocks). uncoupled: the solver, run without the
 * coupling's body forces and combustor sources (W2: from a start state, so not this engine's
 * flow; the badge and the legend say "solver (uncoupled until W3)"). coupled: the solver driven
 * toward the cycle model by W3's coupling. It travels with the data, as `source` does.
 * calibrating (W3, PHYSICS.md 3.3 CP5): the solver with the coupling's forces and sources on, its
 * trim still outside L12's tolerances at the current point; it reads "coupled" only while they hold.
 */
export type FlowCoupling = 'mock' | 'uncoupled' | 'calibrating' | 'coupled';
export const FLOW_COUPLINGS = [
  'mock',
  'uncoupled',
  'calibrating',
  'coupled',
] as const satisfies readonly FlowCoupling[];

/** Problems if the coupling contradicts the source (empty when they agree). */
export function flowCouplingProblems(f: {
  readonly source: FlowFieldSource;
  readonly coupling: FlowCoupling;
}): string[] {
  const mock = f.source === 'mock';
  if (mock === (f.coupling === 'mock')) return [];
  return [
    mock
      ? `a MOCK field cannot be '${f.coupling}' (only the solver is uncoupled, calibrating or coupled)`
      : "a solver field cannot be 'mock' (it is 'uncoupled', 'calibrating' or 'coupled')",
  ];
}

/** CPU copy of one extent's two textures: raw f16 bits, exactly what writeTexture uploads. */
export interface CpuFieldTextures {
  readonly extent: FieldExtent;
  readonly state: Uint16Array;
  readonly velocity: Uint16Array;
}

export interface CpuFlowField {
  readonly source: FlowFieldSource;
  /** D4-82. */
  readonly coupling: FlowCoupling;
  readonly reference: FieldReference;
  readonly near: CpuFieldTextures;
  readonly far: CpuFieldTextures;
}

/** GPU-side field: the textures three.js samples, with their metadata. */
export interface FieldTexturePair {
  readonly state: GPUTexture;
  readonly velocity: GPUTexture;
}

export interface FlowField {
  readonly source: FlowFieldSource;
  /** D4-82: the solver's field is 'uncoupled' until W3's coupling drives it. */
  readonly coupling: FlowCoupling;
  readonly reference: FieldReference;
  readonly extents: Readonly<Record<FieldExtentId, FieldExtent>>;
  readonly near: FieldTexturePair;
  readonly far: FieldTexturePair;
  /** Incremented every time the solver rewrites the textures. */
  readonly version: number;
}

const finiteTexel = (t: Texel): boolean => t.every((v) => Number.isFinite(v));

/**
 * Evaluates `sample` at every texel centre and encodes the result. Iterates column by column
 * (x outer), so a sampler can cache per-x work.
 */
export function rasterizeField(
  extent: FieldExtent,
  ref: FieldReference,
  sample: (x: number, r: number) => FieldSample,
): CpuFieldTextures {
  const n = 4 * extent.width * extent.height;
  const state = new Uint16Array(n);
  const velocity = new Uint16Array(n);
  for (let i = 0; i < extent.width; i++) {
    for (let j = 0; j < extent.height; j++) {
      const c = texelCenter(extent, i, j);
      const enc = encodeTexel(sample(c.x, c.r), ref);
      if (!finiteTexel(enc.state) || !finiteTexel(enc.velocity)) {
        throw new Error(
          `rasterizeField: non-finite value at x=${c.x.toFixed(4)}, r=${c.r.toFixed(4)}`,
        );
      }
      const k = 4 * (j * extent.width + i);
      for (let ch = 0; ch < 4; ch++) {
        for (const [name, texel, out] of [
          ['state', enc.state, state],
          ['velocity', enc.velocity, velocity],
        ] as const) {
          const v = texel[ch] ?? 0;
          // toHalfBits would silently write infinity (W0C-N2)
          if (Math.abs(v) > HALF_MAX) {
            throw new Error(
              `rasterizeField: ${name}[${ch}] ${v} at x=${c.x.toFixed(4)}, r=${c.r.toFixed(4)} is beyond the f16 range (|v| <= ${HALF_MAX})`,
            );
          }
          out[k + ch] = toHalfBits(v);
        }
      }
    }
  }
  return { extent, state, velocity };
}

function readTexel(
  data: Uint16Array,
  width: number,
  i: number,
  j: number,
): [number, number, number, number] {
  const k = 4 * (j * width + i);
  return [
    fromHalfBits(data[k] ?? 0),
    fromHalfBits(data[k + 1] ?? 0),
    fromHalfBits(data[k + 2] ?? 0),
    fromHalfBits(data[k + 3] ?? 0),
  ];
}

/**
 * Bilinear sample of a CPU field at (x, r), decoded to physical values; null outside the
 * extent. Like a clamp-to-edge sampler at the outer edges; across the axis (rMin = 0) it
 * mirrors, with scalars even and u_r, u_theta odd, so they vanish on the axis.
 */
export function sampleCpuField(
  field: CpuFieldTextures,
  ref: FieldReference,
  x: number,
  r: number,
): FieldSample | null {
  const e = field.extent;
  if (x < e.xMin || x > e.xMax || r < e.rMin || r > e.rMax) return null;
  // continuous texel coordinates, texel centres at integers
  const fx = ((x - e.xMin) / (e.xMax - e.xMin)) * e.width - 0.5;
  const fr = ((r - e.rMin) / (e.rMax - e.rMin)) * e.height - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fr);
  const tx = fx - i0;
  const tr = fr - j0;
  const clampI = (i: number) => Math.min(e.width - 1, Math.max(0, i));
  const mirrorAxis = e.rMin === 0;
  // the 8 decoded channels of texel (i, j); clamp-to-edge, except the ghost row below the axis
  const fetch = (i: number, j: number): number[] => {
    let row = j;
    let odd = 1;
    if (row < 0 && mirrorAxis) {
      row = -1 - row; // ghost row -1 mirrors row 0 about r = 0
      odd = -1;
    }
    row = Math.min(e.height - 1, Math.max(0, row));
    const s = readTexel(field.state, e.width, clampI(i), row);
    const v = readTexel(field.velocity, e.width, clampI(i), row);
    return [s[0], s[1], s[2], s[3], v[0], odd * v[1], odd * v[2], v[3]];
  };
  const lerp = (a: readonly number[], b: readonly number[], t: number): number[] =>
    a.map((av, k) => av + t * ((b[k] ?? av) - av));
  const v = lerp(
    lerp(fetch(i0, j0), fetch(i0 + 1, j0), tx),
    lerp(fetch(i0, j0 + 1), fetch(i0 + 1, j0 + 1), tx),
    tr,
  );
  const g = (k: number) => v[k] ?? 0;
  return decodeTexel([g(0), g(1), g(2), g(3)], [g(4), g(5), g(6), g(7)], ref);
}

/** Maps the cycle state onto the solver's coupling targets. */
export function flowTargetsFromCycleState(
  state: CycleState,
  ambient: AmbientConditions,
): FlowTargets {
  const rpmToRadPerS = (rpm: number) => (rpm * 2 * Math.PI) / 60;
  const stations = Object.fromEntries(
    SOLVER_REDUCTION_STATIONS.map((id) => {
      const s = state.stations[id];
      return [id, { ptPa: s.ptPa, ttK: s.ttK, wKgPerS: s.wKgPerS, fuelAirRatio: s.fuelAirRatio }];
    }),
  ) as Record<SolverReductionStationId, StationTarget>;
  return {
    timeS: state.timeS,
    n1RadPerS: rpmToRadPerS(state.n1Rpm),
    n2RadPerS: rpmToRadPerS(state.n2Rpm),
    fuelFlowKgPerS: state.fuelFlowKgPerS,
    vsvClosureRad: state.vsvClosureRad,
    ambient,
    stations,
  };
}
