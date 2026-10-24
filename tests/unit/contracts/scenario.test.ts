import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  evaluatePredicate,
  finalizeOutcomes,
  initialOutcomeResults,
  resolvePath,
  updateOutcomes,
  validateScenario,
  type ExpectedOutcome,
  type Predicate,
  type Scenario,
} from '../../../src/contracts/scenario';
import type { SimSnapshot } from '../../../src/contracts/sim';
import { sampleSnapshot } from './fixtures/snapshotFixture';

/** The 14 CFR 33.73(b) acceleration check written as data. */
const takeoffAccel: Scenario = {
  id: 'accel-33-73',
  title: 'Idle to takeoff',
  description: 'Slam from idle to full lever; 95 % rated thrust within 5 s.',
  initial: 'groundIdle',
  ambient: ISA_SLS,
  durationS: 12,
  timeline: [
    { atS: 1, command: { type: 'setThrottle', lever: 1 } },
    { atS: 11, command: { type: 'setThrottle', lever: 0 } },
  ],
  outcomes: [
    {
      id: 'reach-95',
      description: '95 % of rated takeoff thrust within 5 s of the slam',
      window: { kind: 'eventually', fromS: 1, byS: 6 },
      predicate: { kind: 'compare', path: ['cycle', 'netThrustN'], op: '>=', value: 115_000 },
      thresholdId: 'C5',
    },
    {
      id: 'no-surge',
      description: 'No surge during the acceleration',
      window: { kind: 'always', fromS: 0, toS: 12 },
      predicate: { kind: 'compare', path: ['cycle', 'flags', 'surge'], op: '==', value: false },
      thresholdId: null,
    },
    {
      id: 'egt-below-redline',
      description: 'EGT below the redline at 8 s',
      window: { kind: 'at', atS: 8 },
      predicate: { kind: 'between', path: ['cycle', 'egtDisplayedK'], min: 0, max: 1223.15 },
      thresholdId: 'C6',
    },
  ],
};

const [O0, O1, O2] = takeoffAccel.outcomes as readonly [
  ExpectedOutcome,
  ExpectedOutcome,
  ExpectedOutcome,
];

function withCycle(patch: Partial<SimSnapshot['cycle']>): SimSnapshot {
  const s = sampleSnapshot();
  return { ...s, cycle: { ...s.cycle, ...patch } };
}

describe('validateScenario', () => {
  it('accepts a well-formed scenario', () => {
    expect(validateScenario(takeoffAccel)).toEqual([]);
  });

  it.each<[string, Scenario, RegExp]>([
    [
      'steps out of time order',
      { ...takeoffAccel, timeline: [...takeoffAccel.timeline].reverse() },
      /timeline\[1\] at 1 s must not be before timeline\[0\]/,
    ],
    [
      'a negative step time',
      { ...takeoffAccel, timeline: [{ atS: -1, command: { type: 'stopScenario' } }] },
      /timeline\[0\]\.atS/,
    ],
    [
      'a step after the end',
      { ...takeoffAccel, timeline: [{ atS: 13, command: { type: 'stopScenario' } }] },
      /after durationS/,
    ],
    [
      'an invalid command',
      { ...takeoffAccel, timeline: [{ atS: 1, command: { type: 'setThrottle', lever: 3 } }] },
      /timeline\[0\]\.command.*lever/,
    ],
    [
      'a nested runScenario',
      {
        ...takeoffAccel,
        timeline: [{ atS: 1, command: { type: 'runScenario', scenarioId: 'other' } }],
      },
      /cannot start another scenario/,
    ],
    [
      'duplicate outcome ids',
      { ...takeoffAccel, outcomes: [O0, O0] },
      /duplicate outcome id "reach-95"/,
    ],
    [
      'an empty path',
      {
        ...takeoffAccel,
        outcomes: [
          {
            ...O0,
            predicate: { kind: 'compare', path: [], op: '>', value: 1 },
          },
        ],
      },
      /path must not be empty/,
    ],
    [
      'an unknown path root',
      {
        ...takeoffAccel,
        outcomes: [
          {
            ...O0,
            predicate: { kind: 'compare', path: ['engine', 'n1'], op: '>', value: 1 },
          },
        ],
      },
      /unknown snapshot root "engine"/,
    ],
    [
      'a window beyond the end',
      {
        ...takeoffAccel,
        outcomes: [{ ...O0, window: { kind: 'eventually', fromS: 0, byS: 20 } }],
      },
      /window.*durationS/,
    ],
    [
      'an inverted window',
      {
        ...takeoffAccel,
        outcomes: [{ ...O1, window: { kind: 'always', fromS: 5, toS: 2 } }],
      },
      /window.*fromS/,
    ],
    [
      'an inverted between',
      {
        ...takeoffAccel,
        outcomes: [
          {
            ...O2,
            predicate: { kind: 'between', path: ['cycle', 'egtDisplayedK'], min: 5, max: 1 },
          },
        ],
      },
      /min.*max/,
    ],
    [
      'an empty all',
      {
        ...takeoffAccel,
        outcomes: [{ ...O2, predicate: { kind: 'all', of: [] } }],
      },
      /must have at least one/,
    ],
    [
      'an unknown threshold id',
      {
        ...takeoffAccel,
        outcomes: [{ ...O0, thresholdId: 'Z9' } as unknown as ExpectedOutcome],
      },
      /thresholdId "Z9"/,
    ],
    ['no duration', { ...takeoffAccel, durationS: 0 }, /durationS/],
    ['an empty id', { ...takeoffAccel, id: '' }, /id/],
    [
      'a bad ambient',
      { ...takeoffAccel, ambient: { pressurePa: 0, temperatureK: 288, machNumber: 0 } },
      /ambient/,
    ],
  ])('rejects %s', (_name, scenario, pattern) => {
    expect(validateScenario(scenario).join('\n')).toMatch(pattern);
  });

  it('checks paths against a sample snapshot when one is given', () => {
    const bad: Scenario = {
      ...takeoffAccel,
      outcomes: [
        {
          ...O0,
          predicate: { kind: 'compare', path: ['cycle', 'thrustt'], op: '>', value: 1 },
        },
      ],
    };
    expect(validateScenario(takeoffAccel, sampleSnapshot())).toEqual([]);
    expect(validateScenario(bad, sampleSnapshot()).join()).toMatch(
      /cycle\.thrustt does not resolve/,
    );
  });
});

