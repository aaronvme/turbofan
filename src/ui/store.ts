// The overlay's store (zustand): the latest snapshot and diagnostics from the worker, the
// operating-point trails, and the UI-only state. Commands go out through `send`, stamped with an
// increasing seq (the worker echoes the last applied one in the snapshot).

import { create } from 'zustand';
import type { SimCommand, SimSnapshot } from '../contracts/sim';
import { DEFAULT_UI_STATE, type UnitSystem } from '../contracts/ui';
import type { Anchor } from '../hud/callouts';
import { pushTrail, type MapPoint } from '../hud/compressorMap';
import type { AppDiagnostics, CameraPresetId, FieldChoice, ToWorker } from '../shell/protocol';
import type { OrbitInput } from '../shell/orbit';

export const TRAIL_POINTS = 120;

export type Connection =
  | { readonly state: 'booting' }
  | { readonly state: 'running'; readonly adapter: string }
  | { readonly state: 'unsupported'; readonly message: string }
  | { readonly state: 'lost'; readonly message: string }
  | { readonly state: 'failed'; readonly message: string };

export type PanelId = 'maps' | 'ts' | 'stations' | 'fidelity' | 'diagnostics';

export interface AppStore {
  connection: Connection;
  snapshot: SimSnapshot | null;
  diagnostics: AppDiagnostics | null;
  anchors: readonly Anchor[];
  trails: { fan: MapPoint[]; hpc: MapPoint[] };
  gpuErrors: string[];
  refused: string[];
  units: UnitSystem;
  field: FieldChoice;
  panels: Record<PanelId, boolean>;
  /** The transport to the worker (set by the client; a no-op before it exists). */
  post: (m: ToWorker) => void;
  send: (c: SimCommand) => void;
  orbit: (i: OrbitInput) => void;
  camera: (p: CameraPresetId) => void;
  setField: (f: FieldChoice) => void;
  setUnits: (u: UnitSystem) => void;
  togglePanel: (p: PanelId) => void;
  receive: (m: import('../shell/protocol').FromWorker) => void;
  setConnection: (c: Connection) => void;
}

let seq = 0;

export const useApp = create<AppStore>((set, get) => ({
  connection: { state: 'booting' },
  snapshot: null,
  diagnostics: null,
  anchors: [],
  trails: { fan: [], hpc: [] },
  gpuErrors: [],
  refused: [],
  units: DEFAULT_UI_STATE.units,
  field: 'mock',
  panels: { maps: true, ts: true, stations: true, fidelity: false, diagnostics: false },
  post: () => undefined,
  send: (command) => {
    get().post({ type: 'command', message: { seq: seq++, command } });
  },
  orbit: (input) => {
    get().post({ type: 'orbit', input });
  },
  camera: (preset) => {
    get().post({ type: 'camera', preset });
  },
  setField: (field) => {
    set({ field });
    get().post({ type: 'field', source: field });
  },
  setUnits: (units) => {
    set({ units });
  },
  togglePanel: (p) => {
    set((s) => ({ panels: { ...s.panels, [p]: !s.panels[p] } }));
  },
  setConnection: (connection) => {
    set({ connection });
  },
  receive: (m) => {
    switch (m.type) {
      case 'ready':
        set({ connection: { state: 'running', adapter: m.adapter } });
        return;
      case 'snapshot': {
        const { cycle } = m.snapshot;
        set((s) => ({
          snapshot: m.snapshot,
          diagnostics: m.diagnostics,
          anchors: m.anchors,
          trails: {
            fan: pushTrail(s.trails.fan, cycle.fan, TRAIL_POINTS),
            hpc: pushTrail(s.trails.hpc, cycle.hpc, TRAIL_POINTS),
          },
          refused: m.refused.length > 0 ? [...s.refused, ...m.refused].slice(-8) : s.refused,
        }));
        return;
      }
      case 'gpu-error':
        set((s) => ({ gpuErrors: [...s.gpuErrors, m.message].slice(-8) }));
        return;
      case 'device-lost':
        set({ connection: { state: 'lost', message: m.message } });
        return;
      case 'fatal':
        set((s) => ({
          connection:
            s.connection.state === 'running' && m.message.startsWith('cycle step')
              ? s.connection
              : { state: 'failed', message: m.message },
          gpuErrors: [...s.gpuErrors, m.message].slice(-8),
        }));
        return;
    }
  },
}));
