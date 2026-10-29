// The top bar (mode switch, quality, units, clock, provenance), the callouts, the "What's
// simulated" panel (the fidelity ledger itself) and the diagnostics (gas-path solve and lost
// solves, D4-13/D4-17 with the W2F-I1 cause; the solver; D4-2's frame budget).

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import physicsMd from '../../docs/PHYSICS.md?raw';
import { parseFidelityLedger, type LedgerKind } from '../hud/ledger';
import { layoutCallouts, leaderEnd, type Rect } from '../hud/callouts';
import { componentAnchors } from '../hud/anchors';
import {
  flagAnnunciations,
  flowAnnunciation,
  gasPathAnnunciation,
  provenanceBadges,
  type Annunciation,
} from '../hud/annunciators';
import * as fmt from '../hud/format';
import { ENGINE_DEFINITION } from '../engine/definition';
import { QUALITY_PRESETS, VIEW_MODES, type QualityPreset, type ViewMode } from '../contracts/ui';
import type { SimSnapshot } from '../contracts/sim';
import type { AppDiagnostics } from '../shell/protocol';
import { SOLVER_BUDGET } from '../flow/gpu/scheduler';
import { useApp, type PanelId } from './store';

const MODE_LABEL: Readonly<Record<ViewMode, string>> = {
  realistic: 'Realistic',
  cutaway: 'Cutaway',
  exploded: 'Exploded',
  schlieren: 'Schlieren',
  data: 'Data',
};

export function Badge({ a }: { readonly a: Annunciation }) {
  return (
    <span className="badge" data-level={a.level} title={a.detail}>
      {a.text}
    </span>
  );
}

export function ModeSwitch({ mode }: { readonly mode: ViewMode }) {
  const send = useApp((s) => s.send);
  return (
    <div className="modes" role="radiogroup" aria-label="View mode">
      {VIEW_MODES.map((m, i) => (
        <label key={m} className={m === mode ? 'on' : ''}>
          <input
            type="radio"
            name="view-mode"
            value={m}
            checked={m === mode}
            onChange={() => {
              send({ type: 'setViewMode', mode: m });
            }}
          />
          <span>{MODE_LABEL[m]}</span>
          <kbd aria-hidden="true">{i + 1}</kbd>
        </label>
      ))}
    </div>
  );
}

const PANELS: readonly [PanelId, string][] = [
  ['maps', 'Maps'],
  ['ts', 'T–s'],
  ['stations', 'Stations'],
  ['fidelity', "What's simulated"],
  ['diagnostics', 'Diagnostics'],
];

