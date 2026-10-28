// The f64 reference solver: the oracle for the WGSL kernel (docs/SOLVER.md). Readable rather than
// fast, but allocation-free per iteration. One stage: conserved -> primitives (cells, then ghosts
// with their BCs), MUSCL + SLAU2 face fluxes accumulated per cell, the pressure/swirl source, the
// volume sources, then the RK update (tracking: 3-stage, local dt; physical: SSP-RK3, global dt).
import {
  BC_CODE,
  boundaryParams,
  ghostPrimitive,
  wallGhost,
  type BoundaryParams,
} from './boundary';
import { referenceState, type GasModel, type ReferenceState } from './gas';
import { limitedSlopes } from './muscl';
import { lowMachBeta2, preconditionIncrement, spectralRadius } from './precondition';
import { slau2Flux } from './slau2';
import { extIndex, type SolverMesh } from './solverMesh';
import type { SourceModel, SourceRates } from './sources';
import { NP, NU, consToPrim, primToCons, physicalToPrim, type PhysicalState } from './state';

/** Tracking-mode stage coefficients (section 10: alpha_2 = 1/2 is needed for stability). */
export const RK3_ALPHA = [0.2, 0.5, 1.0] as const;
export const DEFAULT_CFL = 1.5;
/**
 * The tracking CFL with low-Mach preconditioning (minMach < 1), decision D4-32: 0.82 x the fully
 * discrete limit 0.972 of the 3-stage scheme on the pseudo-acoustic pair at rest, whose worst cell
 * shape is the 1D one (section 10; tests/unit/flow/acoustic.ts, pinned in rk.test.ts).
 */
export const DEFAULT_CFL_PRECONDITIONED = 0.8;
export const DEFAULT_CFL_PHYSICAL = 0.9;

export interface SolverOptions {
  readonly gas: GasModel;
  /** The ambient the gauges are measured from, with its axial velocity (the free stream). */
  readonly freeStream: {
    readonly pressure: number;
    readonly temperature: number;
    readonly velocity: number;
  };
  readonly cfl?: number;
  readonly cflPhysical?: number;
  readonly inflowTotal?: { readonly p0: number; readonly t0: number };
  readonly outflowPressure?: number;
  /** BC code -> BC code applied to physical ghosts (tests only, e.g. ladder L1). */
  readonly bcRemap?: Readonly<Partial<Record<number, number>>>;
  readonly sources?: SourceModel;
  /**
   * Low-Mach preconditioning of the tracking mode's pseudo-time derivative (section 10, D4-10):
   * beta^2 = min(1, max(M^2, minMach^2, dp / (rho c^2))), with SLAU2's pressure diffusion scaled by
   * 1 / f_a(max(beta_f, machCut)), beta_f the face's mean beta (section 7, D4-20 and D4-44;
   * machCut defaults to minMach, >= 1 turns it off). Physical time ignores both.
   * machCut >= 1 with minMach < 1 is a test configuration only: its acoustic limit at small beta
   * (0.475 at beta 0.06, 0.176 at 0.003; section 10) is below the default CFL 0.8.
   */
  readonly lowMachPreconditioning?: {
    readonly minMach: number;
    readonly machCut?: number;
  };
  /**
   * The limiter (section 6): 'sharp' van Albada (default) or the 'smooth' eps form, the D4-25
   * trial that is not yet the contract (round 4: below eps the reconstruction is central, and the
   * low-Mach acoustic pair then lacks the damping the sharp switch's clipping gave).
   */
  readonly limiter?: 'sharp' | 'smooth';
  /** 'f32': round the state to f32 after every stage (the f32-storage tolerance experiment). */
  readonly storage?: 'f64' | 'f32';
}

export interface IterationStats {
  /** sqrt(mean (R_rho / (b V))^2) of the last iteration's first stage, kg/(m^3 s). */
  readonly residualDensityL2: number;
}

export class ReferenceSolver {
  readonly mesh: SolverMesh;
  readonly ref: ReferenceState;
  readonly bc: BoundaryParams;
  /** The BC parameters of the physical-time mode (never preconditioned). */
  private readonly bcPhysical: BoundaryParams;
  /** Conserved gauge state, 6 per cell. */
  readonly U: Float64Array;
  /** Blockage per cell (set with setBlockage). */
  readonly blockage: Float64Array;
  iterations = 0;
  time = 0;
  stats: IterationStats = { residualDensityL2: 0 };

