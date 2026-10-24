import { describe, expect, it } from 'vitest';
import { ISA_SLS, validateAmbient } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  FADEC_LIMITERS,
  FADEC_MODES,
  MAX_CUSTOMER_BLEED_FRACTION,
  START_PHASES,
  STOICHIOMETRIC_FAR,
  percentOfReference,
  validateCycleInputs,
  validateCycleState,
  type CycleInputs,
  type CycleState,
} from '../../../src/contracts/cycle';
import { SAMPLE_REFERENCE_SPEEDS, sampleCycleState } from './fixtures/cycleFixture';

describe('ambient conditions', () => {
  it('ISA sea-level static is 101325 Pa, 288.15 K, Mach 0', () => {
    expect(ISA_SLS).toEqual({ pressurePa: 101325, temperatureK: 288.15, machNumber: 0 });
    expect(validateAmbient(ISA_SLS)).toEqual([]);
  });

  it('rejects impossible ambients', () => {
    expect(validateAmbient({ pressurePa: -1, temperatureK: 288, machNumber: 0 })).toEqual([
      expect.stringMatching(/pressure/),
    ]);
    expect(validateAmbient({ pressurePa: 1e5, temperatureK: 0, machNumber: 0 })[0]).toMatch(
      /temperature/,
    );
    expect(validateAmbient({ pressurePa: 1e5, temperatureK: 288, machNumber: 1.2 })[0]).toMatch(
      /Mach/,
    );
    expect(
      validateAmbient({ pressurePa: Number.NaN, temperatureK: 288, machNumber: 0 })[0],
    ).toMatch(/pressure/);
  });
});

describe('cycle inputs', () => {
  it('defaults to a shut-down engine at ISA SLS with the lever at idle', () => {
    expect(DEFAULT_CYCLE_INPUTS).toEqual({
      throttleLever: 0,
      starter: false,
      fuelLever: 'cutoff',
      ignition: 'off',
      customerBleedFraction: 0,
      powerExtractionW: 0,
      ambient: ISA_SLS,
    });
    expect(validateCycleInputs(DEFAULT_CYCLE_INPUTS)).toEqual([]);
  });

  it('caps customer bleed at the TCDS combined HPC 5th + 9th stage limit (13 % of primary flow)', () => {
    expect(MAX_CUSTOMER_BLEED_FRACTION).toBe(0.13);
  });

  it.each<[string, Partial<CycleInputs>, RegExp]>([
    ['lever above full', { throttleLever: 1.01 }, /throttleLever/],
    ['lever below idle', { throttleLever: -0.01 }, /throttleLever/],
    ['lever NaN', { throttleLever: Number.NaN }, /throttleLever/],
    ['bleed above the TCDS limit', { customerBleedFraction: 0.2 }, /customerBleedFraction/],
    ['negative bleed', { customerBleedFraction: -0.01 }, /customerBleedFraction/],
    ['negative power extraction', { powerExtractionW: -5 }, /powerExtractionW/],
    ['bad ambient', { ambient: { pressurePa: 0, temperatureK: 288, machNumber: 0 } }, /ambient/],
  ])('rejects %s', (_name, patch, pattern) => {
    const problems = validateCycleInputs({ ...DEFAULT_CYCLE_INPUTS, ...patch });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(pattern);
  });

  it('rejects unknown enum values coming from untyped data', () => {
    const bad = {
      ...DEFAULT_CYCLE_INPUTS,
      fuelLever: 'open',
      ignition: 'maybe',
    } as unknown as CycleInputs;
    const problems = validateCycleInputs(bad).join('\n');
    expect(problems).toMatch(/fuelLever/);
    expect(problems).toMatch(/ignition/);
  });
});