describe('predicates on snapshots', () => {
  const snap = sampleSnapshot();

  it('resolves array paths, including station ids that contain a dot', () => {
    expect(resolvePath(snap, ['cycle', 'stations', '49.5', 'ttK'])).toBe(
      snap.cycle.stations['49.5'].ttK,
    );
    expect(resolvePath(snap, ['cycle', 'nothing'])).toBeUndefined();
    expect(resolvePath(snap, ['cycle', 'n1Rpm', 'deeper'])).toBeUndefined();
    expect(resolvePath(snap, ['scenario', 'outcomes', '0', 'id'])).toBe('reach-95');
  });

  it.each<[Predicate, boolean]>([
    [{ kind: 'compare', path: ['cycle', 'n1Percent'], op: '>', value: 80 }, true],
    [{ kind: 'compare', path: ['cycle', 'n1Percent'], op: '<', value: 80 }, false],
    [{ kind: 'compare', path: ['cycle', 'n1Percent'], op: '>=', value: 85 }, true],
    [{ kind: 'compare', path: ['cycle', 'n1Percent'], op: '<=', value: 84.9 }, false],
    [{ kind: 'compare', path: ['cycle', 'n1Percent'], op: '==', value: 85 }, true],
    [{ kind: 'compare', path: ['cycle', 'n1Percent'], op: '!=', value: 85 }, false],
    [{ kind: 'compare', path: ['cycle', 'fadec', 'mode'], op: '==', value: 'run' }, true],
    [{ kind: 'compare', path: ['cycle', 'flags', 'surge'], op: '==', value: false }, true],
    [{ kind: 'compare', path: ['cycle', 'fadec', 'mode'], op: '>', value: 'a' }, false],
    [{ kind: 'compare', path: ['cycle', 'missing'], op: '!=', value: 1 }, false],
    [{ kind: 'between', path: ['cycle', 'n2Percent'], min: 90, max: 100 }, true],
    [{ kind: 'between', path: ['cycle', 'n2Percent'], min: 96, max: 100 }, false],
    [{ kind: 'between', path: ['cycle', 'fadec', 'mode'], min: 0, max: 1 }, false],
    [
      {
        kind: 'all',
        of: [
          { kind: 'compare', path: ['cycle', 'n1Percent'], op: '>', value: 1 },
          { kind: 'compare', path: ['cycle', 'n2Percent'], op: '>', value: 1 },
        ],
      },
      true,
    ],
    [
      {
        kind: 'any',
        of: [
          { kind: 'compare', path: ['cycle', 'n1Percent'], op: '<', value: 1 },
          { kind: 'compare', path: ['cycle', 'n2Percent'], op: '>', value: 1 },
        ],
      },
      true,
    ],
    [
      { kind: 'not', of: { kind: 'compare', path: ['cycle', 'n1Percent'], op: '>', value: 1 } },
      false,
    ],
  ])('%j -> %s', (predicate, expected) => {
    expect(evaluatePredicate(predicate, snap)).toBe(expected);
  });
});