  private readonly opts: SolverOptions;
  private readonly cfl: number;
  private readonly cflPhysical: number;
  /** M_cut of the tracking mode's dissipation scaling (1: off); physical time always uses 1. */
  private readonly machCut: number;
  /** The M_cut of the residual being assembled. */
  private fluxMachCut = 1;
  private readonly remap: Uint8Array;
  /** 1 for the ghosts that are slip walls (after the remap), per extended index. */
  private readonly wall: Uint8Array;
  private readonly P: Float64Array;
  private readonly U0: Float64Array;
  private readonly R: Float64Array;
  private readonly bExt: Float64Array;
  /** Radius per extended index (a ghost: its source cell's), for the limiter's rw scale. */
  private readonly rExt: Float64Array;
  private readonly bSx: Float64Array;
  private readonly bSr: Float64Array;
  private readonly tau: Float64Array;
  private readonly dt: Float64Array;
  /** Per cell beta^2 of the preconditioner, frozen at stage 1 like tau (1 without it). */
  private readonly beta2: Float64Array;
  /** beta per extended index (a ghost: its source cell's), for the face's M_ref (D4-44). */
  private readonly betaExt: Float64Array;
  private readonly dU = new Float64Array(NU);
  private readonly src: SourceRates;
  /** Per cell: i-face west, i-face east, j-face south, j-face north; ext index of each neighbour. */
  private readonly cellFace: Int32Array;
  private readonly cellNbr: Int32Array;
  private readonly line: Int32Array;
  /** Per block, the extended indices of every i-line (positions -2..ni+1) and j-line. */
  private readonly lines: { readonly i: Int32Array; readonly j: Int32Array }[];
  private readonly slope: Float64Array;
  private readonly qL = new Float64Array(NP);
  private readonly qR = new Float64Array(NP);
  private readonly F = new Float64Array(NU);

  constructor(mesh: SolverMesh, opts: SolverOptions) {
    this.mesh = mesh;
    this.opts = opts;
    this.ref = referenceState(opts.gas, opts.freeStream);
    const bcOpts = {
      ...(opts.inflowTotal === undefined ? {} : { inflowTotal: opts.inflowTotal }),
      ...(opts.outflowPressure === undefined ? {} : { outflowPressure: opts.outflowPressure }),
    };
    this.bcPhysical = boundaryParams(this.ref, bcOpts);
    const pre = opts.lowMachPreconditioning;
    const mInf2 = (this.ref.u * this.ref.u) / (this.ref.c * this.ref.c);
    this.bc =
      pre === undefined
        ? this.bcPhysical
        : boundaryParams(this.ref, {
            ...bcOpts,
            farFieldBeta2: Math.min(1, Math.max(mInf2, pre.minMach * pre.minMach)),
          });
    this.machCut = pre === undefined ? 1 : (pre.machCut ?? pre.minMach);
    // minMach >= 1 is the plain scheme (beta = 1, f_a = 1) and keeps the plain default
    this.cfl =
      opts.cfl ?? (pre !== undefined && pre.minMach < 1 ? DEFAULT_CFL_PRECONDITIONED : DEFAULT_CFL);
    this.cflPhysical = opts.cflPhysical ?? DEFAULT_CFL_PHYSICAL;
    this.remap = new Uint8Array(256).map((_, k) => opts.bcRemap?.[k] ?? k);
    this.wall = new Uint8Array(mesh.nCells + mesh.nGhosts);
    for (let g = 0; g < mesh.nGhosts; g++) {
      const code = mesh.ghostBc[g] ?? 0;
      if (code !== 0 && this.remap[code] === BC_CODE.SLIP_WALL) this.wall[mesh.nCells + g] = 1;
    }
    const n = mesh.nCells;
    const nx = n + mesh.nGhosts;
    this.U = new Float64Array(NU * n);
    this.U0 = new Float64Array(NU * n);
    this.R = new Float64Array(NU * n);
    this.P = new Float64Array(NP * nx);
    this.blockage = new Float64Array(n).fill(1);
    this.bExt = new Float64Array(nx);
    this.rExt = new Float64Array(nx);
    for (let c = 0; c < n; c++) this.rExt[c] = mesh.cellR[c] as number;
    for (let g = 0; g < mesh.nGhosts; g++)
      this.rExt[n + g] = mesh.cellR[mesh.ghostSrc[g] ?? 0] as number;
    this.bSx = new Float64Array(n);
    this.bSr = new Float64Array(n);
    this.tau = new Float64Array(n);
    this.dt = new Float64Array(n);
    this.beta2 = new Float64Array(n).fill(1);
    this.betaExt = new Float64Array(nx).fill(1);
    this.src = { rate: new Float64Array(NU * n), damping: new Float64Array(NU * n) };
    this.cellFace = new Int32Array(4 * n);
    this.cellNbr = new Int32Array(4 * n);
    let maxLine = 0;
    mesh.blocks.forEach((b, bi) => {
      maxLine = Math.max(maxLine, b.ni + 4, b.nj + 4);
      for (let j = 0; j < b.nj; j++) {
        for (let i = 0; i < b.ni; i++) {
          const c = b.cellOffset + j * b.ni + i;
          const w = b.iFaceOffset + j * (b.ni + 1) + i;
          const s = b.jFaceOffset + j * b.ni + i;
          this.cellFace.set([w, w + 1, s, s + b.ni], 4 * c);
          this.cellNbr.set(
            [
              extIndex(mesh, bi, i - 1, j),
              extIndex(mesh, bi, i + 1, j),
              extIndex(mesh, bi, i, j - 1),
              extIndex(mesh, bi, i, j + 1),
            ],
            4 * c,
          );
        }
      }
    });
    this.line = new Int32Array(maxLine);
    this.lines = mesh.blocks.map((b, bi) => {
      const li = new Int32Array((b.ni + 4) * b.nj);
      const lj = new Int32Array((b.nj + 4) * b.ni);
      for (let j = 0; j < b.nj; j++)
        for (let p = 0; p < b.ni + 4; p++) li[j * (b.ni + 4) + p] = extIndex(mesh, bi, p - 2, j);
      for (let i = 0; i < b.ni; i++)
        for (let p = 0; p < b.nj + 4; p++) lj[i * (b.nj + 4) + p] = extIndex(mesh, bi, i, p - 2);
      return { i: li, j: lj };
    });
    this.slope = new Float64Array(NU * maxLine);
    this.setBlockage(this.blockage);
  }

