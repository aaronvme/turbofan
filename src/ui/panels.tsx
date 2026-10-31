// The top bar (mode switch, quality, units, clock, provenance), the callouts, the "What's
// simulated" panel (the fidelity ledger itself) and the diagnostics (gas-path solve and lost
// solves, D4-13/D4-17 with the W2F-I1 cause; the solver; D4-2's frame budget).

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import physicsMd from '../../docs/PHYSICS.md?raw';
import { parseFidelityLedger, type LedgerKind } from '../hud/ledger';
import { layoutAxial, layoutCallouts, leaderEnd, type Rect } from '../hud/callouts';
import { componentAnchors } from '../hud/anchors';
import {
  faultAnnunciations,
  fieldFallbackAnnunciation,
  flagAnnunciations,
  flowAnnunciation,
  gasPathAnnunciation,
  provenanceBadges,
  type Annunciation,
} from '../hud/annunciators';
import { provenanceLabel } from '../flow/viz/legend';
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

/** The panel switches, at the head of the right column (the panels they open are its, the
 * station strip's and the drawer's). */
export function PanelToggles() {
  const panels = useApp((s) => s.panels);
  const toggle = useApp((s) => s.togglePanel);
  return (
    <nav className="panel-toggles" aria-label="Panels" data-reserve>
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
  );
}

export function TopBar({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const send = useApp((s) => s.send);
  const units = useApp((s) => s.units);
  const setUnits = useApp((s) => s.setUnits);
  const link = useApp((s) => s.diagnostics?.field ?? null);
  // W2A-I1: a stopped sim's clock is frozen, so it offers no pause and says so
  const stopped = useApp((s) => s.simStopped !== null);
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
          disabled={stopped}
          onClick={() => {
            send({ type: 'pause', paused: !clock.paused });
          }}
        >
          {clock.paused ? 'Resume' : 'Pause'}
        </button>
        <span className={stopped ? 'mono warning' : 'mono'} aria-label="Simulated time">
          t {fmt.simTime(clock.simTimeS)}
          {stopped ? ' · stopped' : ''}
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
      <div className="provenance" role="group" aria-label="Data provenance">
        {provenanceBadges(snapshot.sources, link).map((b) => (
          <Badge key={b.id} a={b} />
        ))}
      </div>
    </header>
  );
}

/** The fault chips that open the Diagnostics drawer, which lists their messages. */
const OPENS_DIAGNOSTICS = new Set(['gpuErrors', 'raster', 'refused']);

