// The app's sim core (src/shell/simCore.ts): commands in, immutable snapshots out (D0-2/D2-4),
// provenance derived from the models, never declared by the caller (W1F-N1).
import { describe, expect, it } from 'vitest';
import { createSimCore } from '../../../src/shell/simCore';
import { createMockCycle } from '../../../src/mocks/mockCycle';
import { createCycleModel } from '../../../src/cycle/model';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import type { FlowStatus } from '../../../src/contracts/sim';
import { DEFAULT_UI_STATE, renderStateOf } from '../../../src/contracts/ui';

const NO_FLOW: FlowStatus = {
  status: 'unavailable',
  error: null,
  mode: 'tracking',
  stats: null,
  reduction: null,
};

const mockCore = () => createSimCore({ cycle: createMockCycle(ENGINE_DEFINITION) });

describe('createSimCore', () => {
  it('starts at ground idle with the fuel lever at run and the view at its defaults', () => {
    const core = mockCore();
    expect(core.inputs.fuelLever).toBe('run');
    expect(core.inputs.throttleLever).toBe(0);
    expect(core.view).toEqual(renderStateOf(DEFAULT_UI_STATE));
    expect(core.state().n2Percent).toBeGreaterThan(55);
  });

  it('applies valid commands in seq order and echoes the last applied seq', () => {
    const core = mockCore();
    expect(core.command({ seq: 0, command: { type: 'setThrottle', lever: 0.5 } })).toEqual([]);
    expect(core.command({ seq: 1, command: { type: 'setViewMode', mode: 'cutaway' } })).toEqual(
      [],
    );
    const s = core.snapshot({ flow: NO_FLOW, flowSource: 'none' });
    expect(s.lastCommandSeq).toBe(1);
    expect(s.inputs.throttleLever).toBe(0.5);
    expect(s.view.viewMode).toBe('cutaway');
  });

  it('rejects an invalid command and a stale seq without applying them', () => {
    const core = mockCore();
    const bad = core.command({ seq: 0, command: { type: 'setThrottle', lever: 2 } });
    expect(bad.length).toBeGreaterThan(0);
    expect(core.inputs.throttleLever).toBe(0);
    expect(core.command({ seq: 4, command: { type: 'setThrottle', lever: 0.25 } })).toEqual([]);
    const stale = core.command({ seq: 3, command: { type: 'setThrottle', lever: 0.75 } });
    expect(stale.join()).toMatch(/seq 3/);
    expect(core.inputs.throttleLever).toBe(0.25);
    expect(core.snapshot({ flow: NO_FLOW, flowSource: 'none' }).lastCommandSeq).toBe(4);
  });

  it('says scenarios are not available instead of pretending to run one', () => {
    const core = mockCore();
    const p = core.command({ seq: 0, command: { type: 'runScenario', scenarioId: 'c12' } });
    expect(p.join()).toMatch(/scenario/i);
    expect(core.snapshot({ flow: NO_FLOW, flowSource: 'none' }).scenario.state).toBe('idle');
  });

  it('maps the switches onto the cycle inputs', () => {
    const core = mockCore();
    core.command({ seq: 0, command: { type: 'cutoff', cutoff: true } });
    core.command({ seq: 1, command: { type: 'start', engage: true } });
    core.command({ seq: 2, command: { type: 'ignition', mode: 'continuous' } });
    core.command({ seq: 3, command: { type: 'setBleed', customerBleedFraction: 0.05 } });
    expect(core.inputs).toMatchObject({
      fuelLever: 'cutoff',
      starter: true,
      ignition: 'continuous',
      customerBleedFraction: 0.05,
    });
  });

  it('a reset to shutdown puts the inputs back to a stopped engine', () => {
    const core = mockCore();
    core.command({ seq: 0, command: { type: 'setThrottle', lever: 1 } });
    core.command({ seq: 1, command: { type: 'reset', initial: 'shutdown' } });
    expect(core.inputs).toMatchObject({ fuelLever: 'cutoff', throttleLever: 0, starter: false });
    expect(core.state().n2Rpm).toBe(0);
  });

  it('merges partial render-state patches', () => {
    const core = mockCore();
    core.command({
      seq: 0,
      command: { type: 'setRenderState', render: { overlays: { tsDiagram: true }, quality: 'low' } },
    });
    expect(core.view.overlays.tsDiagram).toBe(true);
    expect(core.view.overlays.particles).toBe(DEFAULT_UI_STATE.overlays.particles);
    expect(core.view.quality).toBe('low');
  });

  it('advances the clock and the cycle by the clamped, time-scaled wall step', () => {
    const core = mockCore();
    core.command({ seq: 0, command: { type: 'setTimeScale', scale: 2 } });
    expect(core.advance(0.05)).toBeCloseTo(0.1, 12);
    // a background tab's 5 s gap is one 0.1 s wall step (MAX_WALL_STEP_S)
    expect(core.advance(5)).toBeCloseTo(0.2, 12);
    expect(core.snapshot({ flow: NO_FLOW, flowSource: 'none' }).clock.simTimeS).toBeCloseTo(
      0.3,
      12,
    );
  });

  it('pause stops the clock; stepFrame steps it once while paused', () => {
    const core = mockCore();
    core.command({ seq: 0, command: { type: 'pause', paused: true } });
    expect(core.advance(0.05)).toBe(0);
    const t0 = core.state().timeS;
    core.command({ seq: 1, command: { type: 'stepFrame', dtS: 0.02 } });
    expect(core.state().timeS).toBeCloseTo(t0 + 0.02, 12);
  });

  it('records the solver mode it was asked for', () => {
    const core = mockCore();
    core.command({ seq: 0, command: { type: 'setSolverMode', mode: 'physical' } });
    expect(core.solverMode).toBe('physical');
  });

  it('W1F-N1: the cycle source comes from the model, the flow source from the bound field', () => {
    const mock = mockCore().snapshot({ flow: NO_FLOW, flowSource: 'none' });
    expect(mock.sources).toEqual({ cycle: 'mock', flow: 'none' });
    const real = createSimCore({ cycle: createCycleModel() });
    const s = real.snapshot({ flow: NO_FLOW, flowSource: 'mock' });
    expect(s.sources).toEqual({ cycle: 'model', flow: 'mock' });
    expect(s.cycle.gasPathSolve.lostSolves).toBe(0);
  });

  it('publishes frozen snapshots whose version increments', () => {
    const core = mockCore();
    const a = core.snapshot({ flow: NO_FLOW, flowSource: 'none' });
    const b = core.snapshot({ flow: NO_FLOW, flowSource: 'none' });
    expect(b.version).toBe(a.version + 1);
    expect(Object.isFrozen(b.cycle)).toBe(true);
  });

  it('a throwing cycle model is reported by advance, not swallowed', () => {
    const cycle = createMockCycle(ENGINE_DEFINITION);
    const core = createSimCore({ cycle });
    cycle.step = () => {
      throw new Error('boom');
    };
    expect(() => core.advance(0.02)).toThrow(/boom/);
  });
});