  /** The tracking mode's CFL: the option, or the default of section 10 for the scheme in use. */
  get trackingCfl(): number {
    return this.cfl;
  }

  /** Sets the blockage field (per cell, in (0, 1]) and the b-weighted face-vector sums. */
  setBlockage(b: ArrayLike<number>): void {
    const m = this.mesh;
    const n = m.nCells;
    // W2R-N1: b = 0 would make tau = CFL / lambda / (b V) infinite and surface only as a later NaN
    if (b.length < n) throw new Error(`blockage: ${b.length} values for ${n} cells`);
    for (let c = 0; c < n; c++) {
      const v = b[c] as number;
      if (!(v > 0 && v <= 1)) throw new Error(`blockage of cell ${c} is ${v}, not in (0, 1]`);
    }
    for (let c = 0; c < n; c++) this.blockage[c] = b[c] as number;
    for (let c = 0; c < n; c++) this.bExt[c] = this.blockage[c] as number;
    for (let g = 0; g < m.nGhosts; g++)
      this.bExt[n + g] = this.blockage[m.ghostSrc[g] ?? 0] as number;
    for (let c = 0; c < n; c++) {
      const bc = this.blockage[c] as number;
      let sx = 0;
      let sr = 0;
      for (let k = 0; k < 4; k++) {
        const f = this.cellFace[4 * c + k] ?? 0;
        const bf = 0.5 * (bc + (this.bExt[this.cellNbr[4 * c + k] ?? 0] as number));
        const iDir = k < 2;
        const sign = k % 2 === 0 ? -1 : 1;
        const area = (iDir ? m.iArea[f] : m.jArea[f]) as number;
        sx += sign * bf * area * ((iDir ? m.iNx[f] : m.jNx[f]) as number);
        sr += sign * bf * area * ((iDir ? m.iNr[f] : m.jNr[f]) as number);
      }
      this.bSx[c] = sx;
      this.bSr[c] = sr;
    }
  }

  /** Sets every cell from a physical state at its centroid. */
  setState(at: (x: number, r: number, cell: number) => PhysicalState): void {
    const m = this.mesh;
    for (let c = 0; c < m.nCells; c++) {
      const rc = m.cellR[c] as number;
      const q = physicalToPrim(this.ref, at(m.cellX[c] as number, rc, c), rc);
      primToCons(this.ref, q, 0, rc, this.U, NU * c);
    }
    this.roundStorage();
  }

