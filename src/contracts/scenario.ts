// Scenarios: a timeline of SimCommands plus expected outcomes, all plain data. Outcomes are
// predicates on snapshots, evaluated over time windows by a pure reducer, so the same
// scenario drives the app, a Vitest check and a Playwright run.

import { validateAmbient, type AmbientConditions } from './ambient';
import { CYCLE_INITIAL_CONDITIONS, type CycleInitialCondition } from './cycle';
import { SNAPSHOT_ROOTS, validateSimCommand, type SimCommand } from './sim';
import { isThresholdId, type ThresholdId } from './thresholds';
import { describeValue } from './describe';

export interface ScenarioStep {
  /** Seconds after the scenario starts. */
  readonly atS: number;
  readonly command: SimCommand;
}

/**
 * A path into a SimSnapshot as an array of keys (station ids such as "49.5" contain a dot,
 * so dotted strings would be ambiguous). Array elements are addressed by their index string.
 */
export type SnapshotPath = readonly string[];

export const COMPARE_OPS = ['<', '<=', '>', '>=', '==', '!='] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

export type Predicate =
  | {
      readonly kind: 'compare';
      readonly path: SnapshotPath;
      readonly op: CompareOp;
      readonly value: number | string | boolean;
    }
  | {
      readonly kind: 'between';
      readonly path: SnapshotPath;
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: 'all'; readonly of: readonly Predicate[] }
  | { readonly kind: 'any'; readonly of: readonly Predicate[] }
  | { readonly kind: 'not'; readonly of: Predicate };

/**
 * eventually: holds on at least one snapshot in [fromS, byS]. always: holds on every
 * snapshot in [fromS, toS]. at: holds on the first snapshot at or after atS. Times are
 * seconds since the scenario started.
 */
export type OutcomeWindow =
  | { readonly kind: 'eventually'; readonly fromS: number; readonly byS: number }
  | { readonly kind: 'always'; readonly fromS: number; readonly toS: number }
  | { readonly kind: 'at'; readonly atS: number };

export interface ExpectedOutcome {
  readonly id: string;
  readonly description: string;
  readonly window: OutcomeWindow;
  readonly predicate: Predicate;
  /** The pre-registered threshold (docs/PHYSICS.md) this outcome checks, if any. */
  readonly thresholdId: ThresholdId | null;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly initial: CycleInitialCondition;
  readonly ambient: AmbientConditions;
  readonly durationS: number;
  readonly timeline: readonly ScenarioStep[];
  readonly outcomes: readonly ExpectedOutcome[];
}

export type OutcomeVerdict = 'pending' | 'passed' | 'failed';

export interface OutcomeResult {
  readonly id: string;
  readonly verdict: OutcomeVerdict;
  readonly decidedAtS: number | null;
  readonly detail: string;
}

export type ScenarioRunState = 'idle' | 'running' | 'passed' | 'failed' | 'aborted';

/** The scenario part of a SimSnapshot. */
export interface ScenarioStatus {
  readonly scenarioId: string | null;
  readonly state: ScenarioRunState;
  readonly elapsedS: number;
  /** Index of the next timeline step to apply. */
  readonly nextStepIndex: number;
  readonly outcomes: readonly OutcomeResult[];
}

export const IDLE_SCENARIO_STATUS: ScenarioStatus = {
  scenarioId: null,
  state: 'idle',
  elapsedS: 0,
  nextStepIndex: 0,
  outcomes: [],
};

// ---------------------------------------------------------------------------------------
// Evaluation

/** Follows a path through own properties; undefined if any key is missing. */
export function resolvePath(root: unknown, path: SnapshotPath): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null || !Object.hasOwn(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function compare(a: unknown, op: CompareOp, b: number | string | boolean): boolean {
  if (typeof a !== typeof b) return false;
  if (op === '==') return a === b;
  if (op === '!=') return a !== b;
  if (typeof a !== 'number' || typeof b !== 'number') return false; // ordering only on numbers
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
  }
}

