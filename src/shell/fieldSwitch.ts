// The app's drawn-field switch (D4-82 in the shell; W2V-I6): the viewer picks the labelled MOCK or
// the live solver, and the solver is drawn through flowviz's field link (src/flow/viz/fieldLink.ts),
// so a solver that cannot start, is lost or diverged, or whose step throws, is replaced by the MOCK
// at once: visibly (the state carries the reason, which the badge, the legend and the annunciators
// show) and never silently (warned). Pure: the view and the solver come in through the link's
// small interfaces, so the decisions are unit-tested with fakes.
//
// The solver is started once, the first time it is chosen (the worker hands in the start it began
// at boot). Back to the MOCK keeps it alive and idle (a link is dropped, never disposed, on a
// switch); a solver the link disposed after a failure is gone, and asking for it again falls back
// with the reason it failed. Only the latest choice may bind: a slow solver start cannot draw over
// a MOCK chosen after it.

import type { CpuFlowField, StepBudget } from '../contracts/flow';
import type { FlowSource } from '../contracts/sim';
import {
  createFlowFieldLink,
  type FlowFieldLink,
  type FlowFieldSink,
  type FlowLinkState,
  type LinkedSolver,
} from '../flow/viz/fieldLink';
import type { FieldChoice } from './protocol';

export interface FieldSwitch {
  /** The drawn field's link state: D4-82's coupling for the badge, W2V-I6's fallback reason. */
  state(): FlowLinkState;
  /** The drawn field's source, for the snapshot's sources.flow (derived, W1F-N1). */
  drawn(): FlowSource;
  /** The viewer's choice; resolves once it is bound (or superseded by a later choice). */
  choose(choice: FieldChoice): Promise<void>;
  /** Before a frame: the drawn solver's health check and rebind, and its step if budgeted. */
  beforeFrame(budget: StepBudget | null): void;
  /** A new MOCK raster: drawn at once while the MOCK is drawn, else kept for a fallback. */
  setMock(field: CpuFlowField): void;
}

export async function createFieldSwitch(o: {
  readonly sink: FlowFieldSink;
  readonly mock: CpuFlowField;
  /** Starts the live solver (called at most once). */
  readonly solver: () => Promise<LinkedSolver>;
  /** Where a fallback is reported (default console.warn). */
  readonly warn?: (message: string) => void;
}): Promise<FieldSwitch> {
  let mock = o.mock;
  let started: Promise<LinkedSolver> | null = null;
  /** Why the solver is gone (the link disposed it after a failure); null while it lives. */
  let dead: string | null = null;
  let disposed = false;
  /** The latest choice's token, and the bound link's. */
  let latest = 0;
  let live = 0;

  // a link may bind only while it is the bound one or the latest choice
  const guarded = (t: number): FlowFieldSink => ({
    setFlowField: (f) => {
      if (t === latest || t === live) o.sink.setFlowField(f);
    },
    setFlowSolverField: (f) => {
      if (t === latest || t === live) o.sink.setFlowSolverField(f);
    },
  });
  const solver = async (): Promise<LinkedSolver> => {
    if (dead !== null) throw new Error(dead);
    const s = await (started ??= o.solver());
    return {
      fields: () => s.fields(),
      status: () => s.status(),
      step: (b) => s.step(b),
      // the link disposes its solver only after a failure (a switch drops the link instead)
      dispose: () => {
        disposed = true;
        s.dispose();
      },
    };
  };
  const open = (t: number, choice: FieldChoice) =>
    createFlowFieldLink({
      sink: guarded(t),
      mock,
      ...(choice === 'solver' ? { solver } : {}),
      ...(o.warn === undefined ? {} : { warn: o.warn }),
    });
  const noteFailure = (l: FlowFieldLink) => {
    if (disposed && dead === null) dead = l.state().fallback ?? 'the solver failed';
  };

  let link = await open(0, 'mock');

  return {
    state: () => link.state(),
    drawn: () => (link.state().coupling === 'mock' ? 'mock' : 'solver'),
    async choose(choice) {
      const t = ++latest;
      const next = await open(t, choice);
      noteFailure(next);
      if (t !== latest) return;
      link = next;
      live = t;
    },
    beforeFrame(budget) {
      link.beforeFrame(budget);
      noteFailure(link);
    },
    setMock(field) {
      mock = field;
      link.setMock(field);
    },
  };
}