  setUniform(s: PhysicalState): void {
    this.setState(() => s);
  }

  /** The primitive records of every cell then every ghost for the current state. */
  primitives(): Float64Array {
    this.updatePrimitives();
    return this.P;
  }

  /** The residual R (section 9) of the current state; a copy. */
  residual(): Float64Array {
    this.updatePrimitives();
    this.computeBeta(true);
    this.evaluateSources();
    this.assembleResidual(this.machCut);
    return Float64Array.from(this.R);
  }

  /**
   * The flux scale of the tracking density residual at the current state (decision D4-48),
   * sqrt(mean_c (sum_f |b_f F_f,rho| / (b_c V_c))^2): the residual's L2 with every face's mass flux
   * counted positive. SOLVER.md 12.2's residual check on rows B and E divides by it, because there
   * the residual is a small difference of large fluxes.
   */
  residualFluxScale(): number {
    this.updatePrimitives();
    this.computeBeta(true);
    this.evaluateSources();
    const m = this.mesh;
    const abs = new Float64Array(m.nCells);
    this.assembleResidual(this.machCut, abs);
    let sum = 0;
    for (let c = 0; c < m.nCells; c++) {
      const q = (abs[c] as number) / ((this.blockage[c] as number) * (m.cellVolR[c] as number));
      sum += q * q;
    }
    return Math.sqrt(sum / m.nCells);
  }

  /** Local time step dt_c of the last tracking iteration (or of the current state if none). */
  localDt(): Float64Array {
    if (this.iterations === 0) {
      this.updatePrimitives();
      this.computeLocalDt(true);
    }
    return Float64Array.from(this.dt);
  }

  /** The physical-time step CFL_phys min_c (b V / lambda) of the current state. */
  globalDt(): number {
    this.updatePrimitives(true);
    this.computeLocalDt(false);
    let dt = Infinity;
    for (let c = 0; c < this.mesh.nCells; c++) {
      const bv = (this.blockage[c] as number) * (this.mesh.cellVolR[c] as number);
      dt = Math.min(dt, ((this.tau[c] as number) / this.cfl) * this.cflPhysical * bv);
    }
    return dt;
  }

  /** Tracking mode: n iterations of the 3-stage RK with local time steps. */
  iterate(n = 1): IterationStats {
    const N = this.mesh.nCells;
    for (let it = 0; it < n; it++) {
      this.U0.set(this.U);
      for (let k = 0; k < 3; k++) {
        this.updatePrimitives();
        if (k === 0) this.computeLocalDt(true);
        this.evaluateSources();
        this.assembleResidual(this.machCut);
        if (k === 0) this.recordResidual();
        const a = RK3_ALPHA[k] as number;
        const { U, U0, R, tau, dt, dU, beta2, P } = this;
        const d = this.src.damping;
        for (let c = 0; c < N; c++) {
          const at = a * (tau[c] as number);
          const adt = a * (dt[c] as number);
          const o = NU * c;
          for (let m = 0; m < NU; m++) {
            dU[m] = -(at * (R[o + m] as number)) / (1 + adt * (d[o + m] as number));
          }
          const b2 = beta2[c] as number;
          if (b2 < 1)
            preconditionIncrement(this.ref, P, NP * c, this.mesh.cellR[c] as number, b2, dU, 0);
          for (let m = 0; m < NU; m++) U[o + m] = (U0[o + m] as number) + (dU[m] as number);
        }
        this.roundStorage();
      }
      this.iterations++;
    }
    return this.stats;
  }

  /** Physical-time mode: one SSP-RK3 step of dt (default: the CFL_phys global step). */
  stepPhysical(dtGiven?: number): number {
    const dtStep = dtGiven ?? this.globalDt();
    const N = this.mesh.nCells;
    const { U, U0, R } = this;
    U0.set(U);
    const weights: readonly [number, number][] = [
      [0, 1],
      [3 / 4, 1 / 4],
      [1 / 3, 2 / 3],
    ];
    // each stage's time (W2R-N3): Shu-Osher's stages sit at t, t + dt and t + dt / 2
    const stageTime = [0, 1, 0.5];
    for (let k = 0; k < 3; k++) {
      this.updatePrimitives(true);
      this.evaluateSources(this.time + (stageTime[k] as number) * dtStep);
      this.assembleResidual(1);
      if (k === 0) this.recordResidual();
      const [w0, w1] = weights[k] ?? [NaN, NaN];
      const d = this.src.damping;
      for (let c = 0; c < N; c++) {
        const tau = dtStep / ((this.blockage[c] as number) * (this.mesh.cellVolR[c] as number));
        for (let m = NU * c; m < NU * c + NU; m++) {
          const e = (U[m] as number) - (tau * (R[m] as number)) / (1 + dtStep * (d[m] as number));
          U[m] = k === 0 ? e : w0 * (U0[m] as number) + w1 * e;
        }
      }
      this.roundStorage();
    }
    this.time += dtStep;
    this.iterations++;
    return dtStep;
  }

