import { DEFAULT_CYCLE_INPUTS } from '../../../../src/contracts/cycle';
import type { SimCommand, SimSnapshot, SnapshotParts } from '../../../../src/contracts/sim';
import { DEFAULT_UI_STATE, renderStateOf } from '../../../../src/contracts/ui';
import { sampleCycleState } from './cycleFixture';

export function sampleSnapshotParts(): SnapshotParts {
  return {
    lastCommandSeq: 7,
    clock: { simTimeS: 12.5, timeScale: 1, paused: false },
    cycle: sampleCycleState(),
    inputs: { ...DEFAULT_CYCLE_INPUTS, throttleLever: 0.6, fuelLever: 'run' },
    flow: {
      available: true,
      mode: 'tracking',
      stats: {
        iterationsThisStep: 5,
        totalIterations: 12_000,
        gpuTimeMs: 5.8,
        residualDensityL2: 3.2e-6,
        physicalTimeS: 0,
      },
      reduction: null,
    },
    scenario: {
      scenarioId: 'takeoff',
      state: 'running',
      elapsedS: 3.25,
      nextStepIndex: 2,
      outcomes: [{ id: 'reach-95', verdict: 'pending', decidedAtS: null, detail: '', samples: 0 }],
    },
    view: renderStateOf(DEFAULT_UI_STATE),
  };
}

export function sampleSnapshot(): SimSnapshot {
  return { schemaVersion: 1, version: 42, ...sampleSnapshotParts() };
}

/** One valid example of every command type. */
export const SAMPLE_COMMANDS: readonly SimCommand[] = [
  { type: 'setThrottle', lever: 0.75 },
  { type: 'start', engage: true },
  { type: 'cutoff', cutoff: false },
  { type: 'ignition', mode: 'continuous' },
  { type: 'setBleed', customerBleedFraction: 0.05 },
  { type: 'setAmbient', ambient: { pressurePa: 95_000, temperatureK: 303.15, machNumber: 0 } },
  { type: 'injectFault', fault: 'flameout' },
  { type: 'reset', initial: 'groundIdle' },
  { type: 'setViewMode', mode: 'cutaway' },
  { type: 'setRenderState', render: { quality: 'low', overlays: { particles: false } } },
  { type: 'setTimeScale', scale: 0.25 },
  { type: 'pause', paused: true },
  { type: 'stepFrame', dtS: 1 / 60 },
  { type: 'setSolverMode', mode: 'physical' },
  { type: 'runScenario', scenarioId: 'cold-start' },
  { type: 'stopScenario' },
];
