// The RTL suite's fixtures: a real snapshot from the sim core on the real cycle model (ground
// idle, as the app boots), the worker's diagnostics beside it, and a store whose transport is a
// spy, so a test reads what the overlay sent.
import { vi } from 'vitest';
import type { FlowFieldSource } from '../../../src/contracts/flow';
import type { FlowStatus, SimCommand, SimSnapshot } from '../../../src/contracts/sim';
import type { ViewMode } from '../../../src/contracts/ui';
import { createCycleModel } from '../../../src/cycle/model';
import type { FlowLinkState } from '../../../src/flow/viz/fieldLink';
import type { AppDiagnostics, ToWorker } from '../../../src/shell/protocol';
import { createSimCore } from '../../../src/shell/simCore';
import { useApp } from '../../../src/ui/store';

export const RUNNING: FlowStatus = {
  status: 'running',
  error: null,
  mode: 'tracking',
  stats: {
    iterationsThisStep: 12,
    totalIterations: 4800,
    gpuTimeMs: 3.1,
    residualDensityL2: 2.4e-4,
    physicalTimeS: 0,
  },
  reduction: null,
};

export const MOCK_LINK: FlowLinkState = { asked: 'mock', coupling: 'mock', fallback: null };

/** A snapshot of the real model at ground idle, in `mode`, with the field drawn from `flow`. */
export function snapshotOf(
  o: { mode?: ViewMode; flow?: FlowFieldSource; status?: FlowStatus } = {},
): SimSnapshot {
  const core = createSimCore({ cycle: createCycleModel() });
  if (o.mode !== undefined)
    core.command({ seq: 0, command: { type: 'setViewMode', mode: o.mode } });
  core.advance(1 / 60);
  return core.snapshot({ flow: o.status ?? RUNNING, flowSource: o.flow ?? 'mock' });
}

export function diagnosticsOf(o: Partial<AppDiagnostics> = {}): AppDiagnostics {
  return {
    budget: {
      renderGpuMs: 6.4,
      flowVisualsGpuMs: 0.6,
      solverGpuMs: null,
      solverBudgetMs: 5,
      solverIterations: 0,
      msPerIteration: 0.21,
      cycleCpuMs: 0.4,
      cycleCpuMaxMs: 0.9,
      cycleCpuHeldMs: null,
      frameCpuMs: 2.1,
      frameCpuMaxMs: 3.4,
      frameCpuHeldMs: null,
      mockRasterMs: 4.2,
      mockRasters: 3,
      fps: 60,
    },
    field: MOCK_LINK,
    raster: { onFrame: false, lastError: null },
    view: { mode: 'realistic', settledFrames: 40, preparing: null },
    warm: {
      warm: ['realistic', 'realistic+tracers'],
      queue: [],
      frames: 0,
      cpuMaxMs: 0,
      slowest: '',
      gaveUp: [],
    },
    backingStore: { width: 1994, height: 1039, dpr: 1.0387 },
    warmUpMs: 2100,
    warmUpSteps: [],
    lostSolveCause: null,
    errors: [],
    adapter: 'intel arc',
    triangles: 1_200_000,
    renderScale: 1,
    ...o,
  };
}

const initial = useApp.getState();

/** Resets the store and puts the snapshot in it; the returned spy is the worker transport. */
export function mount(snapshot: SimSnapshot, diagnostics: AppDiagnostics = diagnosticsOf()) {
  const post = vi.fn<(m: ToWorker) => void>();
  useApp.setState(
    {
      ...initial,
      connection: { state: 'running', adapter: 'test' },
      snapshot,
      diagnostics,
      post,
    },
    true,
  );
  return post;
}

/** The commands the overlay sent, in order. */
export function sentCommands(post: ReturnType<typeof mount>): SimCommand[] {
  return post.mock.calls.flatMap(([m]) => (m.type === 'command' ? [m.message.command] : []));
}