  /** Per-radian totals sum_c b V U_k. */
  totals(): Float64Array {
    return this.sumOver((u) => u);
  }

  /** Per-radian totals of |U_k| (a scale for conservation checks). */
  absTotals(): Float64Array {
    return this.sumOver(Math.abs);
  }

  /**
   * The flux (times b_f) through i-face (i, j) (dir 'i') or j-face (i, j) (dir 'j') of block b in
   * the direction of the stored face vector, for the current state.
   */
  faceFlux(b: number, dir: 'i' | 'j', i: number, j: number): Float64Array {
    this.updatePrimitives();
    const blk = this.mesh.blocks[b];
    if (blk === undefined) throw new Error(`no block ${b}`);
    const out = new Float64Array(NU);
    const L = dir === 'i' ? blk.ni + 4 : blk.nj + 4;
    const fixed = dir === 'i' ? j : i;
    const f = dir === 'i' ? i : j;
    this.computeBeta(true);
    this.loadLine(b, dir, fixed, L);
    this.fluxMachCut = this.machCut;
    this.faceFromLine(
      f,
      dir === 'i' ? blk.iFaceOffset + j * (blk.ni + 1) + i : blk.jFaceOffset + j * blk.ni + i,
      dir,
    );
    out.set(this.F);
    const bf =
      0.5 *
      ((this.bExt[this.line[f + 1] ?? 0] as number) + (this.bExt[this.line[f + 2] ?? 0] as number));
    for (let k = 0; k < NU; k++) out[k] = bf * (out[k] as number);
    return out;
  }

  private sumOver(fn: (u: number) => number): Float64Array {
    const t = new Float64Array(NU);
    for (let c = 0; c < this.mesh.nCells; c++) {
      const bv = (this.blockage[c] as number) * (this.mesh.cellVolR[c] as number);
      for (let k = 0; k < NU; k++) t[k] = (t[k] ?? 0) + bv * fn(this.U[NU * c + k] as number);
    }
    return t;
  }

  private roundStorage(): void {
    if (this.opts.storage !== 'f32') return;
    const U = this.U;
    for (let k = 0; k < U.length; k++) U[k] = Math.fround(U[k] as number);
  }

  /** Cell then ghost primitives; `physical` fills the ghosts with the physical-time BCs. */
  private updatePrimitives(physical = false): void {
    const m = this.mesh;
    const n = m.nCells;
    const { P, ref } = this;
    const bc = physical ? this.bcPhysical : this.bc;
    for (let c = 0; c < n; c++) consToPrim(ref, this.U, NU * c, m.cellR[c] as number, P, NP * c);
    for (let g = 0; g < m.nGhosts; g++) {
      const code = m.ghostBc[g] ?? 0;
      if (this.wall[n + g] === 1) {
        const layer = m.ghostLayer[g] === 1 ? 1 : 2;
        const partner = m.ghostPartner[g] ?? 0;
        const s0 = m.ghostSrc[layer === 1 ? g : partner] ?? 0;
        const s1 = m.ghostSrc[layer === 1 ? partner : g] ?? 0;
        wallGhost(
          P,
          NP * s0,
          NP * s1,
          m.ghostNx[g] as number,
          m.ghostNr[g] as number,
          layer,
          P,
          NP * (n + g),
        );
        continue;
      }
      ghostPrimitive(
        ref,
        bc,
        code === 0 ? 0 : (this.remap[code] ?? code),
        P,
        NP * (m.ghostSrc[g] ?? 0),
        m.ghostNx[g] as number,
        m.ghostNr[g] as number,
        P,
        NP * (n + g),
      );
    }
  }

