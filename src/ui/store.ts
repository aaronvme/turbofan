// The overlay's store (zustand): the latest snapshot and diagnostics from the worker, the
// operating-point trails, and the UI-only state. Commands go out through `send`, stamped with an
// increasing seq (the worker echoes the last applied one in the snapshot).

import { create } from 'zustand';
import type { SimCommand, SimSnapshot } from '../contracts/sim';
import { DEFAULT_UI_STATE, type UnitSystem } from '../contracts/ui';
import type { AxialAnchor, Rect } from '../hud/callouts';
import { pushTrail, type MapPoint } from '../hud/compressorMap';
import type {
  AppDiagnostics,
  CameraPresetId,
  FieldChoice,
  FromWorker,
  ToWorker,
} from '../shell/protocol';
import type { OrbitInput } from '../shell/orbit';

export const TRAIL_POINTS = 120;

export type Connection =
  | { readonly state: 'booting' }
  | { readonly state: 'running'; readonly adapter: string }
  | { readonly state: 'unsupported'; readonly message: string }
  | { readonly state: 'lost'; readonly message: string }
  | { readonly state: 'failed'; readonly message: string };

export type PanelId = 'maps' | 'ts' | 'stations' | 'fidelity' | 'diagnostics';

/** The engine sound (D5-4): off until the viewer turns it on; the controller's state. */
export type SoundStatus = 'off' | 'starting' | 'on' | 'failed';

export interface SoundSettings {
  readonly on: boolean;
  /** The volume control, 0 .. 1 (the gain is its square, src/audio/params.ts volumeGain). */
  readonly volume: number;
  readonly status: SoundStatus;
  /** Why the sound could not start (null: it did, or it was not asked to). */
  readonly error: string | null;
}

export const DEFAULT_SOUND: SoundSettings = { on: false, volume: 0.5, status: 'off', error: null };

export interface AppStore {
  connection: Connection;
  snapshot: SimSnapshot | null;
  diagnostics: AppDiagnostics | null;
  anchors: readonly AxialAnchor[];
  /** D4-92 (zz): the engine's screen box, for the cut views' label rows. */
  engineBox: Rect | null;
  /** W2A-N31: the framed view's content box (null: the view is not framed). */
  framedBox: Rect | null;
  /** Critic pass 18's visual note 2: Schlieren's jet box, which no label covers (null: none). */
  jetBox: Rect | null;
  /** D5-4: the camera position of the last snapshot, the engine sound's listener (null: none). */
  listener: readonly [number, number, number] | null;
  sound: SoundSettings;
  trails: { fan: MapPoint[]; hpc: MapPoint[] };
  /** The last 8 GPU errors the worker posted, and how many it posted in all. */
  gpuErrors: string[];
  gpuErrorCount: number;
  /** W2A-I1: why the sim stopped (a thrown cycle step); null while it runs. */
  simStopped: string | null;
  refused: string[];
  units: UnitSystem;
  field: FieldChoice;
  panels: Record<PanelId, boolean>;
  /** The transport to the worker (set by the client; a no-op before it exists). */
  post: (m: ToWorker) => void;
  /** Sends a command; its seq (the snapshot's lastCommandSeq reaches it once applied). */
  send: (c: SimCommand) => number;
  orbit: (i: OrbitInput) => void;
  camera: (p: CameraPresetId) => void;
  setField: (f: FieldChoice) => void;
  setUnits: (u: UnitSystem) => void;
  togglePanel: (p: PanelId) => void;
  setSound: (s: Partial<SoundSettings>) => void;
  openPanel: (p: PanelId) => void;
  /**
   * A new worker (W2A-N11): forgets the last one's connection, snapshot, diagnostics, trails,
   * faults and field choice, so nothing of it passes for the new one's. The viewer's own
   * settings (units, panels, sound) stay.
   */
  resetSession: () => void;
  receive: (m: FromWorker) => void;
  setConnection: (c: Connection) => void;
}

let seq = 0;

export const useApp = create<AppStore>((set, get) => ({
  connection: { state: 'booting' },
  snapshot: null,
  diagnostics: null,
  anchors: [],
  engineBox: null,
  framedBox: null,
  jetBox: null,
  listener: null,
  sound: DEFAULT_SOUND,
  trails: { fan: [], hpc: [] },
  gpuErrors: [],
  gpuErrorCount: 0,
  simStopped: null,
  refused: [],
  units: DEFAULT_UI_STATE.units,
  field: 'mock',
  panels: { maps: true, ts: true, stations: true, fidelity: false, diagnostics: false },
  post: () => undefined,
  send: (command) => {
    const s = seq++;
    get().post({ type: 'command', message: { seq: s, command } });
    return s;
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
  setSound: (patch) => {
    set((s) => ({ sound: { ...s.sound, ...patch } }));
  },
  togglePanel: (p) => {
    set((s) => ({ panels: { ...s.panels, [p]: !s.panels[p] } }));
  },
  openPanel: (p) => {
    set((s) => ({ panels: { ...s.panels, [p]: true } }));
  },
  resetSession: () => {
    set({
      connection: { state: 'booting' },
      snapshot: null,
      diagnostics: null,
      anchors: [],
      engineBox: null,
      framedBox: null,
      jetBox: null,
      listener: null,
      trails: { fan: [], hpc: [] },
      gpuErrors: [],
      gpuErrorCount: 0,
      simStopped: null,
      refused: [],
      field: 'mock',
    });
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
          engineBox: m.engineBox,
          framedBox: m.framedBox,
          jetBox: m.jetBox,
          listener: m.listener,
          trails: {
            fan: pushTrail(s.trails.fan, cycle.fan, TRAIL_POINTS),
            hpc: pushTrail(s.trails.hpc, cycle.hpc, TRAIL_POINTS),
          },
          refused: m.refused.length > 0 ? [...s.refused, ...m.refused].slice(-8) : s.refused,
        }));
        return;
      }
      case 'gpu-error':
        set((s) => ({
          gpuErrors: [...s.gpuErrors, m.message].slice(-8),
          gpuErrorCount: s.gpuErrorCount + 1,
        }));
        return;
      case 'device-lost':
        set({ connection: { state: 'lost', message: m.message } });
        return;
      case 'sim-stopped':
        // the worker keeps rendering the frozen state: the connection stays up, the sim does not
        set({ simStopped: m.message });
        return;
      case 'fatal':
        set({ connection: { state: 'failed', message: m.message } });
        return;
    }
  },
}));