export function TopBar({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const send = useApp((s) => s.send);
  const units = useApp((s) => s.units);
  const setUnits = useApp((s) => s.setUnits);
  const panels = useApp((s) => s.panels);
  const toggle = useApp((s) => s.togglePanel);
  const { clock, view } = snapshot;
  return (
    <header className="topbar" data-reserve>
      <div className="brand">
        <strong>CFM56-7B27</strong>
        <span>class turbofan · SLS ISA</span>
      </div>
      <ModeSwitch mode={view.viewMode} />
      <div className="clock" aria-label="Simulation clock">
        <button
          type="button"
          aria-pressed={clock.paused}
          onClick={() => {
            send({ type: 'pause', paused: !clock.paused });
          }}
        >
          {clock.paused ? 'Resume' : 'Pause'}
        </button>
        <span className="mono" aria-label="Simulated time">
          t {fmt.simTime(clock.simTimeS)}
        </span>
        <label className="compact">
          <span className="sr-only">Time scale</span>
          <select
            value={clock.timeScale}
            onChange={(e) => {
              send({ type: 'setTimeScale', scale: Number(e.currentTarget.value) });
            }}
          >
            {[0.1, 0.25, 0.5, 1, 2, 4].map((k) => (
              <option key={k} value={k}>
                {fmt.timeScale(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="settings">
        <label className="compact">
          <span>Quality</span>
          <select
            value={view.quality}
            onChange={(e) => {
              send({
                type: 'setRenderState',
                render: { quality: e.currentTarget.value as QualityPreset },
              });
            }}
          >
            {QUALITY_PRESETS.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Units">
          {(['si', 'imperial'] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={units === u}
              onClick={() => {
                setUnits(u);
              }}
            >
              {u === 'si' ? 'SI' : 'US'}
            </button>
          ))}
        </div>
      </div>
      <nav className="panel-toggles" aria-label="Panels">
        {PANELS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={panels[id]}
            onClick={() => {
              toggle(id);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="provenance" aria-label="Data provenance">
        {provenanceBadges(snapshot.sources).map((b) => (
          <Badge key={b.id} a={b} />
        ))}
      </div>
    </header>
  );
}

export function Annunciators({
  snapshot,
  diagnostics,
}: {
  readonly snapshot: SimSnapshot;
  readonly diagnostics: AppDiagnostics | null;
}) {
  const gas = gasPathAnnunciation(snapshot.cycle, diagnostics?.lostSolveCause ?? null);
  const list = [...flagAnnunciations(snapshot.cycle), ...(gas.level === 'normal' ? [] : [gas])];
  return (
    <div className="annunciators" role="status" aria-live="polite" aria-label="Annunciators">
      {list.map((a) => (
        <Badge key={a.id} a={a} />
      ))}
    </div>
  );
}

const KIND_LABEL: Readonly<Record<LedgerKind, string>> = {
  simulated: 'Simulated',
  derived: 'Derived',
  synthesized: 'Synthesized',
  representative: 'Representative',
  other: 'Other',
};

export function FidelityPanel() {
  const rows = useMemo(() => parseFidelityLedger(physicsMd), []);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="panel fidelity" aria-label="What's simulated" data-reserve>
      <header className="panel-head">
        <h2>What’s simulated</h2>
        <span className="tag">docs/PHYSICS.md §1</span>
      </header>
      <ul>
        {rows.map((r, i) => (
          <li key={r.thing} data-kind={r.kind}>
            <button
              type="button"
              aria-expanded={open === i}
              onClick={() => {
                setOpen(open === i ? null : i);
              }}
            >
              <span className="kind" data-kind={r.kind}>
                {KIND_LABEL[r.kind]}
                {r.caveat ? ' *' : ''}
              </span>
              <span className="thing">{r.thing}</span>
            </button>
            {open === i && (
              <div className="ledger-detail">
                <p>
                  <strong>{r.status}</strong>
                </p>
                <p>{r.source}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="note">* the ledger states a gap, an assumption or a flagged fallback.</p>
    </section>
  );
}

function BudgetBar({ d }: { readonly d: AppDiagnostics }) {
  const b = d.budget;
  const frame = SOLVER_BUDGET.frameMs;
  const parts = [
    { id: 'render', label: 'Render', ms: b.renderGpuMs ?? 0 },
    { id: 'flow', label: 'Flow visuals', ms: b.flowVisualsGpuMs },
    { id: 'solver', label: 'Solver', ms: b.solverGpuMs ?? 0 },
  ];
  const total = parts.reduce((t, p) => t + p.ms, 0);
  return (
    <div className="budget">
      <div
        className="budget-bar"
        role="img"
        aria-label={`GPU frame ${fmt.ms(total)} of ${frame} ms: ${parts.map((p) => `${p.label} ${fmt.ms(p.ms)}`).join(', ')}`}
      >
        {parts.map((p) => (
          <span
            key={p.id}
            data-part={p.id}
            style={{ width: `${Math.min(100, (100 * p.ms) / (frame * 1.2))}%` }}
          />
        ))}
        <i style={{ left: `${100 / 1.2}%` }} title={`${frame} ms (D4-2)`} />
      </div>
      <dl className="kv">
        {parts.map((p) => (
          <div key={p.id}>
            <dt>
              <span className="swatch" data-part={p.id} />
              {p.label}
            </dt>
            <dd>{fmt.ms(p.ms)} ms</dd>
          </div>
        ))}
        <div>
          <dt>Solver budget (D4-2)</dt>
          <dd>{fmt.ms(b.solverBudgetMs)} ms</dd>
        </div>
        <div>
          <dt>Iterations / frame</dt>
          <dd>
            {b.solverIterations} @ {fmt.ms(b.msPerIteration)} ms
          </dd>
        </div>
        <div>
          <dt>Cycle step (CPU)</dt>
          <dd>{fmt.ms(b.cycleCpuMs)} ms</dd>
        </div>
        <div>
          <dt>Worker frame (CPU)</dt>
          <dd>{fmt.ms(b.frameCpuMs)} ms</dd>
        </div>
        <div>
          <dt>Frame rate</dt>
          <dd>{b.fps} fps</dd>
        </div>
      </dl>
    </div>
  );
}

export function DiagnosticsPanel({
  snapshot,
  diagnostics,
}: {
  readonly snapshot: SimSnapshot;
  readonly diagnostics: AppDiagnostics | null;
}) {
  const gpuErrors = useApp((s) => s.gpuErrors);
  const refused = useApp((s) => s.refused);
  const field = useApp((s) => s.field);
  const setField = useApp((s) => s.setField);
  const gas = gasPathAnnunciation(snapshot.cycle, diagnostics?.lostSolveCause ?? null);
  const flow = flowAnnunciation(snapshot.flow);
  const st = snapshot.flow.stats;
  return (
    <section className="panel diagnostics" aria-label="Diagnostics" data-reserve>
      <header className="panel-head">
        <h2>Diagnostics</h2>
        <span className="tag">{diagnostics?.adapter ?? ''}</span>
      </header>
      <h3>Gas path</h3>
      <dl className="kv">
        <div>
          <dt>gasPathSolve.status</dt>
          <dd>
            <Badge a={gas} /> {snapshot.cycle.gasPathSolve.status}
          </dd>
        </div>
        <div>
          <dt>lostSolves (D4-17)</dt>
          <dd className={snapshot.cycle.gasPathSolve.lostSolves > 0 ? 'caution' : ''}>
            {snapshot.cycle.gasPathSolve.lostSolves}
          </dd>
        </div>
        <div>
          <dt>Last lost-solve cause</dt>
          <dd className="wrap">{diagnostics?.lostSolveCause ?? 'none since reset'}</dd>
        </div>
      </dl>
      <h3>Flow solver</h3>
      <dl className="kv">
        <div>
          <dt>Status</dt>
          <dd>
            <Badge a={flow} />
          </dd>
        </div>
        {flow.detail !== undefined && flow.level !== 'normal' && (
          <div>
            <dt>Why</dt>
            <dd className="wrap">{flow.detail}</dd>
          </div>
        )}
        <div>
          <dt>Iterations</dt>
          <dd>{st?.totalIterations ?? fmt.MISSING}</dd>
        </div>
        <div>
          <dt>ρ residual L2</dt>
          <dd>
            {st?.residualDensityL2 == null ? fmt.MISSING : st.residualDensityL2.toExponential(2)}
          </dd>
        </div>
        <div>
          <dt>Drawn field</dt>
          <dd>
            <div className="seg" role="group" aria-label="Drawn flow field">
              {(['mock', 'solver'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={field === f}
                  disabled={f === 'solver' && snapshot.flow.status !== 'running'}
                  onClick={() => {
                    setField(f);
                  }}
                >
                  {f === 'mock' ? 'MOCK' : 'Solver'}
                </button>
              ))}
            </div>
          </dd>
        </div>
      </dl>
      <p className="note">
        The solver runs uncoupled until W3 (no body forces from the cycle), so its field is the
        ambient at rest; the MOCK field is scaled by the cycle state and labelled.
      </p>
      <h3>Frame budget</h3>
      {diagnostics === null ? (
        <p className="note">waiting for the first frame</p>
      ) : (
        <BudgetBar d={diagnostics} />
      )}
      {(gpuErrors.length > 0 || (diagnostics?.errors.length ?? 0) > 0 || refused.length > 0) && (
        <>
          <h3>Errors</h3>
          <ul className="errors">
            {[
              ...gpuErrors,
              ...(diagnostics?.errors ?? []),
              ...refused.map((r) => `refused: ${r}`),
            ].map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const NAMES = new Map(componentAnchors(ENGINE_DEFINITION).map((a) => [a.id, a.name]));
const LABEL = { w: 132, h: 34 };

/** The 3D-anchored callouts: the worker's projected anchors, laid out so that none collide. */
export function Callouts({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const anchors = useApp((s) => s.anchors);
  const units = useApp((s) => s.units);
  const ref = useRef<HTMLDivElement>(null);
  const [reserved, setReserved] = useState<Rect[]>([]);
  const [vp, setVp] = useState({ w: 1, h: 1 });
  useLayoutEffect(() => {
    const host = ref.current;
    if (host === null) return;
    const r = host.getBoundingClientRect();
    setVp({ w: r.width, h: r.height });
    setReserved(
      [...document.querySelectorAll('[data-reserve]')].map((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height };
      }),
    );
  }, [snapshot.version]);
  const placed = layoutCallouts(anchors, () => LABEL, vp, reserved);
  const st = snapshot.cycle.stations;
  const value = (id: string): string => {
    switch (id) {
      case 'fan':
        return `N1 ${fmt.fixed(snapshot.cycle.n1Percent, 1)} %`;
      case 'hpc':
        return `PR ${fmt.fixed(snapshot.cycle.hpc.pressureRatio, 1)} · T3 ${fmt.temperature(st['3'].ttK, units).value}`;
      case 'combustor':
        return `T4 ${fmt.temperature(st['4'].ttK, units).value} ${fmt.temperature(1, units).unit}`;
      case 'hpt':
        return `T45 ${fmt.temperature(st['45'].ttK, units).value}`;
      case 'lpt':
        return `T5 ${fmt.temperature(st['5'].ttK, units).value}`;
      case 'booster':
        return `P25 ${fmt.pressure(st['25'].ptPa, units).value} ${fmt.pressure(1, units).unit}`;
      case 'bypassDuct':
        return `W13 ${fmt.massFlow(st['13'].wKgPerS, units).value}`;
      default:
        return `T8 ${fmt.temperature(st['8'].ttK, units).value}`;
    }
  };
  return (
    <div className="callouts" ref={ref} aria-hidden="true">
      <svg className="leaders">
        {placed.map((p) => {
          const e = leaderEnd(p.anchor, p.box);
          return (
            <g key={p.id}>
              <line x1={p.anchor.x} y1={p.anchor.y} x2={e.x} y2={e.y} />
              <circle cx={p.anchor.x} cy={p.anchor.y} r={2.5} />
            </g>
          );
        })}
      </svg>
      {placed.map((p) => (
        <div
          key={p.id}
          className="callout"
          style={{ transform: `translate(${p.box.x}px, ${p.box.y}px)`, width: p.box.w }}
        >
          <span>{NAMES.get(p.id as never) ?? p.id}</span>
          <b>{value(p.id)}</b>
        </div>
      ))}
    </div>
  );
}