  private evaluateSources(time = this.time): void {
    const model = this.opts.sources;
    this.src.rate.fill(0);
    this.src.damping.fill(0);
    if (model === undefined) return;
    model(
      {
        mesh: this.mesh,
        ref: this.ref,
        prim: this.P,
        U: this.U,
        blockage: this.blockage,
        time,
      },
      this.src,
    );
  }

  /**
   * beta^2 per cell of the current primitives (1 unless `tracking` and preconditioned) and beta per
   * extended index, a ghost taking its source cell's (section 7, D4-44).
   */
  private computeBeta(tracking: boolean): void {
    const m = this.mesh;
    const n = m.nCells;
    const { P, cellNbr, beta2, betaExt } = this;
    const pre = tracking ? this.opts.lowMachPreconditioning : undefined;
    for (let c = 0; c < n; c++) {
      let b2 = 1;
      if (pre !== undefined) {
        let dpMax = 0;
        const pc = P[NP * c + 4] as number;
        for (let k = 0; k < 4; k++)
          dpMax = Math.max(dpMax, Math.abs((P[NP * (cellNbr[4 * c + k] ?? 0) + 4] as number) - pc));
        const rho = this.ref.rho + (P[NP * c] as number);
        b2 = lowMachBeta2(P, NP * c, m.cellR[c] as number, pre.minMach, dpMax, rho);
      }
      beta2[c] = b2;
      betaExt[c] = Math.sqrt(b2);
    }
    for (let g = 0; g < m.nGhosts; g++) betaExt[n + g] = betaExt[m.ghostSrc[g] ?? 0] as number;
  }

  /** tau and dt per cell; `tracking` applies the low-Mach preconditioner's beta^2 if it is on. */
  private computeLocalDt(tracking: boolean): void {
    const m = this.mesh;
    const { P, tau, dt, cellFace, cellNbr, bExt, beta2 } = this;
    this.computeBeta(tracking);
    for (let c = 0; c < m.nCells; c++) {
      const u = P[NP * c + 1] as number;
      const v = P[NP * c + 2] as number;
      const a = P[NP * c + 7] as number;
      const bc = this.blockage[c] as number;
      const b2 = beta2[c] as number;
      let lam = 0;
      for (let d = 0; d < 2; d++) {
        let best = 0;
        for (let s = 0; s < 2; s++) {
          const k = 2 * d + s;
          const f = cellFace[4 * c + k] ?? 0;
          const nx = (d === 0 ? m.iNx[f] : m.jNx[f]) as number;
          const nr = (d === 0 ? m.iNr[f] : m.jNr[f]) as number;
          const area = (d === 0 ? m.iArea[f] : m.jArea[f]) as number;
          const bf = 0.5 * (bc + (bExt[cellNbr[4 * c + k] ?? 0] as number));
          best = Math.max(best, bf * area * spectralRadius(u * nx + v * nr, a, b2));
        }
        lam += best;
      }
      tau[c] = this.cfl / lam;
      dt[c] = (tau[c] as number) * bc * (m.cellVolR[c] as number);
    }
  }

  /** Extended indices of grid line `fixed` of block b in direction dir, positions -2..n+1. */
  private loadLine(b: number, dir: 'i' | 'j', fixed: number, L: number): void {
    const { line, slope, P, ref, rExt } = this;
    const pre = this.lines[b];
    if (pre === undefined) throw new Error(`no block ${b}`);
    line.set((dir === 'i' ? pre.i : pre.j).subarray(fixed * L, fixed * L + L));
    for (let p = 1; p < L - 1; p++) {
      limitedSlopes(
        ref,
        P,
        NP * (line[p - 1] ?? 0),
        NP * (line[p] ?? 0),
        NP * (line[p + 1] ?? 0),
        rExt[line[p] ?? 0] as number,
        slope,
        NU * p,
        this.opts.limiter === 'smooth',
      );
    }
  }

