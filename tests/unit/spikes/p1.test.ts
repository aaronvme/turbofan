import { describe, expect, it } from 'vitest';
import {
  P1_BENCH,
  P1_PAGES,
  P1_PAGE_LOAD_MS,
  P1_RECORD,
  P1_SPIKE,
  p1Configs,
  p1TimeoutMs,
  p1Verdict,
  sceneOf,
  solverValidity,
  type P1Row,
} from '../../../spikes/lib/p1';
import { OFFICIAL, QUICK } from '../../../spikes/lib/protocol';
import { runTimeoutMs } from '../../../spikes/lib/timeout';

const healthy = {
  stateFinite: true,
  gpuErrors: [],
  nonFiniteResiduals: 0,
  solverStatus: { status: 'running', error: null },
};

describe('P1: the scene of a production run (W2I-I2 b)', () => {
  it("defaults to the W0 bench scene and takes 'app'", () => {
    expect(sceneOf(undefined)).toBe('bench');
    expect(sceneOf('bench')).toBe('bench');
    expect(sceneOf('app')).toBe('app');
  });

  it('throws on any other scene instead of measuring the bench scene silently', () => {
    expect(() => sceneOf('engine')).toThrow(/unknown bench scene "engine"/);
    expect(() => sceneOf(1)).toThrow(/unknown bench scene 1/);
    expect(() => sceneOf(null)).toThrow(/unknown bench scene null/);
  });

  it('loads the app scene on its own page and the bench scene on the throughput page', () => {
    expect(P1_PAGES.app).toBe('/spikes/p1/index.html');
    expect(P1_PAGES.bench).toBe('/spikes/throughput/index.html');
  });
});

describe('P1: the configurations (D4-64)', () => {
  it('the record row runs the production solver in the app scene, the W0 bench scene beside it', () => {
    const configs = p1Configs(OFFICIAL);
    expect(configs.map((c) => c.id)).toEqual([P1_RECORD, P1_BENCH, P1_SPIKE]);
    const byId = new Map(configs.map((c) => [c.id, c]));
    expect(byId.get(P1_RECORD)).toMatchObject({ solver: 'production', scene: 'app' });
    expect(byId.get(P1_BENCH)).toMatchObject({ solver: 'production', scene: 'bench' });
    // M34's calibration row: the W0 spike kernel at 130k, 16 x 8, in the bench scene
    expect(byId.get(P1_SPIKE)).toMatchObject({
      solver: 'spike',
      scene: 'bench',
      grid: { ni: 512, nj: 256 },
      tile: { x: 16, y: 8 },
    });
  });

  it('one group, so the three rotate together; every row carries the protocol', () => {
    const configs = p1Configs(QUICK);
    expect(new Set(configs.map((c) => c.group))).toEqual(new Set(['p1']));
    for (const c of configs) expect(c.protocol).toBe(QUICK);
    for (const c of configs) expect(sceneOf(c.scene)).toBe(c.scene);
  });

  it("a run's timeout adds the fresh page's load to the protocol's own", () => {
    const single = { ...OFFICIAL, runs: 1 };
    expect(p1TimeoutMs(single)).toBe(runTimeoutMs(single) + P1_PAGE_LOAD_MS);
  });
});