describe('outcome tracking', () => {
  const [reach95, noSurge, egtAt8] = [O0, O1, O2];
  const one = (outcome: ExpectedOutcome): Scenario => ({ ...takeoffAccel, outcomes: [outcome] });

  it('starts with every outcome pending', () => {
    expect(initialOutcomeResults(takeoffAccel).map((r) => r.verdict)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('"eventually" passes the first time the predicate holds inside the window', () => {
    const sc = one(reach95);
    let r = initialOutcomeResults(sc);
    r = updateOutcomes(sc, r, withCycle({ netThrustN: 120_000 }), 0.5); // before the window
    expect(r[0]?.verdict).toBe('pending');
    r = updateOutcomes(sc, r, withCycle({ netThrustN: 60_000 }), 2);
    expect(r[0]?.verdict).toBe('pending');
    r = updateOutcomes(sc, r, withCycle({ netThrustN: 116_000 }), 4.5);
    expect(r[0]).toMatchObject({ verdict: 'passed', decidedAtS: 4.5 });
    r = updateOutcomes(sc, r, withCycle({ netThrustN: 10 }), 5); // decided outcomes stay decided
    expect(r[0]?.verdict).toBe('passed');
  });

  it('"eventually" fails once the window closes without the predicate holding', () => {
    const sc = one(reach95);
    let r = initialOutcomeResults(sc);
    r = updateOutcomes(sc, r, withCycle({ netThrustN: 100_000 }), 5.9);
    expect(r[0]?.verdict).toBe('pending');
    r = updateOutcomes(sc, r, withCycle({ netThrustN: 100_000 }), 6.1);
    expect(r[0]).toMatchObject({ verdict: 'failed', decidedAtS: 6.1 });
    expect(r[0]?.detail).toMatch(/did not hold by 6 s/);
  });

  it('"always" fails at the first violation and passes when the window closes', () => {
    const sc = one(noSurge);
    const surging = (on: boolean): SimSnapshot => {
      const s = sampleSnapshot();
      return { ...s, cycle: { ...s.cycle, flags: { ...s.cycle.flags, surge: on } } };
    };
    let r = updateOutcomes(sc, initialOutcomeResults(sc), surging(false), 3);
    expect(r[0]?.verdict).toBe('pending');
    const failed = updateOutcomes(sc, r, surging(true), 4);
    expect(failed[0]).toMatchObject({ verdict: 'failed', decidedAtS: 4 });
    r = updateOutcomes(sc, r, surging(false), 12);
    expect(r[0]).toMatchObject({ verdict: 'passed', decidedAtS: 12 });
  });

  it('"at" is decided on the first snapshot at or after its time', () => {
    const sc = one(egtAt8);
    let r = updateOutcomes(sc, initialOutcomeResults(sc), withCycle({ egtDisplayedK: 2000 }), 7.9);
    expect(r[0]?.verdict).toBe('pending');
    r = updateOutcomes(sc, r, withCycle({ egtDisplayedK: 1100 }), 8.02);
    expect(r[0]).toMatchObject({ verdict: 'passed', decidedAtS: 8.02 });
    const hot = updateOutcomes(
      sc,
      initialOutcomeResults(sc),
      withCycle({ egtDisplayedK: 1300 }),
      8,
    );
    expect(hot[0]?.verdict).toBe('failed');
  });

  it('finalizes pending outcomes when the scenario ends', () => {
    const r = finalizeOutcomes(takeoffAccel, initialOutcomeResults(takeoffAccel), 12);
    expect(r.map((x) => x.verdict)).toEqual(['failed', 'passed', 'failed']);
    const early = finalizeOutcomes(takeoffAccel, initialOutcomeResults(takeoffAccel), 6);
    expect(early[1]?.verdict).toBe('failed'); // "always" window not covered before the end
    expect(early[1]?.detail).toMatch(/ended at 6 s/);
  });

  it('is a pure reducer: inputs are not mutated', () => {
    const r0 = initialOutcomeResults(takeoffAccel);
    const copy = structuredClone(r0);
    updateOutcomes(takeoffAccel, r0, withCycle({ netThrustN: 120_000 }), 2);
    expect(r0).toEqual(copy);
  });
});