  /** The SLAU2 flux (before b_f) through face f of the loaded line (between positions f+1, f+2). */
  private faceFromLine(f: number, face: number, dir: 'i' | 'j'): number {
    const m = this.mesh;
    const area = (dir === 'i' ? m.iArea[face] : m.jArea[face]) as number;
    if (!(area > 0)) {
      this.F.fill(0);
      return 0;
    }
    const { P, slope, line, qL, qR } = this;
    const l = line[f + 1] ?? 0;
    const r = line[f + 2] ?? 0;
    for (let k = 0; k < NU; k++) {
      qL[k] = (P[NP * l + k] as number) + 0.5 * (slope[NU * (f + 1) + k] as number);
      qR[k] = (P[NP * r + k] as number) - 0.5 * (slope[NU * (f + 2) + k] as number);
    }
    const nx = (dir === 'i' ? m.iNx[face] : m.jNx[face]) as number;
    const nr = (dir === 'i' ? m.iNr[face] : m.jNr[face]) as number;
    const wallL = this.wall[l] === 1;
    if (wallL || this.wall[r] === 1) {
      // slip wall (section 7): only the wall pressure, the interior cell's face value
      const pw = (wallL ? qR[4] : qL[4]) as number;
      const F = this.F;
      F.fill(0);
      F[1] = area * pw * nx;
      F[2] = area * pw * nr;
      return area;
    }
    slau2Flux(
      this.ref,
      qL,
      0,
      qR,
      0,
      nx,
      nr,
      area,
      (dir === 'i' ? m.iRf[face] : m.jRf[face]) as number,
      this.F,
      this.fluxMachCut,
      0.5 * ((this.betaExt[l] as number) + (this.betaExt[r] as number)),
    );
    return area;
  }

  /**
   * The residual of section 9; machCut < 1 scales SLAU2's pressure diffusion (tracking, D4-20).
   * `absMass` (per cell) accumulates sum_f |b_f F_f,rho| as well (residualFluxScale).
   */
  private assembleResidual(machCut: number, absMass?: Float64Array): void {
    const m = this.mesh;
    const { R, F, line, bExt } = this;
    this.fluxMachCut = machCut;
    R.fill(0);
    m.blocks.forEach((b, bi) => {
      for (const dir of ['i', 'j'] as const) {
        const nAlong = dir === 'i' ? b.ni : b.nj;
        const nAcross = dir === 'i' ? b.nj : b.ni;
        const L = nAlong + 4;
        for (let fixed = 0; fixed < nAcross; fixed++) {
          this.loadLine(bi, dir, fixed, L);
          for (let f = 0; f <= nAlong; f++) {
            const face =
              dir === 'i'
                ? b.iFaceOffset + fixed * (b.ni + 1) + f
                : b.jFaceOffset + f * b.ni + fixed;
            if (this.faceFromLine(f, face, dir) === 0) continue;
            const l = line[f + 1] ?? 0;
            const r = line[f + 2] ?? 0;
            const bf = 0.5 * ((bExt[l] as number) + (bExt[r] as number));
            if (f >= 1)
              for (let k = 0; k < NU; k++)
                R[NU * l + k] = (R[NU * l + k] ?? 0) + bf * (F[k] as number);
            if (f < nAlong)
              for (let k = 0; k < NU; k++)
                R[NU * r + k] = (R[NU * r + k] ?? 0) - bf * (F[k] as number);
            if (absMass !== undefined) {
              const a = Math.abs(bf * (F[0] as number));
              if (f >= 1) absMass[l] = (absMass[l] as number) + a;
              if (f < nAlong) absMass[r] = (absMass[r] as number) + a;
            }
          }
        }
      }
    });
    // pressure and swirl source, then the volume sources (section 8)
    const { P, bSx, bSr } = this;
    const rate = this.src.rate;
    for (let c = 0; c < m.nCells; c++) {
      const pP = P[NP * c + 4] as number;
      const rho = this.ref.rho + (P[NP * c] as number);
      const w = (P[NP * c + 3] as number) / (m.cellR[c] as number);
      const bc = this.blockage[c] as number;
      R[NU * c + 1] = (R[NU * c + 1] as number) - pP * (bSx[c] as number);
      R[NU * c + 2] =
        (R[NU * c + 2] as number) -
        (pP * (bSr[c] as number) + bc * rho * w * w * (m.cellArea[c] as number));
      const bv = bc * (m.cellVolR[c] as number);
      for (let k = NU * c; k < NU * c + NU; k++) R[k] = (R[k] as number) - bv * (rate[k] as number);
    }
  }

  private recordResidual(): void {
    const m = this.mesh;
    let sum = 0;
    for (let c = 0; c < m.nCells; c++) {
      const q =
        (this.R[NU * c] as number) / ((this.blockage[c] as number) * (m.cellVolR[c] as number));
      sum += q * q;
    }
    this.stats = { residualDensityL2: Math.sqrt(sum / m.nCells) };
  }
}
