// The app shell (D2-4): the engine view is an OffscreenCanvas owned by the sim worker; this React
// overlay on the main thread reads the worker's snapshots from the store and sends commands.
// Keyboard: 1-5 switch the view mode, the focused view orbits with the arrow keys.

import { useEffect, useRef } from 'react';
import { startClient } from '../app/client';
import type { CycleChoice } from '../shell/protocol';
import { VIEW_MODES } from '../contracts/ui';
import { EngineDisplay, ThrottleQuadrant } from './instruments';
import { MapsPanel, StationStrip, TsPanel } from './charts';
import {
  Annunciators,
  Callouts,
  DiagnosticsPanel,
  FidelityPanel,
  PanelToggles,
  TopBar,
} from './panels';
import { ViewDock } from './dock';
import { useApp } from './store';

function Viewport({ cycle }: { readonly cycle: CycleChoice | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    // a fresh canvas per mount: transferControlToOffscreen works once per canvas (StrictMode
    // mounts twice in development)
    const canvas = document.createElement('canvas');
    canvas.className = 'view';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      'Engine view. Drag or use the arrow keys to orbit, plus and minus to zoom, brackets to pan.',
    );
    el.appendChild(canvas);
    const client = startClient(canvas, cycle === undefined ? {} : { cycle });
    return () => {
      client.dispose();
      canvas.remove();
    };
  }, [cycle]);
  return <div className="viewport" ref={host} />;
}

export function Status() {
  const c = useApp((s) => s.connection);
  if (c.state === 'running') return null;
  if (c.state === 'booting')
    return (
      <div className="boot" role="status">
        <span className="spinner" aria-hidden="true" />
        Starting the GPU, the cycle model and the solver…
      </div>
    );
  const title =
    c.state === 'lost'
      ? 'The GPU device was lost'
      : c.state === 'unsupported'
        ? 'WebGPU is required'
        : 'The simulation stopped';
  return (
    <div className="fault" role="alert">
      <h2>{title}</h2>
      <p>{c.message}</p>
      <button
        type="button"
        onClick={() => {
          location.reload();
        }}
      >
        Reload
      </button>
    </div>
  );
}

export function Overlay() {
  const snapshot = useApp((s) => s.snapshot);
  const diagnostics = useApp((s) => s.diagnostics);
  const panels = useApp((s) => s.panels);
  const send = useApp((s) => s.send);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const k = Number(e.key);
      const mode = Number.isInteger(k) ? VIEW_MODES[k - 1] : undefined;
      if (mode !== undefined) send({ type: 'setViewMode', mode });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [send]);
  if (snapshot === null) return null;
  const drawer = panels.diagnostics || panels.fidelity;
  return (
    <div className="overlay">
      <TopBar snapshot={snapshot} />
      {snapshot.view.overlays.callouts && <Callouts snapshot={snapshot} />}
      <aside className="col left">
        <EngineDisplay snapshot={snapshot} />
        <ThrottleQuadrant snapshot={snapshot} />
      </aside>
      {/* the view: the annunciators over it, the drawer at its right edge, the dock under it */}
      <div className="center">
        <Annunciators snapshot={snapshot} diagnostics={diagnostics} />
        {drawer && (
          <div className="drawer">
            {panels.diagnostics && (
              <DiagnosticsPanel snapshot={snapshot} diagnostics={diagnostics} />
            )}
            {panels.fidelity && <FidelityPanel />}
          </div>
        )}
        <ViewDock snapshot={snapshot} diagnostics={diagnostics} />
      </div>
      <aside className="col right">
        <PanelToggles />
        {panels.maps && <MapsPanel snapshot={snapshot} />}
        {panels.ts && <TsPanel snapshot={snapshot} />}
      </aside>
      {panels.stations && <StationStrip snapshot={snapshot} />}
    </div>
  );
}

export function App({
  cycle,
}: {
  /** The worker's cycle model (default the reference calibration; tests pick the held case). */
  readonly cycle?: CycleChoice;
} = {}) {
  return (
    <main className="app">
      <h1 className="sr-only">Turbofan: a CFM56-7B27-class engine, simulated</h1>
      <Viewport cycle={cycle} />
      <Overlay />
      <Status />
    </main>
  );
}