describe('cycle state', () => {
  it('exposes the FADEC modes, limiters and start phases as closed sets', () => {
    expect(FADEC_MODES).toEqual(['off', 'start', 'run', 'shutdown']);
    expect(FADEC_LIMITERS).toContain('n1Target');
    expect(FADEC_LIMITERS).toContain('egtMax');
    expect(START_PHASES).toEqual([
      'none',
      'cranking',
      'ignition',
      'accelerating',
      'selfSustaining',
      'aborted',
    ]);
  });

  it('computes percent speed against the 100 % reference speed', () => {
    expect(percentOfReference(5175, 5175)).toBe(100);
    expect(percentOfReference(5382, 5175)).toBeCloseTo(104, 1);
  });

  it('accepts a consistent state', () => {
    expect(validateCycleState(sampleCycleState(), SAMPLE_REFERENCE_SPEEDS)).toEqual([]);
  });

  const mutate = (fn: (s: CycleState) => CycleState) => fn(sampleCycleState());

  it.each<[string, CycleState, RegExp]>([
    ['non-finite thrust', mutate((s) => ({ ...s, netThrustN: Number.NaN })), /netThrustN/],
    ['percent not matching rpm', mutate((s) => ({ ...s, n1Percent: 50 })), /n1Percent .* n1Rpm/],
    [
      'negative total pressure',
      mutate((s) => ({ ...s, stations: { ...s.stations, '3': { ...s.stations['3'], ptPa: -1 } } })),
      /station 3 .*ptPa/,
    ],
    [
      'FAR above stoichiometric',
      mutate((s) => ({
        ...s,
        stations: {
          ...s.stations,
          '4': { ...s.stations['4'], fuelAirRatio: STOICHIOMETRIC_FAR + 0.01 },
        },
      })),
      /station 4 .*fuelAirRatio/,
    ],
    [
      'negative mass flow',
      mutate((s) => ({
        ...s,
        stations: { ...s.stations, '2': { ...s.stations['2'], wKgPerS: -3 } },
      })),
      /station 2 .*wKgPerS/,
    ],
    ['negative fuel flow', mutate((s) => ({ ...s, fuelFlowKgPerS: -0.1 })), /fuelFlowKgPerS/],
    ['TSFC NaN', mutate((s) => ({ ...s, tsfcKgPerNs: Number.NaN })), /tsfcKgPerNs/],
    [
      'efficiency above 1',
      mutate((s) => ({ ...s, fan: { ...s.fan, isentropicEfficiency: 1.2 } })),
      /fan.*isentropicEfficiency/,
    ],
    ['VBV fraction above 1', mutate((s) => ({ ...s, vbvOpenFraction: 1.5 })), /vbvOpenFraction/],
    [
      'unknown FADEC mode',
      mutate((s) => ({ ...s, fadec: { ...s.fadec, mode: 'turbo' } }) as unknown as CycleState),
      /fadec\.mode/,
    ],
    [
      'unknown start phase',
      mutate((s) => ({ ...s, startPhase: 'warp' }) as unknown as CycleState),
      /startPhase/,
    ],
  ])('flags %s', (_name, state, pattern) => {
    const problems = validateCycleState(state, SAMPLE_REFERENCE_SPEEDS);
    expect(problems.join('\n')).toMatch(pattern);
  });

  it('flags a missing station', () => {
    const s = sampleCycleState();
    const stations: Record<string, unknown> = { ...s.stations };
    delete stations['45'];
    const problems = validateCycleState(
      { ...s, stations: stations as CycleState['stations'] },
      SAMPLE_REFERENCE_SPEEDS,
    );
    expect(problems.join('\n')).toMatch(/station 45 is missing/);
  });

  it('requires a null TSFC exactly when there is no positive net thrust', () => {
    const s = sampleCycleState();
    expect(
      validateCycleState({ ...s, netThrustN: 0, tsfcKgPerNs: null }, SAMPLE_REFERENCE_SPEEDS),
    ).toEqual([]);
    expect(
      validateCycleState({ ...s, netThrustN: 0, tsfcKgPerNs: 1e-5 }, SAMPLE_REFERENCE_SPEEDS).join(
        '\n',
      ),
    ).toMatch(/tsfcKgPerNs must be null/);
    expect(
      validateCycleState({ ...s, tsfcKgPerNs: null }, SAMPLE_REFERENCE_SPEEDS).join('\n'),
    ).toMatch(/tsfcKgPerNs must be a number/);
  });
});
