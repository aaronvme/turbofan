// The app's simulation core (D0-2/D2-4): it owns the cycle model, the clock, the commanded
// inputs and the render state, takes SimCommandMessages and publishes immutable SimSnapshots.
// Pure and thread-agnostic: the worker (src/app/simWorker.ts) drives it once per frame, the
// tests drive it directly. Provenance is derived here, never declared by the caller (W1F-N1):
// sources.cycle is the model's own `source`, sources.flow the bound field's.

import { ISA_SLS } from '../contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  type CycleInitialCondition,
  type CycleInputs,
  type CycleModel,
  type CycleState,
} from '../contracts/cycle';
import type { SolverMode } from '../contracts/flow';
import { IDLE_SCENARIO_STATUS } from '../contracts/scenario';
import {
  advanceClock,
  INITIAL_CLOCK,
  nextSnapshot,
  validateSimCommandMessage,
  type FlowSource,
  type FlowStatus,
  type SimClock,
  type SimCommand,
  type SimCommandMessage,
  type SimSnapshot,
} from '../contracts/sim';
import type { RenderState, RenderStatePatch } from '../contracts/ui';
import { APP_DEFAULT_VIEW, withViewMode } from './viewState';

export interface SimCoreOptions {
  readonly cycle: CycleModel;
  /** Where the engine starts (default: ground idle, so the first frame shows a running engine). */
  readonly initial?: CycleInitialCondition;
  /** The first render state (default: APP_DEFAULT_VIEW). */
  readonly view?: RenderState;
}

export interface SimCore {
  /** Validates and applies one command message; the problems if it was refused (not applied). */
  command(message: unknown): string[];
  /** Advances the clock by a wall step and integrates the cycle over its sim step; the sim step. */
  advance(wallDtS: number): number;
  /** The next snapshot, with the flow part and its source from the caller's solver binding. */
  snapshot(flow: { readonly flow: FlowStatus; readonly flowSource: FlowSource }): SimSnapshot;
  state(): CycleState;
  readonly inputs: CycleInputs;
  readonly view: RenderState;
  readonly clock: SimClock;
  readonly solverMode: SolverMode;
}

/** The inputs that match an initial condition (a reset must not leave a running lever behind). */
export function inputsFor(initial: CycleInitialCondition, ambient = ISA_SLS): CycleInputs {
  return initial === 'groundIdle'
    ? { ...DEFAULT_CYCLE_INPUTS, ambient, fuelLever: 'run', ignition: 'auto' }
    : { ...DEFAULT_CYCLE_INPUTS, ambient };
}

/**
 * A render-state patch over the view. A patch that changes the mode puts the tracers at the new
 * mode's default (D4-83) unless it sets them itself.
 */
export function mergeRenderState(view: RenderState, patch: RenderStatePatch): RenderState {
  const base =
    patch.viewMode !== undefined && patch.viewMode !== view.viewMode
      ? withViewMode(view, patch.viewMode)
      : view;
  return {
    ...base,
    ...patch,
    overlays: { ...base.overlays, ...patch.overlays },
    colormaps: { ...base.colormaps, ...patch.colormaps },
  };
}

export function createSimCore(o: SimCoreOptions): SimCore {
  const cycle = o.cycle;
  const initial = o.initial ?? 'groundIdle';
  let inputs = inputsFor(initial);
  let state = cycle.reset(initial, inputs.ambient);
  let clock = INITIAL_CLOCK;
  let view = o.view ?? APP_DEFAULT_VIEW;
  let solverMode: SolverMode = 'tracking';
  let lastSeq = -1;
  let previous: SimSnapshot | null = null;

  const step = (simDtS: number) => {
    if (simDtS > 0) state = cycle.step(simDtS, inputs);
  };

  const apply = (c: SimCommand): string[] => {
    switch (c.type) {
      case 'setThrottle':
        inputs = { ...inputs, throttleLever: c.lever };
        return [];
      case 'start':
        inputs = { ...inputs, starter: c.engage };
        return [];
      case 'cutoff':
        inputs = { ...inputs, fuelLever: c.cutoff ? 'cutoff' : 'run' };
        return [];
      case 'ignition':
        inputs = { ...inputs, ignition: c.mode };
        return [];
      case 'setBleed':
        inputs = { ...inputs, customerBleedFraction: c.customerBleedFraction };
        return [];
      case 'setAmbient':
        inputs = { ...inputs, ambient: c.ambient };
        return [];
      case 'injectFault':
        cycle.injectFault(c.fault);
        return [];
      case 'reset':
        inputs = inputsFor(c.initial, inputs.ambient);
        state = cycle.reset(c.initial, inputs.ambient);
        return [];
      case 'setViewMode':
        // D4-83: the tracers start at the new mode's default
        view = withViewMode(view, c.mode);
        return [];
      case 'setRenderState':
        view = mergeRenderState(view, c.render);
        return [];
      case 'setTimeScale':
        clock = { ...clock, timeScale: c.scale };
        return [];
      case 'pause':
        clock = { ...clock, paused: c.paused };
        return [];
      case 'stepFrame': {
        // one frame while paused (or not): the wall step at the current time scale
        const simDtS = c.dtS * clock.timeScale;
        clock = { ...clock, simTimeS: clock.simTimeS + simDtS };
        step(simDtS);
        return [];
      }
      case 'setSolverMode':
        solverMode = c.mode;
        return [];
      case 'runScenario':
        return [`scenario "${c.scenarioId}": scenarios are not available in this build (W3)`];
      case 'stopScenario':
        return [];
    }
  };

  return {
    command(message) {
      const problems = validateSimCommandMessage(message);
      if (problems.length > 0) return problems;
      const m = message as SimCommandMessage;
      if (m.seq <= lastSeq) return [`seq ${m.seq} is not after the last applied seq ${lastSeq}`];
      const refused = apply(m.command);
      if (refused.length === 0) lastSeq = m.seq;
      return refused;
    },
    advance(wallDtS) {
      const next = advanceClock(clock, wallDtS);
      clock = next.clock;
      step(next.simDtS);
      return next.simDtS;
    },
    snapshot({ flow, flowSource }) {
      previous = nextSnapshot(previous, {
        lastCommandSeq: lastSeq,
        clock,
        cycle: state,
        inputs,
        flow,
        scenario: IDLE_SCENARIO_STATUS,
        view,
        sources: { cycle: cycle.source, flow: flowSource },
      });
      return previous;
    },
    state: () => state,
    get inputs() {
      return inputs;
    },
    get view() {
      return view;
    },
    get clock() {
      return clock;
    },
    get solverMode() {
      return solverMode;
    },
  };
}