export function Annunciators({
  snapshot,
  diagnostics,
}: {
  readonly snapshot: SimSnapshot;
  readonly diagnostics: AppDiagnostics | null;
}) {
  const simStopped = useApp((s) => s.simStopped);
  const gpuErrors = useApp((s) => s.gpuErrorCount);
  const refused = useApp((s) => s.refused.length);
  const openPanel = useApp((s) => s.openPanel);
  const gas = gasPathAnnunciation(snapshot.cycle, diagnostics?.lostSolveCause ?? null);
  const fallback = fieldFallbackAnnunciation(diagnostics?.field ?? null);
  // W2A-I1: the worker's faults outside the field switch, on screen
  const faults = faultAnnunciations({
    simStopped,
    gpuErrors,
    raster: diagnostics?.raster ?? null,
    refused,
  });
  const list = [
    ...faults.filter((a) => a.id === 'simStopped'),
    ...flagAnnunciations(snapshot.cycle),
    ...(gas.level === 'normal' ? [] : [gas]),
    ...(fallback === null ? [] : [fallback]),
    ...faults.filter((a) => a.id !== 'simStopped'),
  ];
  return (
    <div
      className="annunciators"
      role="status"
      aria-live="polite"
      aria-label="Annunciators"
      data-reserve
    >
      {list.map((a) =>
        // a held gas path and a stopped sim state their cause beside them (D4-17, W2F-I1,
        // W2A-I1), not only in a tooltip
        (a.id === 'gasPath' || a.id === 'simStopped') && a.level === 'warning' ? (
          <div key={a.id} className="annunciation">
            <Badge a={a} />
            <span className="annunciation-detail">{a.detail}</span>
          </div>
        ) : OPENS_DIAGNOSTICS.has(a.id) ? (
          <button
            key={a.id}
            type="button"
            className="badge"
            data-level={a.level}
            title={a.detail}
            onClick={() => {
              openPanel('diagnostics');
            }}
          >
            {a.text}
          </button>
        ) : (
          <Badge key={a.id} a={a} />
        ),
      )}
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
  // `shown` null: not measured (an undrawn solver shows a dash, not 0.00 ms; W2A-N8)
  const parts = [
    { id: 'render', label: 'Render', ms: b.renderGpuMs ?? 0, shown: b.renderGpuMs },
    { id: 'flow', label: 'Flow visuals', ms: b.flowVisualsGpuMs, shown: b.flowVisualsGpuMs },
    { id: 'solver', label: 'Solver', ms: b.solverGpuMs ?? 0, shown: b.solverGpuMs },
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
            <dd>{fmt.ms(p.shown)} ms</dd>
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
          <dd>
            {fmt.ms(b.cycleCpuMs)} ms · worst {fmt.ms(b.cycleCpuMaxMs)}
          </dd>
        </div>
        {b.cycleCpuHeldMs !== null && (
          <div>
            <dt>Held step (W2F-N5)</dt>
            <dd className="caution">{fmt.ms(b.cycleCpuHeldMs)} ms</dd>
          </div>
        )}
        <div>
          <dt>Worker frame (CPU)</dt>
          <dd>
            {fmt.ms(b.frameCpuMs)} ms · worst {fmt.ms(b.frameCpuMaxMs)}
          </dd>
        </div>
        <div>
          <dt>MOCK raster (off frame)</dt>
          <dd>
            {fmt.ms(b.mockRasterMs)} ms · {b.mockRasters}
          </dd>
        </div>
        <div>
          <dt>Frame rate</dt>
          <dd>{b.fps} fps</dd>
        </div>
        <div>
          <dt>Backing store (D4-85)</dt>
          <dd>
            {d.backingStore.width} × {d.backingStore.height} @ {fmt.fixed(d.backingStore.dpr, 2)}
          </dd>
        </div>
        <div>
          <dt>Boot warm-up (D4-91)</dt>
          <dd>{fmt.ms(d.warmUpMs)} ms</dd>
        </div>
        <div>
          {/* W2A-N22: the background warm-up's state (a given-up one compiles on first use) */}
          <dt>Background warm-up</dt>
          <dd>
            {d.warm.warm.length} of {d.warm.warm.length + d.warm.queue.length} warm
            {d.warm.queue[0] === undefined ? '' : ` · next ${d.warm.queue[0]}`}
            {d.warm.suspended ? ' · paused (input)' : ''}
            {d.warm.gaveUp.length > 0 ? ` · given up: ${d.warm.gaveUp.join(', ')}` : ''}
          </dd>
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
  const link = diagnostics?.field ?? null;
  const gas = gasPathAnnunciation(snapshot.cycle, diagnostics?.lostSolveCause ?? null);
  const flow = flowAnnunciation(snapshot.flow, snapshot.sources.flow === 'solver');
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
        <div>
          <dt>Drawn</dt>
          <dd className="wrap">
            {link === null
              ? 'no field bound yet'
              : field !== link.asked
                ? // the choice is on its way (the solver starts, then binds; W2A-N1)
                  `${provenanceLabel(link.coupling, link.fallback)} (switching to the ${field === 'solver' ? 'solver' : 'MOCK'}…)`
                : provenanceLabel(link.coupling, link.fallback)}
          </dd>
        </div>
      </dl>
      <p className="note">
        The solver runs uncoupled until W3 (no blade or combustor forces from the cycle), so its
        field is not this engine&rsquo;s flow; the MOCK is scaled by the cycle state and labelled. A
        solver that cannot start, is lost or diverges is replaced by the MOCK, with the reason.
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
/** A label's box before it has been measured (the layout then uses its rendered size). */
const LABEL = { w: 132, h: 34 };

type Size = { readonly w: number; readonly h: number };

/**
 * The 3D-anchored callouts: the worker's projected anchors, laid out so that none collide and
 * their leaders cross nothing where they can (W2A-I3). The layout reserves each label's rendered
 * box: the labels are measured as drawn (border-box, one line each), and a label with no place
 * yet is drawn hidden so that it is measured too. The reserved panels are measured when one
 * resizes or a panel opens (W2A-N10), not on every snapshot.
 */
export function Callouts({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const anchors = useApp((s) => s.anchors);
  const engineBox = useApp((s) => s.engineBox);
  const post = useApp((s) => s.post);
  const mode = snapshot.view.viewMode;
  const units = useApp((s) => s.units);
  const panels = useApp((s) => s.panels);
  const ref = useRef<HTMLDivElement>(null);
  const [reserved, setReserved] = useState<Rect[]>([]);
  const [vp, setVp] = useState({ w: 1, h: 1 });
  const [sizes, setSizes] = useState<Readonly<Record<string, Size>>>({});
  useLayoutEffect(() => {
    const host = ref.current;
    if (host === null) return;
    const measure = () => {
      const r = host.getBoundingClientRect();
      setVp({ w: r.width, h: r.height });
      setReserved(
        [...document.querySelectorAll('[data-reserve]')].map((el) => {
          const b = el.getBoundingClientRect();
          return { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height };
        }),
      );
      // D4-92 (zz): the view's free area (the centre column), for Schlieren's framing, and
      // (D4-97 item 2) its part above the dock, for the cut views' label rows
      const c = document.querySelector('.center')?.getBoundingClientRect();
      const dock = document.querySelector('.center .dock')?.getBoundingClientRect();
      if (c !== undefined) {
        const free = { x: c.left - r.left, y: c.top - r.top, w: c.width, h: c.height };
        const bottom = dock === undefined ? c.bottom : Math.min(c.bottom, dock.top - 8);
        post({ type: 'viewArea', free, rows: { ...free, h: Math.max(1, bottom - c.top) } });
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    for (const el of document.querySelectorAll('[data-reserve]')) ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [panels, mode, post]);
  // laid out again only when an anchor, a size or the room changes (not on every snapshot)
  const box = engineBox === null ? '-' : [engineBox.x, engineBox.y, engineBox.w, engineBox.h];
  const key = `${mode}:${box.toString()}:${anchors
    .map((a) => `${a.id}:${a.visible ? `${a.x.toFixed(1)},${a.y.toFixed(1)}` : '-'}`)
    .join('|')}`;
  // D4-92 (zz): the cut views label outward in axial order, the closed views as before
  const cut = (mode === 'cutaway' || mode === 'data') && engineBox !== null;
  const placed = useMemo(
    () =>
      cut
        ? layoutAxial(anchors, (id) => sizes[id] ?? LABEL, vp, reserved, engineBox)
        : layoutCallouts(anchors, (id) => sizes[id] ?? LABEL, vp, reserved),
    // `key` stands for the anchors' values: a new array of the same anchors is no change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, sizes, vp, reserved],
  );
  const placedIds = new Set(placed.map((p) => p.id));
  // the labels as drawn (their values change with the snapshot): a change of a px or more is
  // laid out again
  useLayoutEffect(() => {
    const host = ref.current;
    if (host === null) return;
    let next: Record<string, Size> | null = null;
    for (const el of host.querySelectorAll<HTMLElement>('.callout[data-id]')) {
      const b = el.getBoundingClientRect();
      const id = el.dataset.id ?? '';
      // not laid out (a DOM without layout): keep the default
      if (b.width === 0 || b.height === 0 || id === '') continue;
      const size = { w: Math.ceil(b.width), h: Math.ceil(b.height) };
      const was = sizes[id];
      if (was?.w === size.w && was.h === size.h) continue;
      next ??= { ...sizes };
      next[id] = size;
    }
    if (next !== null) setSizes(next);
  }, [sizes, placed, snapshot.version, units]);
  const st = snapshot.cycle.stations;
  const value = (id: string): string => {
    // every value with its unit (W2A-N8)
    const t = (k: keyof typeof st) => {
      const v = fmt.temperature(st[k].ttK, units);
      return `${v.value} ${v.unit}`;
    };
    switch (id) {
      case 'fan':
        return `N1 ${fmt.fixed(snapshot.cycle.n1Percent, 1)} %`;
      case 'hpc':
        return `PR ${fmt.fixed(snapshot.cycle.hpc.pressureRatio, 1)} · T3 ${t('3')}`;
      case 'combustor':
        return `T4 ${t('4')}`;
      case 'hpt':
        return `T45 ${t('45')}`;
      case 'lpt':
        return `T5 ${t('5')}`;
      case 'booster':
        return `P25 ${fmt.pressure(st['25'].ptPa, units).value} ${fmt.pressure(1, units).unit}`;
      case 'bypassDuct': {
        const w = fmt.massFlow(st['13'].wKgPerS, units);
        return `W13 ${w.value} ${w.unit}`;
      }
      default:
        return `T8 ${t('8')}`;
    }
  };
  const label = (id: string) => (
    <>
      <span>{NAMES.get(id as never) ?? id}</span>
      <b>{value(id)}</b>
    </>
  );
  return (
    <div className="callouts" ref={ref} aria-hidden="true">
      <svg className="leaders">
        {placed.map((p) => {
          const e = leaderEnd(p.anchor, p.box);
          return (
            <g key={p.id}>
              <line data-id={p.id} x1={p.anchor.x} y1={p.anchor.y} x2={e.x} y2={e.y} />
              <circle cx={p.anchor.x} cy={p.anchor.y} r={2.5} />
            </g>
          );
        })}
      </svg>
      {placed.map((p) => (
        // keyed apart from the measuring copy: a label that gets a place is drawn there at once
        <div
          key={`${p.id}:placed`}
          className="callout"
          data-id={p.id}
          style={{ transform: `translate(${p.box.x}px, ${p.box.y}px)` }}
        >
          {label(p.id)}
        </div>
      ))}
      {anchors
        .filter((a) => a.visible && !placedIds.has(a.id))
        .map((a) => (
          <div key={`${a.id}:measure`} className="callout measure" data-id={a.id}>
            {label(a.id)}
          </div>
        ))}
    </div>
  );
}
