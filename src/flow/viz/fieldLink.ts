// Which field the flow visuals draw (w2/flowviz round 3; D4-82, W2V-I6): the live solver's
// textures, or the labelled MOCK raster, and the runtime MOCK fallback. A solver that cannot
// start (the mesh fetch, solver.init, the device's limits), is lost (its device, an uncaptured
// GPU error) or diverged (a non-finite readback: sanitizeFlowStatus) is replaced by the MOCK at
// once, so a NaN field never reaches the blend. The fallback is visible (the state carries the
// reason, which the badge shows) and never silent (it is warned). The look-dev panel uses this,
// and the app shell is to adopt the same contract (D4-82). Pure: the view and the solver come in
// through small interfaces, so the decisions are unit-tested with fakes.

import {
  flowCouplingProblems,
  type CpuFlowField,
  type FlowCoupling,
  type FlowField,
  type FlowStepStats,
  type StepBudget,
} from '../../contracts/flow';
import { sanitizeFlowStatus, type FlowRunStatus, type FlowStatus } from '../../contracts/sim';

/** Where the link binds the field (EngineView implements it). */
export interface FlowFieldSink {
  setFlowField(field: CpuFlowField): void;
  setFlowSolverField(field: FlowField): void;
}

/** What the link needs of a solver (GpuFlowSolver implements it). */
export interface LinkedSolver {
  fields(): FlowField;
  status(): FlowStatus;
  step(budget: StepBudget): FlowStepStats;
  dispose(): void;
}

export interface FlowLinkState {
  /** What was asked for: the MOCK, or the live solver. */
  readonly asked: 'mock' | 'solver';
  /** D4-82: the drawn field's coupling (the badge). */
  readonly coupling: FlowCoupling;
  /** Why the MOCK is drawn instead of the solver asked for; null while drawing what was asked. */
  readonly fallback: string | null;
}

export interface FlowFieldLink {
  state(): FlowLinkState;
  /** The live solver; null when none was asked for or after a fallback. */
  readonly solver: LinkedSolver | null;
  /**
   * Before a frame: checks the solver's health (falls back on a failure), rebinds if it handed
   * out new textures, and steps it within the budget (null: no step).
   */
  beforeFrame(budget: StepBudget | null): void;
  /** A new MOCK raster (the throttle): drawn at once while the MOCK is drawn, else kept. */
  setMock(field: CpuFlowField): void;
  dispose(): void;
}

/** The solver states that end the link: the MOCK takes over. */
const FAILED: readonly FlowRunStatus[] = ['unavailable', 'diverged', 'lost'];

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function createFlowFieldLink(o: {
  readonly sink: FlowFieldSink;
  /** The MOCK raster to draw (or to fall back to). */
  readonly mock: CpuFlowField;
  /** Starts the live solver (absent: the MOCK is asked for). */
  readonly solver?: () => Promise<LinkedSolver>;
  /** Where a fallback is reported (default console.warn). */
  readonly warn?: (message: string) => void;
}): Promise<FlowFieldLink> {
  const warn =
    o.warn ??
    ((m: string) => {
      console.warn(m);
    });
  let mock = o.mock;
  let solver: LinkedSolver | null = null;
  let bound: FlowField | null = null;
  let state: FlowLinkState = {
    asked: o.solver === undefined ? 'mock' : 'solver',
    coupling: 'mock',
    fallback: null,
  };

  const drop = () => {
    const s = solver;
    solver = null;
    bound = null;
    try {
      s?.dispose();
    } catch (e) {
      warn(`flow field: disposing the failed solver: ${message(e)}`);
    }
  };
  const fallBack = (reason: string) => {
    drop();
    o.sink.setFlowField(mock);
    state = { asked: state.asked, coupling: 'mock', fallback: reason };
    warn(`flow field: drawing the MOCK instead of the solver (${reason})`);
  };
  const bind = (field: FlowField) => {
    const problems = flowCouplingProblems(field);
    if (problems.length > 0) throw new Error(problems.join('; '));
    o.sink.setFlowSolverField(field);
    bound = field;
    state = { asked: 'solver', coupling: field.coupling, fallback: null };
  };
  /** The solver's failure, if it has one (non-finite numbers count as divergence). */
  const failure = (s: LinkedSolver): string | null => {
    const st = sanitizeFlowStatus(s.status());
    if (!FAILED.includes(st.status)) return null;
    return `solver ${st.status}${st.error === null ? '' : `: ${st.error}`}`;
  };

  if (o.solver === undefined) {
    o.sink.setFlowField(mock);
  } else {
    try {
      solver = await o.solver();
      const f = failure(solver);
      if (f !== null) throw new Error(f);
      bind(solver.fields());
    } catch (e) {
      fallBack(`solver unavailable: ${message(e)}`);
    }
  }

  return {
    state: () => state,
    get solver() {
      return solver;
    },
    beforeFrame(budget) {
      const s = solver;
      if (s === null) return;
      try {
        const f = failure(s);
        if (f !== null) {
          fallBack(f);
          return;
        }
        const field = s.fields();
        // the contract keeps the textures for the solver's lifetime (W2V-N19): a solver that
        // re-created them must not leave destroyed views bound
        if (
          bound === null ||
          field.near.state !== bound.near.state ||
          field.near.velocity !== bound.near.velocity
        )
          bind(field);
        if (budget !== null) s.step(budget);
      } catch (e) {
        fallBack(`solver failed: ${message(e)}`);
      }
    },
    setMock(field) {
      mock = field;
      if (state.coupling === 'mock') o.sink.setFlowField(field);
    },
    dispose() {
      drop();
    },
  };
}