describe('P1: the solver-health gate (W2I-I2 a)', () => {
  it('a healthy run is valid', () => {
    expect(solverValidity(healthy)).toEqual({ valid: true, reasons: [], warnings: [] });
    // a spike run has no residual count or solver status
    expect(solverValidity({ stateFinite: true, gpuErrors: [] }).valid).toBe(true);
  });

  it('any GPU error makes the run INVALID, and the reason names the errors', () => {
    const v = solverValidity({
      ...healthy,
      gpuErrors: [
        { kind: 'validation', message: 'binding 3 is too small' },
        { kind: 'validation', message: 'b' },
        { kind: 'out-of-memory', message: 'c' },
        { kind: 'device-lost', message: 'd' },
      ],
    });
    expect(v.valid).toBe(false);
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0]).toMatch(/^4 GPU errors: validation: binding 3 is too small \| /);
    expect(v.reasons[0]).toMatch(/out-of-memory: c \(\+1 more\)$/);
    expect(
      solverValidity({ ...healthy, gpuErrors: [{ kind: 'internal', message: 'x' }] }).reasons,
    ).toEqual(['1 GPU error: internal: x']);
  });

  it('a non-finite state after the run makes it INVALID', () => {
    const v = solverValidity({ ...healthy, stateFinite: false });
    expect(v.valid).toBe(false);
    expect(v.reasons).toEqual(['non-finite solver state after the run']);
  });

  it('a non-finite residual on any frame makes it INVALID (a reset cannot hide a divergence)', () => {
    const v = solverValidity({ ...healthy, nonFiniteResiduals: 3 });
    expect(v.valid).toBe(false);
    expect(v.reasons).toEqual([
      'non-finite density residual on 3 frames (a divergence between state resets)',
    ]);
  });

  it('a production solver that is not running at the end makes it INVALID', () => {
    for (const status of ['diverged', 'lost', 'unavailable', 'initialising']) {
      const v = solverValidity({ ...healthy, solverStatus: { status, error: 'why' } });
      expect(v.valid, status).toBe(false);
      expect(v.reasons).toEqual([`the solver is ${status} at the end: why`]);
    }
    expect(
      solverValidity({ ...healthy, solverStatus: { status: 'lost', error: null } }).reasons,
    ).toEqual(['the solver is lost at the end']);
  });

  it('every reason is kept', () => {
    const v = solverValidity({
      stateFinite: false,
      gpuErrors: [{ kind: 'validation', message: 'x' }],
      nonFiniteResiduals: 1,
      solverStatus: { status: 'diverged', error: 'NaN' },
    });
    expect(v.reasons).toHaveLength(4);
  });
});

describe('P1: the verdict (PHYSICS P1, D4-64)', () => {
  const ok = { valid: true, reasons: [], warnings: [] };
  const row = (id: string, itPerSec: number): P1Row => ({
    id,
    validity: ok,
    aggregate: { itPerSec, solverMsPerIt: 1000 / itPerSec / 2, fps: 60 },
  });

  it('PASS or FAIL on the app scene row alone; the bench scene is beside it, never the verdict', () => {
    const pass = p1Verdict([row(P1_RECORD, 151), row(P1_BENCH, 90)], 150, false);
    expect(pass[0]).toMatch(
      /^P1 of record \(D4-64: >= 150 it\/s .*app's 1080p engine scene\): PASS at 151 it\/s/,
    );
    expect(pass[1]).toMatch(/W0 bench scene.*not the record\): 90 it\/s/);
    expect(pass.join('\n')).not.toMatch(/indicative/);
    const fail = p1Verdict([row(P1_RECORD, 120), row(P1_BENCH, 200)], 150, false);
    expect(fail[0]).toMatch(/: FAIL at 120 it\/s .*a miss counts only after a quiet re-run/);
    expect(fail[1]).toMatch(/: 200 it\/s/);
    expect(p1Verdict([row(P1_RECORD, 150)], 150, false)[0]).toMatch(/PASS at 150 it\/s/);
  });

  it('--quick is indicative only', () => {
    const lines = p1Verdict([row(P1_RECORD, 151)], 150, true);
    expect(lines[0]).toMatch(/PASS at 151 it\/s.* - indicative only \(--quick\)$/);
  });

  it('an INVALID record row has no verdict and says why', () => {
    const lines = p1Verdict(
      [
        {
          id: P1_RECORD,
          validity: { valid: false, reasons: ['repetition 1: 1 GPU error: x'], warnings: [] },
          aggregate: null,
        },
        row(P1_BENCH, 160),
      ],
      150,
      false,
    );
    expect(lines[0]).toBe('P1 of record: INVALID, no verdict (repetition 1: 1 GPU error: x)');
    expect(lines.join('\n')).not.toMatch(/PASS|FAIL/);
    expect(lines[1]).toMatch(/: 160 it\/s/);
  });

  it('a row left out (--only) is said to be not run', () => {
    const lines = p1Verdict([row(P1_BENCH, 160)], 150, false);
    expect(lines[0]).toBe(`P1 of record: ${P1_RECORD} not run, no verdict`);
    const noBench = p1Verdict([row(P1_RECORD, 160)], 150, false);
    expect(noBench[1]).toMatch(new RegExp(`${P1_BENCH} not run`));
    const invalidBench = p1Verdict(
      [
        row(P1_RECORD, 160),
        { id: P1_BENCH, validity: { valid: false, reasons: ['r'], warnings: [] }, aggregate: null },
      ],
      150,
      false,
    );
    expect(invalidBench[1]).toMatch(/INVALID \(r\)$/);
  });
});
