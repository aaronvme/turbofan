// The solver's FlowStatus for the snapshot (contracts sim.ts) and the snapshot's flow provenance.
// W1F-I1 (D2-6): a lost device with an empty message still publishes (the default message), and a
// non-finite GPU time alone is a timing glitch (null), not divergence; only a non-finite residual
// or counter is. W1F-N1: the snapshot's flow source is copied from the field the solver hands out,
// never declared by the caller.
import type { CycleModel } from '../../contracts/cycle';
import type { FlowField, FlowStepStats, SolverMode } from '../../contracts/flow';
import { FLOW_DEFAULT_ERRORS, type FlowStatus, type SnapshotSources } from '../../contracts/sim';

export interface SolverHealth {
  /** False until init() has uploaded everything and compiled every pipeline. */
  readonly initialised: boolean;
  /** init() failed (WGSL, limits, mesh): the reason. */
  readonly initError: string | null;
  /** The device was lost (message may be empty) or raised an uncaptured error. */
  readonly lost: { readonly message: string } | null;
  readonly mode: SolverMode;
  readonly stats: FlowStepStats | null;
}

/** FlowStatus of the GPU solver; never throws, whatever the inputs. */
export function solverFlowStatus(h: SolverHealth): FlowStatus {
  const stats =
    h.stats === null
      ? null
      : {
          ...h.stats,
          gpuTimeMs:
            h.stats.gpuTimeMs !== null && Number.isFinite(h.stats.gpuTimeMs)
              ? h.stats.gpuTimeMs
              : null,
        };
  const base = { mode: h.mode, stats, reduction: null };
  if (h.lost !== null) {
    const message = h.lost.message.trim();
    return {
      ...base,
      status: 'lost',
      error: message.length > 0 ? message : FLOW_DEFAULT_ERRORS.lost,
    };
  }
  if (h.initError !== null) {
    return { ...base, status: 'unavailable', error: h.initError };
  }
  if (!h.initialised) return { ...base, status: 'initialising', error: null };
  const r = stats?.residualDensityL2;
  if (r !== undefined && r !== null && !Number.isFinite(r)) {
    return {
      ...base,
      status: 'diverged',
      error: `the density residual is ${r} after ${stats?.totalIterations ?? 0} iterations`,
    };
  }
  return { ...base, status: 'running', error: null };
}

/** The snapshot's provenance, copied from the cycle model and the field shown (W1F-N1). */
export function snapshotSources(
  cycle: Pick<CycleModel, 'source'>,
  field: Pick<FlowField, 'source'> | null,
): SnapshotSources {
  return { cycle: cycle.source, flow: field === null ? 'none' : field.source };
}