export function evaluatePredicate(predicate: Predicate, snapshot: unknown): boolean {
  switch (predicate.kind) {
    case 'compare':
      return compare(resolvePath(snapshot, predicate.path), predicate.op, predicate.value);
    case 'between': {
      const v = resolvePath(snapshot, predicate.path);
      return typeof v === 'number' && v >= predicate.min && v <= predicate.max;
    }
    case 'all':
      return predicate.of.every((p) => evaluatePredicate(p, snapshot));
    case 'any':
      return predicate.of.some((p) => evaluatePredicate(p, snapshot));
    case 'not':
      return !evaluatePredicate(predicate.of, snapshot);
  }
}

export function initialOutcomeResults(scenario: Scenario): OutcomeResult[] {
  return scenario.outcomes.map((o) => ({
    id: o.id,
    verdict: 'pending',
    decidedAtS: null,
    detail: '',
  }));
}

function decide(
  outcome: ExpectedOutcome,
  snapshot: unknown,
  elapsedS: number,
): OutcomeResult | null {
  const w = outcome.window;
  const holds = () => evaluatePredicate(outcome.predicate, snapshot);
  const result = (verdict: OutcomeVerdict, detail: string): OutcomeResult => ({
    id: outcome.id,
    verdict,
    decidedAtS: elapsedS,
    detail,
  });
  switch (w.kind) {
    case 'eventually':
      if (elapsedS >= w.fromS && elapsedS <= w.byS && holds())
        return result('passed', `held at ${elapsedS} s`);
      if (elapsedS > w.byS) return result('failed', `did not hold by ${w.byS} s`);
      return null;
    case 'always':
      if (elapsedS >= w.fromS && elapsedS <= w.toS && !holds())
        return result('failed', `violated at ${elapsedS} s`);
      if (elapsedS >= w.toS) return result('passed', `held from ${w.fromS} s to ${w.toS} s`);
      return null;
    case 'at':
      if (elapsedS < w.atS) return null;
      return holds()
        ? result('passed', `held at ${elapsedS} s`)
        : result('failed', `did not hold at ${elapsedS} s`);
  }
}

/** Pure reducer: decides pending outcomes against one more snapshot taken elapsedS into the run. */
export function updateOutcomes(
  scenario: Scenario,
  results: readonly OutcomeResult[],
  snapshot: unknown,
  elapsedS: number,
): OutcomeResult[] {
  return scenario.outcomes.map((outcome, i) => {
    const prev = results[i] ?? { id: outcome.id, verdict: 'pending', decidedAtS: null, detail: '' };
    if (prev.verdict !== 'pending') return prev;
    return decide(outcome, snapshot, elapsedS) ?? prev;
  });
}

/** Closes the run at endS: outcomes still pending pass only if they were "always" and covered. */
export function finalizeOutcomes(
  scenario: Scenario,
  results: readonly OutcomeResult[],
  endS: number,
): OutcomeResult[] {
  return scenario.outcomes.map((outcome, i) => {
    const prev = results[i] ?? { id: outcome.id, verdict: 'pending', decidedAtS: null, detail: '' };
    if (prev.verdict !== 'pending') return prev;
    const w = outcome.window;
    if (w.kind === 'always' && endS >= w.toS) {
      return {
        id: outcome.id,
        verdict: 'passed',
        decidedAtS: endS,
        detail: `held from ${w.fromS} s to ${w.toS} s`,
      };
    }
    return {
      id: outcome.id,
      verdict: 'failed',
      decidedAtS: endS,
      detail: `scenario ended at ${endS} s before the outcome was decided`,
    };
  });
}

// ---------------------------------------------------------------------------------------
// Validation

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validatePath(
  path: SnapshotPath,
  where: string,
  sample: unknown,
  problems: string[],
): void {
  if (path.length === 0) {
    problems.push(`${where}: path must not be empty`);
    return;
  }
  if (path.some((k) => typeof k !== 'string' || k.length === 0)) {
    problems.push(`${where}: path keys must be non-empty strings`);
    return;
  }
  const root = path[0] ?? '';
  if (!(SNAPSHOT_ROOTS as readonly string[]).includes(root)) {
    problems.push(`${where}: unknown snapshot root "${root}"`);
    return;
  }
  if (sample !== undefined && resolvePath(sample, path) === undefined) {
    problems.push(`${where}: ${path.join('.')} does not resolve on the sample snapshot`);
  }
}

