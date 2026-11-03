// The view dock under the engine: the flow legend (the dataviz rules: a labelled continuous bar
// from the very LUT the plane samples, round ticks, the unit, and the data's provenance on it,
// D4-82), the camera presets, the tracers (D4-83: Realistic has none unless asked for) and the
// Data view's cut-plane field (the contract's fields the plane can draw), and the engine sound's
// switch and volume (D5-4: off until the viewer turns it on).

import { useMemo } from 'react';
import type { SimSnapshot } from '../contracts/sim';
import type { FieldId } from '../contracts/ui';
import type { FlowCoupling } from '../contracts/flow';
import { legendFor, provenanceLabel } from '../flow/viz/legend';
import type { AppDiagnostics, CameraPresetId } from '../shell/protocol';
import {
  CUT_PLANE_FIELDS,
  cutPlaneQuantity,
  flowModeFor,
  tracersAvailable,
} from '../shell/viewState';
import { SoundControls } from './sound';
import { useApp } from './store';

const CAMERAS: readonly [CameraPresetId, string][] = [
  ['threeQuarterFront', '¾ front'],
  ['side', 'Side'],
  ['hero', 'Hero'],
  ['hotSection', 'Hot section'],
];

const FIELD_LABEL: Readonly<Partial<Record<FieldId, string>>> = {
  pressure: 'Pressure',
  density: 'Density',
  temperature: 'Temperature',
  mach: 'Mach',
};

/** The drawn field's coupling: the link's (D4-82), else what the snapshot's source implies. */
function couplingOf(s: SimSnapshot, d: AppDiagnostics | null): FlowCoupling {
  return d?.field?.coupling ?? (s.sources.flow === 'solver' ? 'uncoupled' : 'mock');
}

export function FlowLegend({
  snapshot,
  diagnostics,
}: {
  readonly snapshot: SimSnapshot;
  readonly diagnostics: AppDiagnostics | null;
}) {
  const view = snapshot.view;
  const mode = flowModeFor(view.viewMode);
  const coupling = couplingOf(snapshot, diagnostics);
  const fallback = diagnostics?.field?.fallback ?? null;
  const quantity = cutPlaneQuantity(view);
  const legend = useMemo(
    () => (mode === null ? null : legendFor(mode, coupling, quantity ?? undefined)),
    [mode, coupling, quantity],
  );
  if (legend === null) return null;
  const grad = legend.stops
    .map((s) => `rgb(${s.rgb.join(' ')}) ${(100 * s.at).toFixed(2)}%`)
    .join(', ');
  return (
    <section className="legend" aria-label="Flow legend">
      <div className="legend-title">
        <span>{legend.title}</span>
        <span className="legend-unit">{legend.unit}</span>
      </div>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${grad})` }}>
        {legend.floor === null ? null : (
          <span
            className="legend-floor"
            style={{
              left: `${(100 * legend.floor.from).toFixed(2)}%`,
              width: `${(100 * (legend.floor.to - legend.floor.from)).toFixed(2)}%`,
            }}
          />
        )}
      </div>
      <div className="legend-ticks" aria-hidden="true">
        {legend.ticks.map((t) => (
          <span
            key={t.label}
            className={t.at < 0.03 ? 'lo' : t.at > 0.97 ? 'hi' : ''}
            style={{ left: `${(100 * t.at).toFixed(2)}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
      {legend.floor === null ? null : (
        <p className="legend-floor-note">
          {/* W2V-N25: the crop's dashed outline, which the note names */}
          <span className="legend-frame" aria-hidden="true" />
          <span>{legend.floor.label}</span>
        </p>
      )}
      <p className="legend-badge" data-coupling={coupling} data-fallback={fallback !== null}>
        <span className="dot" aria-hidden="true" />
        <span>{provenanceLabel(coupling, fallback)}</span>
      </p>
    </section>
  );
}

export function ViewDock({
  snapshot,
  diagnostics,
}: {
  readonly snapshot: SimSnapshot;
  readonly diagnostics: AppDiagnostics | null;
}) {
  const send = useApp((s) => s.send);
  const camera = useApp((s) => s.camera);
  const view = snapshot.view;
  const canTrace = tracersAvailable(view.viewMode);
  const tracers = canTrace && view.overlays.particles;
  return (
    <div className="dock" data-reserve>
      <FlowLegend snapshot={snapshot} diagnostics={diagnostics} />
      <div className="dock-row">
        <div className="seg" role="group" aria-label="Camera">
          {CAMERAS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                camera(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={tracers}
          aria-label="Tracers"
          title={canTrace ? 'Tracer streaks of the drawn field' : 'This mode draws no tracers'}
          disabled={!canTrace}
          onClick={() => {
            send({ type: 'setRenderState', render: { overlays: { particles: !tracers } } });
          }}
        >
          <span className="knob" aria-hidden="true" />
          Tracers
        </button>
        <SoundControls />
        {view.viewMode === 'data' && (
          <label className="compact">
            <span aria-hidden="true">Colour by</span>
            <select
              aria-label="Cut plane field"
              value={view.cutPlaneField}
              onChange={(e) => {
                send({
                  type: 'setRenderState',
                  render: { cutPlaneField: e.currentTarget.value as FieldId },
                });
              }}
            >
              {CUT_PLANE_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {FIELD_LABEL[f] ?? f}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
