// The thread-agnostic sim/UI boundary (decision D0-2, docs/reviews/LOG.md). The UI reads
// immutable, versioned SimSnapshots and sends SimCommands as messages; it never touches sim
// objects. Everything here is structured-clone-safe plain data, so the same code works with
// the sim on the main thread or in a Worker (postMessage clones it).

import { validateAmbient, type AmbientConditions } from './ambient';
import {
  CYCLE_FAULTS,
  CYCLE_INITIAL_CONDITIONS,
  IGNITION_MODES,
  MAX_CUSTOMER_BLEED_FRACTION,
  type CycleFault,
  type CycleInitialCondition,
  type CycleInputs,
  type CycleState,
  type IgnitionMode,
} from './cycle';
import { SOLVER_MODES, type FlowStepStats, type SolverMode, type StationReduction } from './flow';
import type { ScenarioStatus } from './scenario';
import {
  VIEW_MODES,
  validateRenderStatePatch,
  type RenderState,
  type RenderStatePatch,
  type ViewMode,
} from './ui';

export const SIM_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------------------
// Clock

export interface SimClock {
  readonly simTimeS: number;
  /** Sim seconds per wall second. */
  readonly timeScale: number;
  readonly paused: boolean;
}

/** Slowest time scale: physical-time solver mode runs about 2000x slow motion. */
export const TIME_SCALE_MIN = 1e-4;
/** Fastest time scale: fast-forward through long scenarios (a cold start takes about a minute). */
export const TIME_SCALE_MAX = 4;
/** Wall-clock steps are clamped here, so a background tab does not produce one huge sim step. */
export const MAX_WALL_STEP_S = 0.1;

export const INITIAL_CLOCK: SimClock = { simTimeS: 0, timeScale: 1, paused: false };

export function advanceClock(
  clock: SimClock,
  wallDtS: number,
): { clock: SimClock; simDtS: number } {
  const wall = wallDtS > 0 ? Math.min(wallDtS, MAX_WALL_STEP_S) : 0; // NaN and negatives -> 0
  const simDtS = clock.paused ? 0 : wall * clock.timeScale;
  return { clock: { ...clock, simTimeS: clock.simTimeS + simDtS }, simDtS };
}

// ---------------------------------------------------------------------------------------
// Snapshot

export interface FlowStatus {
  /** False until the solver is initialised (or when WebGPU is unavailable). */
  readonly available: boolean;
  readonly mode: SolverMode;
  readonly stats: FlowStepStats | null;
  readonly reduction: StationReduction | null;
}

export interface SimSnapshot {
  readonly schemaVersion: typeof SIM_SCHEMA_VERSION;
  /** Increments by one per published snapshot. */
  readonly version: number;
  /** seq of the last applied SimCommandMessage, -1 before the first. */
  readonly lastCommandSeq: number;
  readonly clock: SimClock;
  readonly cycle: CycleState;
  /** The commanded inputs in effect (lever position, switches, ambient). */
  readonly inputs: CycleInputs;
  readonly flow: FlowStatus;
  readonly scenario: ScenarioStatus;
  /** Echo of the render state the renderer is using. */
  readonly view: RenderState;
}

export type SnapshotParts = Omit<SimSnapshot, 'schemaVersion' | 'version'>;

/** Top-level snapshot keys, for scenario predicate paths. */
export const SNAPSHOT_ROOTS = [
  'schemaVersion',
  'version',
  'lastCommandSeq',
  'clock',
  'cycle',
  'inputs',
  'flow',
  'scenario',
  'view',
] as const satisfies readonly (keyof SimSnapshot)[];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Returns the path and reason of the first value that is not plain data, or null if the
 * whole value is plain data: null, booleans, finite numbers, strings, dense arrays and
 * objects whose prototype is Object.prototype or null, with data properties only, nested
 * without cycles. undefined is allowed (optional fields). structuredClone would silently
 * turn class instances into plain objects and throws on functions; this catches both.
 */