function validatePredicate(p: Predicate, where: string, sample: unknown, problems: string[]): void {
  switch (p.kind) {
    case 'compare':
      validatePath(p.path, where, sample, problems);
      if (!(COMPARE_OPS as readonly string[]).includes(p.op))
        problems.push(`${where}: unknown operator "${p.op}"`);
      if (typeof p.value === 'number' && !Number.isFinite(p.value))
        problems.push(`${where}: value must be finite`);
      return;
    case 'between':
      validatePath(p.path, where, sample, problems);
      if (!(isFiniteNumber(p.min) && isFiniteNumber(p.max) && p.min <= p.max)) {
        problems.push(`${where}: min ${String(p.min)} must not exceed max ${String(p.max)}`);
      }
      return;
    case 'all':
    case 'any':
      if (p.of.length === 0)
        problems.push(`${where}: "${p.kind}" must have at least one predicate`);
      p.of.forEach((q, i) => {
        validatePredicate(q, `${where}.${p.kind}[${i}]`, sample, problems);
      });
      return;
    case 'not':
      validatePredicate(p.of, `${where}.not`, sample, problems);
      return;
  }
}

function windowProblems(w: OutcomeWindow, durationS: number): string[] {
  const span: [number, number] =
    w.kind === 'eventually'
      ? [w.fromS, w.byS]
      : w.kind === 'always'
        ? [w.fromS, w.toS]
        : [w.atS, w.atS];
  const [from, to] = span;
  const endName = w.kind === 'eventually' ? 'byS' : w.kind === 'always' ? 'toS' : 'atS';
  const problems: string[] = [];
  if (!(isFiniteNumber(from) && isFiniteNumber(to) && from >= 0))
    problems.push('window times must be finite and >= 0');
  else if (from > to) problems.push(`window fromS ${from} must not exceed ${endName} ${to}`);
  else if (to > durationS) problems.push(`window ends at ${to} s, after durationS ${durationS} s`);
  return problems;
}

/**
 * Checks a scenario's structure. With a sample snapshot, also checks that every predicate
 * path resolves to a value.
 */
export function validateScenario(scenario: Scenario, sample?: unknown): string[] {
  const problems: string[] = [];
  if (scenario.id.length === 0) problems.push('id must not be empty');
  if (scenario.title.length === 0) problems.push('title must not be empty');
  if (!(isFiniteNumber(scenario.durationS) && scenario.durationS > 0))
    problems.push('durationS must be finite and > 0');
  if (!(CYCLE_INITIAL_CONDITIONS as readonly string[]).includes(scenario.initial)) {
    problems.push(
      `initial "${describeValue(scenario.initial)}" must be one of ${CYCLE_INITIAL_CONDITIONS.join(', ')}`,
    );
  }
  for (const msg of validateAmbient(scenario.ambient)) problems.push(`ambient: ${msg}`);
  scenario.timeline.forEach((step, i) => {
    const where = `timeline[${i}]`;
    if (!(isFiniteNumber(step.atS) && step.atS >= 0))
      problems.push(`${where}.atS must be finite and >= 0`);
    else if (step.atS > scenario.durationS)
      problems.push(`${where} at ${step.atS} s is after durationS ${scenario.durationS} s`);
    const prev = scenario.timeline[i - 1];
    if (prev !== undefined && step.atS < prev.atS) {
      problems.push(
        `${where} at ${step.atS} s must not be before timeline[${i - 1}] at ${prev.atS} s`,
      );
    }
    for (const msg of validateSimCommand(step.command)) problems.push(`${where}.command: ${msg}`);
    if (step.command.type === 'runScenario')
      problems.push(`${where}: a scenario cannot start another scenario`);
  });
  const ids = new Set<string>();
  for (const outcome of scenario.outcomes) {
    const where = `outcome ${outcome.id}`;
    if (outcome.id.length === 0) problems.push('an outcome has an empty id');
    if (ids.has(outcome.id)) problems.push(`duplicate outcome id "${outcome.id}"`);
    ids.add(outcome.id);
    for (const msg of windowProblems(outcome.window, scenario.durationS))
      problems.push(`${where}: ${msg}`);
    validatePredicate(outcome.predicate, where, sample, problems);
    if (outcome.thresholdId !== null && !isThresholdId(outcome.thresholdId)) {
      problems.push(`${where}: unknown thresholdId "${String(outcome.thresholdId)}"`);
    }
  }
  return problems;
}
