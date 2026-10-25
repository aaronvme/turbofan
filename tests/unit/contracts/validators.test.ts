// The validator branches the per-contract test files do not reach: each case feeds one
// specific defect and checks the sentence that reports it, so a validator that stops
// noticing a defect fails here.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { validateCycleState, type CycleState } from '../../../src/contracts/cycle';
import { describeValue } from '../../../src/contracts/describe';
import { validateEngineDefinition, type EngineDefinition } from '../../../src/contracts/engine';
import { validateScenario, type Predicate, type Scenario } from '../../../src/contracts/scenario';
import {
  DEFAULT_UI_STATE,
  validateRenderStatePatch,
  validateUiState,
} from '../../../src/contracts/ui';
import { SAMPLE_REFERENCE_SPEEDS, sampleCycleState } from './fixtures/cycleFixture';
import { validEngine } from './fixtures/engineFixture';

describe('describeValue', () => {
  it('describes every JavaScript type for validator messages', () => {
    expect(describeValue('xray')).toBe('xray');
    expect(describeValue(3)).toBe('3');
    expect(describeValue(true)).toBe('true');
    expect(describeValue(10n)).toBe('10');
    expect(describeValue(undefined)).toBe('undefined');
    expect(describeValue(Symbol('s'))).toBe('Symbol(s)');
    expect(describeValue(() => 1)).toBe('function');
    expect(describeValue(null)).toBe('null');
    expect(describeValue({ a: 1 })).toBe('{"a":1}');
    // an object whose JSON form is undefined still gets a description
    expect(describeValue({ toJSON: () => undefined })).toBe('object');
  });
});

describe('validateCycleState: map points, temperatures, FADEC', () => {
  const problems = (patch: Partial<CycleState>) =>
    validateCycleState({ ...sampleCycleState(), ...patch }, SAMPLE_REFERENCE_SPEEDS).join('\n');
  const fan = sampleCycleState().fan;

  it.each<[string, Partial<CycleState>, RegExp]>([
    [
      'negative corrected flow',
      { fan: { ...fan, correctedFlowKgPerS: -1 } },
      /fan\.correctedFlowKgPerS/,
    ],
    ['zero pressure ratio', { hpc: { ...fan, pressureRatio: 0 } }, /hpc\.pressureRatio/],
    [
      'efficiency above 1',
      { fan: { ...fan, isentropicEfficiency: 1.2 } },
      /fan\.isentropicEfficiency/,
    ],
    [
      'negative corrected speed',
      { fan: { ...fan, correctedSpeedFraction: -0.1 } },
      /fan\.correctedSpeedFraction/,
    ],
    [
      'non-finite surge margin',
      { hpc: { ...fan, surgeMarginFraction: Number.NaN } },
      /hpc\.surgeMarginFraction/,
    ],
    ['zero displayed EGT', { egtDisplayedK: 0 }, /egtDisplayedK must be > 0/],
    [
      'non-finite measured EGT',
      { egtMeasuredK: Number.POSITIVE_INFINITY },
      /egtMeasuredK must be > 0/,
    ],
  ])('reports %s', (_name, patch, pattern) => {
    expect(problems(patch)).toMatch(pattern);
  });

  it('reports a non-physical station temperature and an unknown FADEC limiter', () => {
    const s = sampleCycleState();
    const bad = {
      ...s,
      stations: { ...s.stations, '3': { ...s.stations['3'], ttK: -5 } },
      fadec: { ...s.fadec, limiter: 'thrustLever' },
    } as unknown as CycleState;
    const text = validateCycleState(bad, SAMPLE_REFERENCE_SPEEDS).join('\n');
    expect(text).toMatch(/station 3 ttK -5 must be > 0/);
    expect(text).toMatch(/fadec\.limiter "thrustLever" is not a FADEC limiter/);
  });
});