export function findNonPlainData(value: unknown): string | null {
  const ancestors = new Set<object>();
  const at = (path: string) => (path === '' ? '(root)' : path);
  const visit = (v: unknown, path: string): string | null => {
    switch (typeof v) {
      case 'undefined':
      case 'boolean':
      case 'string':
        return null;
      case 'number':
        return Number.isFinite(v) ? null : `${at(path)}: non-finite number`;
      case 'function':
        return `${at(path)}: function`;
      case 'symbol':
        return `${at(path)}: symbol`;
      case 'bigint':
        return `${at(path)}: bigint`;
      default:
        break;
    }
    if (v === null) return null;
    const obj = v as object;
    if (ancestors.has(obj)) return `${at(path)}: cycle`;
    const proto: unknown = Object.getPrototypeOf(obj);
    const isArray = Array.isArray(obj);
    if (!(isArray ? proto === Array.prototype : proto === Object.prototype || proto === null)) {
      const name =
        isRecord(proto) && typeof proto.constructor === 'function'
          ? proto.constructor.name
          : 'unknown';
      return `${at(path)}: class instance (${name})`;
    }
    if (Object.getOwnPropertySymbols(obj).length > 0) return `${at(path)}: symbol-keyed property`;
    ancestors.add(obj);
    try {
      if (isArray) {
        const arr = obj as readonly unknown[];
        for (let i = 0; i < arr.length; i++) {
          const p = `${path}[${i}]`;
          if (!(i in arr)) return `${p}: hole in array`;
          const bad = visit(arr[i], p);
          if (bad !== null) return bad;
        }
        return null;
      }
      for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
        const p = path === '' ? key : `${path}.${key}`;
        if (!('value' in desc)) return `${p}: accessor property`;
        const bad = visit(desc.value, p);
        if (bad !== null) return bad;
      }
      return null;
    } finally {
      ancestors.delete(obj);
    }
  };
  return visit(value, '');
}

/** Freezes value and everything reachable from it; returns the same object. */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>();
  const freeze = (v: unknown): void => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v);
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  };
  freeze(value);
  return value;
}

/**
 * Builds the next snapshot: copies the parts (so the snapshot shares nothing with sim
 * internals), stamps schema and version, checks plain data and deep-freezes it.
 */
export function nextSnapshot(previous: SimSnapshot | null, parts: SnapshotParts): SimSnapshot {
  const bad = findNonPlainData(parts);
  if (bad !== null) throw new Error(`snapshot is not plain data: ${bad}`);
  const snapshot: SimSnapshot = {
    schemaVersion: SIM_SCHEMA_VERSION,
    version: (previous?.version ?? 0) + 1,
    ...structuredClone(parts),
  };
  return deepFreeze(snapshot);
}

// ---------------------------------------------------------------------------------------
// Commands

export type SimCommand =
  | { readonly type: 'setThrottle'; readonly lever: number }
  | { readonly type: 'start'; readonly engage: boolean }
  | { readonly type: 'cutoff'; readonly cutoff: boolean }
  | { readonly type: 'ignition'; readonly mode: IgnitionMode }
  | { readonly type: 'setBleed'; readonly customerBleedFraction: number }
  | { readonly type: 'setAmbient'; readonly ambient: AmbientConditions }
  | { readonly type: 'injectFault'; readonly fault: CycleFault }
  | { readonly type: 'reset'; readonly initial: CycleInitialCondition }
  | { readonly type: 'setViewMode'; readonly mode: ViewMode }
  | { readonly type: 'setRenderState'; readonly render: RenderStatePatch }
  | { readonly type: 'setTimeScale'; readonly scale: number }
  | { readonly type: 'pause'; readonly paused: boolean }
  | { readonly type: 'stepFrame'; readonly dtS: number }
  | { readonly type: 'setSolverMode'; readonly mode: SolverMode }
  | { readonly type: 'runScenario'; readonly scenarioId: string }
  | { readonly type: 'stopScenario' };

export type SimCommandType = SimCommand['type'];

/** A command as sent across the boundary; seq orders commands and is echoed in snapshots. */
export interface SimCommandMessage {
  readonly seq: number;
  readonly command: SimCommand;
}

type FieldValidator = (c: Record<string, unknown>, problems: string[]) => void;

const num =
  (field: string, min: number, max: number, minExclusive = false): FieldValidator =>
  (c, p) => {
    const v = c[field];
    const ok =
      typeof v === 'number' &&
      Number.isFinite(v) &&
      (minExclusive ? v > min : v >= min) &&
      v <= max;
    if (!ok)
      p.push(
        `${String(c['type'])}.${field} ${String(v)} must be in ${minExclusive ? '(' : '['}${min}, ${max}]`,
      );
  };
const bool =
  (field: string): FieldValidator =>
  (c, p) => {
    if (typeof c[field] !== 'boolean') p.push(`${String(c['type'])}.${field} must be a boolean`);
  };
const oneOf =
  (field: string, list: readonly string[]): FieldValidator =>
  (c, p) => {
    const v = c[field];
    if (!(typeof v === 'string' && list.includes(v))) {
      p.push(`${String(c['type'])}.${field} "${String(v)}" must be one of ${list.join(', ')}`);
    }
  };

const COMMAND_VALIDATORS: Readonly<Record<SimCommandType, FieldValidator>> = {
  setThrottle: num('lever', 0, 1),
  start: bool('engage'),
  cutoff: bool('cutoff'),
  ignition: oneOf('mode', IGNITION_MODES),
  setBleed: num('customerBleedFraction', 0, MAX_CUSTOMER_BLEED_FRACTION),
  setAmbient: (c, p) => {
    const a = c['ambient'];
    if (!isRecord(a)) p.push('setAmbient.ambient must be an object');
    else
      for (const msg of validateAmbient(a as unknown as AmbientConditions))
        p.push(`setAmbient.ambient: ${msg}`);
  },
  injectFault: oneOf('fault', CYCLE_FAULTS),
  reset: oneOf('initial', CYCLE_INITIAL_CONDITIONS),
  setViewMode: oneOf('mode', VIEW_MODES),
  setRenderState: (c, p) => {
    for (const msg of validateRenderStatePatch(c['render'])) p.push(`setRenderState.render.${msg}`);
  },
  setTimeScale: num('scale', TIME_SCALE_MIN, TIME_SCALE_MAX),
  pause: bool('paused'),
  stepFrame: num('dtS', 0, MAX_WALL_STEP_S, true),
  setSolverMode: oneOf('mode', SOLVER_MODES),
  runScenario: (c, p) => {
    const id = c['scenarioId'];
    if (!(typeof id === 'string' && id.length > 0))
      p.push('runScenario.scenarioId must be a non-empty string');
  },
  stopScenario: () => undefined,
};

export const SIM_COMMAND_TYPES = Object.keys(COMMAND_VALIDATORS) as readonly SimCommandType[];

const isCommandType = (v: unknown): v is SimCommandType =>
  typeof v === 'string' && Object.hasOwn(COMMAND_VALIDATORS, v);

/** Validates a command received from another thread or a scenario file. */
export function validateSimCommand(value: unknown): string[] {
  if (!isRecord(value) || Array.isArray(value)) return ['command must be an object'];
  const type = value['type'];
  if (!isCommandType(type)) return [`unknown command type "${String(type)}"`];
  const problems: string[] = [];
  COMMAND_VALIDATORS[type](value, problems);
  return problems;
}

export function validateSimCommandMessage(value: unknown): string[] {
  if (!isRecord(value) || Array.isArray(value)) return ['message must be an object'];
  const problems: string[] = [];
  const seq = value['seq'];
  if (!(typeof seq === 'number' && Number.isInteger(seq) && seq >= 0))
    problems.push('seq must be a non-negative integer');
  for (const msg of validateSimCommand(value['command'])) problems.push(`command: ${msg}`);
  return problems;
}