describe('validateEngineDefinition: remaining geometry and performance checks', () => {
  const problems = (mutate: (d: EngineDefinition) => EngineDefinition) =>
    validateEngineDefinition(mutate(validEngine())).join('\n');
  const withRow = (d: EngineDefinition, i: number, patch: object): EngineDefinition => ({
    ...d,
    bladeRows: d.bladeRows.map((r, k) => (k === i ? { ...r, ...patch } : r)),
  });

  it('the centre body must be continuous from the hub into the plug', () => {
    expect(
      problems((d) => ({
        ...d,
        flowpath: {
          ...d.flowpath,
          curves: {
            ...d.flowpath.curves,
            plug: {
              points: [
                { x: 10, r: 0.25 },
                { x: 12, r: 0 },
              ],
            },
          },
        },
      })),
    ).toMatch(/coreInner must end where plug starts/);
  });

  it('blade-row VSV gains, tip clearances, edges and lean', () => {
    // row 2 is the HPC VSV, row 3 the HPC rotor
    expect(problems((d) => withRow(d, 2, { vsv: { scheduleId: 'hpc-vsv', gain: -1 } }))).toMatch(
      /VSV gain must be finite and >= 0/,
    );
    expect(problems((d) => withRow(d, 3, { tipClearance: -0.001 }))).toMatch(
      /tipClearance must be finite and >= 0/,
    );
    expect(
      problems((d) =>
        withRow(d, 3, {
          leadingEdge: { hub: { x: Number.NaN, r: 0.3 }, tip: { x: 3.5, r: 0.49 } },
        }),
      ),
    ).toMatch(/leading edge hub must be finite/);
    expect(problems((d) => withRow(d, 3, { lean: 1 }))).toMatch(/lean must be finite/);
  });

  it('VSV schedule points must be finite', () => {
    expect(
      problems((d) => ({
        ...d,
        vsvSchedules: [
          {
            id: 'hpc-vsv',
            points: [
              { n2CorrectedPercent: 50, closure: Number.NaN },
              { n2CorrectedPercent: 100, closure: 0 },
            ],
          },
        ],
      })),
    ).toMatch(/VSV schedule hpc-vsv: point 0 must be finite/);
  });

  it('combustor loss, cooling fraction, N2 limit and EGT shunt ranges', () => {
    const dp = (patch: object) => (d: EngineDefinition) => ({
      ...d,
      designPoint: { ...d.designPoint, ...patch },
    });
    expect(problems(dp({ combustorPressureLossFraction: 0.3 }))).toMatch(
      /combustorPressureLossFraction must be in \[0, 0\.2\)/,
    );
    expect(problems(dp({ turbineCoolingFraction: 0.6 }))).toMatch(
      /turbineCoolingFraction must be in \[0, 0\.5\)/,
    );
    expect(
      problems((d) => ({ ...d, limits: { ...d.limits, n2MaxRpm: d.designPoint.n2Rpm } })),
    ).toMatch(/limits\.n2MaxRpm .* must exceed the 100 % speed/);
    expect(
      problems((d) => ({
        ...d,
        limits: { ...d.limits, egtShunt: { offsetK: 30, rampStartN2Rpm: 9000, fullN2Rpm: 8500 } },
      })),
    ).toMatch(/limits\.egtShunt/);
  });
});

describe('validateScenario: paths, predicates and windows', () => {
  const base: Scenario = {
    id: 'checks',
    title: 'Validator checks',
    description: '',
    initial: 'groundIdle',
    ambient: ISA_SLS,
    durationS: 10,
    timeline: [],
    outcomes: [],
  };
  const withPredicate = (predicate: Predicate): Scenario => ({
    ...base,
    outcomes: [
      {
        id: 'o',
        description: '',
        window: { kind: 'always', fromS: 0, toS: 10 },
        predicate,
        thresholdId: null,
      },
    ],
  });
  const problems = (s: Scenario) => validateScenario(s).join('\n');

  it('rejects empty path keys, unknown operators, non-finite values and empty groups', () => {
    expect(
      problems(withPredicate({ kind: 'compare', path: ['cycle', ''], op: '<', value: 1 })),
    ).toMatch(/path keys must be non-empty strings/);
    expect(
      problems(
        withPredicate({
          kind: 'compare',
          path: ['cycle', 'n1Rpm'],
          op: '=~',
          value: 1,
        } as unknown as Predicate),
      ),
    ).toMatch(/unknown operator "=~"/);
    expect(
      problems(
        withPredicate({ kind: 'compare', path: ['cycle', 'n1Rpm'], op: '<', value: Number.NaN }),
      ),
    ).toMatch(/value must be finite/);
    expect(problems(withPredicate({ kind: 'any', of: [] }))).toMatch(
      /"any" must have at least one predicate/,
    );
  });

  it('validates the predicate inside a "not"', () => {
    expect(
      problems(
        withPredicate({ kind: 'not', of: { kind: 'compare', path: [], op: '<', value: 1 } }),
      ),
    ).toMatch(/\.not: path must not be empty/);
  });

  it('rejects non-finite or negative window times and a non-positive duration', () => {
    expect(
      problems({
        ...withPredicate({ kind: 'compare', path: ['cycle', 'n1Rpm'], op: '<', value: 1 }),
        outcomes: [
          {
            id: 'o',
            description: '',
            window: { kind: 'at', atS: -1 },
            predicate: { kind: 'compare', path: ['cycle', 'n1Rpm'], op: '<', value: 1 },
            thresholdId: null,
          },
        ],
      }),
    ).toMatch(/window times must be finite and >= 0/);
    expect(problems({ ...base, durationS: 0 })).toMatch(/durationS must be finite and > 0/);
  });
});

describe('UI state validators: whole-object fields', () => {
  it('rejects overlays and colormaps that are not objects', () => {
    expect(validateUiState({ ...DEFAULT_UI_STATE, overlays: 'all' }).join()).toMatch(
      /overlays must be an object/,
    );
    expect(validateUiState({ ...DEFAULT_UI_STATE, colormaps: null }).join()).toMatch(
      /colormaps must be an object/,
    );
    expect(validateRenderStatePatch({ overlays: [] }).join()).toMatch(/overlays/);
  });
});
