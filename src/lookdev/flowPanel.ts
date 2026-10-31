// The look-dev page's flow-visuals panel (w2/flowviz round 2): the mode, the cut plane's
// quantity, the time dilation, where the field comes from (the MOCK raster or the live GPU
// solver) and what the flow visuals cost; and the legend of whatever is drawn as colour (the
// LUT's own stops, src/flow/viz/legend.ts, so the bar matches the pixels: D4-76).
// Query: ?flow=realistic|cutaway|schlieren|data&field=mock|solver&dilation=200&quantity=mach.
// &domain=full (D4-76's option: the cut plane uncropped), &tracers=1|0 (D4-83: Realistic has
// none by default). Keys: f the next flow mode, [ and ] slower / faster, m the next quantity,
// n the near-field crop on / off, k tracers on / off.
// D4-82, W2V-I6: the badge says how far the field is the engine's answer (MOCK, the solver
// "uncoupled until W3", coupled), and a solver that cannot start, is lost or diverges is replaced
// by the MOCK at once, with the reason on the badge (src/flow/viz/fieldLink.ts).

import { ISA_SLS } from '../contracts/ambient';
import type { FlowStepStats } from '../contracts/flow';
import { ENGINE_DEFINITION } from '../engine/definition';
import { GpuFlowSolver } from '../flow/gpu/device/flowSolver';
import { solverBudgetMs } from '../flow/gpu/scheduler';
import { createFlowFieldLink, type FlowLinkState, type LinkedSolver } from '../flow/viz/fieldLink';
import { loadMeshAsset, parseMeshManifest } from '../flow/mesh/loader';
import { solverMeshFromFile } from '../flow/reference/solverMesh';
import { FIELD_QUANTITIES, FIELD_QUANTITY_IDS, type FieldQuantityId } from '../flow/viz/fields';
import { dilationLabel, flowModeNote, legendFor, provenanceLabel } from '../flow/viz/legend';
import {
  FLOW_VIZ_MODES,
  FLOW_VIZ_MODE_IDS,
  tracersShown,
  type FlowVizModeId,
} from '../flow/viz/modes';
import { mockSteadyState } from '../mocks/mockCycle';
import { createMockFlowField } from '../mocks/mockFlowField';
import type { EngineView } from '../render/engineView';
import { perfState } from '../../tools/perf/solverPerf';

const CSS = `
#flow, #legend { position: fixed; z-index: 2; color: rgba(226,230,235,.88);
  font: 500 12px/1.45 ui-sans-serif, 'Segoe UI', system-ui, sans-serif; letter-spacing: .01em;
  background: rgba(14,15,17,.64); border-radius: 12px; backdrop-filter: blur(12px);
  box-shadow: 0 0 0 1px rgba(255,255,255,.07), 0 10px 28px rgba(0,0,0,.3); }
#flow { top: 16px; left: 16px; width: 300px; padding: 12px 14px 12px; }
#flow .h { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
#flow .h b { font-weight: 600; font-size: 13px; letter-spacing: .02em; }
#flow .ms { font: 500 11px ui-monospace, 'Cascadia Mono', monospace; color: rgba(226,230,235,.6);
  font-variant-numeric: tabular-nums; }
#flow .seg { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; padding: 2px;
  border-radius: 8px; background: rgba(255,255,255,.06); }
#flow .seg button { all: unset; cursor: pointer; text-align: center; padding: 5px 0 6px; border-radius: 6px;
  font-size: 11.5px; color: rgba(226,230,235,.7); transition: background .15s, color .15s; }
#flow .seg button:hover { color: #fff; background: rgba(255,255,255,.06); }
#flow .seg button[aria-pressed="true"] { color: #0e0f11; background: rgba(236,240,244,.92); }
#flow .seg button:focus-visible { outline: 2px solid rgba(140,190,255,.9); outline-offset: 1px; }
#flow .row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
#flow .row label { flex: 0 0 76px; color: rgba(226,230,235,.6); }
#flow .row input[type=range] { flex: 1; accent-color: #dfe6ee; }
#flow .row output { flex: 0 0 52px; text-align: right; font: 500 11px ui-monospace, monospace;
  font-variant-numeric: tabular-nums; }
#flow .row select { flex: 1; background: rgba(255,255,255,.07); color: inherit; border: 0;
  border-radius: 6px; padding: 4px 6px; font: inherit; }
#flow .src { display: flex; align-items: center; gap: 7px; margin-top: 10px; font-size: 11.5px; }
#flow .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
#flow .src.mock .dot { background: #e8b04a; }
#flow .src.uncoupled .dot { background: #86a9d6; }
#flow .src.coupled .dot { background: #5fd0b0; }
#flow .src.fallback { color: #f0c46e; }
#flow .row .sw { all: unset; cursor: pointer; position: relative; flex: 0 0 auto; width: 30px;
  height: 17px; border-radius: 9px; background: rgba(255,255,255,.14); transition: background .15s; }
#flow .row .sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px;
  height: 13px; border-radius: 50%; background: rgba(236,240,244,.92); transition: transform .15s; }
#flow .row .sw[aria-checked="true"] { background: rgba(95,208,176,.6); }
#flow .row .sw[aria-checked="true"]::after { transform: translateX(13px); }
#flow .row .sw:focus-visible { outline: 2px solid rgba(140,190,255,.9); outline-offset: 2px; }
#flow .row .hint { flex: 1; text-align: right; color: rgba(226,230,235,.45); font-size: 11px; }
#flow .note { margin-top: 8px; color: rgba(226,230,235,.56); font-size: 11px; line-height: 1.45;
  text-wrap: pretty; }
#legend { right: 16px; bottom: 16px; width: 280px; padding: 11px 14px 9px; }
#legend[hidden] { display: none; }
#legend .t { font-weight: 600; font-size: 12px; }
#legend .u { color: rgba(226,230,235,.58); font-weight: 500; margin-left: 6px; }
#legend .bar { height: 10px; margin: 8px 0 0; border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
#legend .ticks { position: relative; height: 22px; font: 500 10.5px ui-monospace, monospace;
  font-variant-numeric: tabular-nums; color: rgba(226,230,235,.72); }
#legend .ticks span { position: absolute; top: 5px; transform: translateX(-50%); white-space: nowrap; }
#legend .ticks span::before { content: ''; position: absolute; left: 50%; top: -5px; width: 1px;
  height: 4px; background: rgba(226,230,235,.45); }
#legend .ticks span.lo { transform: none; }
#legend .ticks span.lo::before { left: 0; }
#legend .ticks span.hi { transform: translateX(-100%); }
#legend .ticks span.hi::before { left: auto; right: 0; }
#legend .badge { margin-top: 2px; font-size: 10.5px; color: rgba(226,230,235,.55);
  text-wrap: pretty; }
#legend .badge.fallback { color: #f0c46e; }
body.clean #flow { display: none; }
`;

const MODE_SHORT: Record<FlowVizModeId, string> = {
  realistic: 'Real',
  cutaway: 'Cut',
  schlieren: 'Schl.',
  data: 'Data',
};

export interface FlowPanel {
  /** Steps the live solver (if any) before the frame: D4-2's budget from the view's stats. */
  beforeFrame(): void;
  /** Refreshes the readouts (the page's HUD tick). */
  refresh(): void;
  onKey(key: string): void;
  setMode(id: FlowVizModeId | null): void;
  setDilation(d: number): void;
  setQuantity(id: FieldQuantityId | null): void;
  /** D4-83: tracers on or off (null: the mode's default). */
  setTracers(on: boolean | null): void;
  /** Which field is drawn and why (D4-82; W2V-I6: a fallback's reason). */
  linkState(): FlowLinkState;
  /** The flow mode drawn (null: the flow visuals off). */
  mode(): FlowVizModeId | null;
  /** The live solver's last step (the capture's --flow record); null without a live solver. */
  solverStats(): FlowStepStats | null;
  /** The MOCK field follows the throttle (a rasterised steady state). */
  setThrottle(lever: number): void;
}

/** 1/1000 .. 1/10 on a log slider of 0..100. */
const sliderToDilation = (v: number) => 10 ** (-3 + (2 * v) / 100);
const dilationToSlider = (d: number) => ((Math.log10(d) + 3) * 100) / 2;

/** The live solver on the view's device, from its timing start state (W3 couples it). */
async function startSolver(view: EngineView): Promise<GpuFlowSolver> {
  const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
  const entry = manifest.specs['130k'];
  if (entry === undefined) throw new Error('no 130k mesh in /mesh/manifest.json');
  const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
  const { asset, file } = await loadMeshAsset(bytes, entry);
  const solver = new GpuFlowSolver();
  try {
    await solver.init({ device: view.device.device, mesh: asset, definition: ENGINE_DEFINITION });
    const kernel = solver.kernel;
    // the solver's timing start state: structure to show until the coupling (W3) drives it
    if (kernel !== null) kernel.setConserved(perfState(solverMeshFromFile(file), kernel.ref));
    return solver;
  } catch (e) {
    solver.dispose();
    throw e;
  }
}

export async function createFlowPanel(
  view: EngineView,
  params: URLSearchParams,
  /** Starts the solver for ?field=solver (a test can inject one that fails: W2V-I6). */
  solverFactory: (view: EngineView) => Promise<LinkedSolver> = startSolver,
): Promise<FlowPanel> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.id = 'flow';
  const legend = document.createElement('div');
  legend.id = 'legend';
  legend.hidden = true;
  document.body.append(panel, legend);

  let mode: FlowVizModeId | null = null;
  let quantity: FieldQuantityId | null = null;
  let dilation = 1 / Number(params.get('dilation') ?? 200);
  if (!(dilation > 0 && dilation <= 1)) dilation = 1 / 200;
  let tracers: boolean | null =
    params.get('tracers') === '1' ? true : params.get('tracers') === '0' ? false : null;
  let lever = 0;
  let mockTimer = 0;
  let fullDomain = params.get('domain') === 'full';
  view.setFlowFullDomain(fullDomain);

  const mockAt = (l: number) =>
    createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, l), ISA_SLS);
  const link = await createFlowFieldLink({
    sink: view,
    mock: mockAt(0),
    ...(params.get('field') === 'solver' ? { solver: () => solverFactory(view) } : {}),
  });
  let shown = link.state();
  view.setFlowTimeScale(dilation);

  panel.innerHTML = `
    <div class="h"><b>Flow</b><span class="ms" id="flow-ms">off</span></div>
    <div class="seg" role="group" aria-label="Flow mode">
      <button data-mode="off" aria-pressed="true" title="No flow visuals">Off</button>
      ${FLOW_VIZ_MODE_IDS.map((id) => `<button data-mode="${id}" aria-pressed="false" title="${FLOW_VIZ_MODES[id].label}">${MODE_SHORT[id]}</button>`).join('')}
    </div>
    <div class="row"><label for="flow-dil">Slow motion</label>
      <input id="flow-dil" type="range" min="0" max="100" step="1" value="${String(dilationToSlider(dilation))}" />
      <output id="flow-dil-o"></output></div>
    <div class="row" id="flow-q-row"><label for="flow-q">Cut plane</label>
      <select id="flow-q">${FIELD_QUANTITY_IDS.map((q) => `<option value="${q}">${FIELD_QUANTITIES[q].label}</option>`).join('')}</select></div>
    <div class="row" id="flow-t-row"><label for="flow-t">Tracers</label>
      <button id="flow-t" class="sw" role="switch" aria-checked="false" aria-label="Tracers" title="Tracer streaks (k)"></button>
      <span class="hint" id="flow-t-h"></span></div>
    <div class="src" id="flow-src"><span class="dot"></span><span id="flow-src-t"></span></div>
    <div class="note" id="flow-note"></div>`;
  const $ = (id: string): HTMLElement => {
    const el = panel.querySelector<HTMLElement>(`#${id}`);
    if (el === null) throw new Error(`flow panel: no #${id}`);
    return el;
  };
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.seg button')];
  const dil = $('flow-dil') as HTMLInputElement;
  const dilOut = $('flow-dil-o') as HTMLOutputElement;
  const qSel = $('flow-q') as HTMLSelectElement;
  const qRow = $('flow-q-row') as HTMLDivElement;
  const tSw = $('flow-t') as HTMLButtonElement;
  const tRow = $('flow-t-row') as HTMLDivElement;
  const badge = () => {
    const st = link.state();
    return { st, text: provenanceLabel(st.coupling, st.fallback) };
  };

  const drawLegend = () => {
    const b = badge();
    const l = mode === null ? null : legendFor(mode, b.st.coupling, quantity ?? undefined);
    legend.hidden = l === null;
    if (l === null) return;
    const grad = l.stops
      .map((s) => `rgb(${s.rgb.join(',')}) ${(100 * s.at).toFixed(2)}%`)
      .join(',');
    legend.innerHTML = `<div class="t">${l.title}<span class="u">${l.unit}</span></div>
      <div class="bar" style="background:linear-gradient(90deg,${grad})"></div>
      <div class="ticks">${l.ticks.map((t) => `<span class="${t.at < 0.03 ? 'lo' : t.at > 0.97 ? 'hi' : ''}" style="left:${(100 * t.at).toFixed(2)}%">${t.label}</span>`).join('')}</div>
      <div class="badge${b.st.fallback === null ? '' : ' fallback'}">${b.text}</div>`;
  };
  const showMs = () => {
    const f = view.stats().flow;
    $('flow-ms').textContent = mode === null ? 'off' : `GPU ${f.visualsMs.toFixed(2)} ms`;
  };
  const sync = () => {
    for (const b of buttons)
      b.setAttribute('aria-pressed', String((b.dataset.mode ?? 'off') === (mode ?? 'off')));
    dilOut.textContent = dilationLabel(dilation);
    const m = mode === null ? null : FLOW_VIZ_MODES[mode];
    qRow.style.display = m?.cutPlane === true ? '' : 'none';
    qSel.value = quantity ?? m?.quantity ?? 'mach';
    const b = badge();
    const s = $('flow-src') as HTMLDivElement;
    s.className = `src ${b.st.coupling}${b.st.fallback === null ? '' : ' fallback'}`;
    $('flow-src-t').textContent = b.text;
    tRow.style.display = m !== null && m.particleOpacity > 0 ? '' : 'none';
    tSw.setAttribute('aria-checked', String(m !== null && tracersShown(m, tracers)));
    $('flow-t-h').textContent = tracers === null ? 'mode default' : '';
    ($('flow-note') as HTMLDivElement).textContent =
      mode === null
        ? 'Pick a mode to see the air.'
        : flowModeNote(mode, dilation, quantity ?? undefined, tracers ?? undefined);
    drawLegend();
    showMs();
  };

  const api: FlowPanel = {
    beforeFrame() {
      // the health check runs every frame (a lost or diverged solver falls back at once); the
      // solver steps only while a flow mode draws it, at D4-2's budget
      const st = view.stats();
      link.beforeFrame(
        mode === null
          ? null
          : {
              gpuTimeBudgetMs: solverBudgetMs({
                renderMs: st.timings.frames > 0 ? st.timings.gpuTotal : null,
                flowVisualsMs: st.flow.visualsMs,
              }),
              maxIterations: 1000,
            },
      );
      const now = link.state();
      if (now !== shown) {
        shown = now;
        sync();
      }
    },
    refresh() {
      showMs();
    },
    onKey(key) {
      if (key === 'f') {
        const order: (FlowVizModeId | null)[] = [null, ...FLOW_VIZ_MODE_IDS];
        api.setMode(order[(order.indexOf(mode) + 1) % order.length] ?? null);
      }
      if (key === 'n') {
        fullDomain = !fullDomain;
        view.setFlowFullDomain(fullDomain);
      }
      if (key === 'k' && mode !== null && FLOW_VIZ_MODES[mode].particleOpacity > 0)
        api.setTracers(!tracersShown(FLOW_VIZ_MODES[mode], tracers));
      if (key === '[') api.setDilation(Math.max(1e-3, dilation / 2));
      if (key === ']') api.setDilation(Math.min(0.1, dilation * 2));
      if (key === 'm' && mode !== null && FLOW_VIZ_MODES[mode].cutPlane) {
        const cur = quantity ?? FLOW_VIZ_MODES[mode].quantity;
        api.setQuantity(
          FIELD_QUANTITY_IDS[(FIELD_QUANTITY_IDS.indexOf(cur) + 1) % FIELD_QUANTITY_IDS.length] ??
            null,
        );
      }
    },
    setMode(id) {
      mode = id;
      quantity = null;
      view.setFlowQuantity(null);
      view.setFlowTracers(tracers);
      view.setFlowMode(id);
      if (id === null) view.setMode('realistic');
      sync();
    },
    setDilation(d) {
      dilation = d;
      view.setFlowTimeScale(d);
      dil.value = String(dilationToSlider(d));
      sync();
    },
    setQuantity(id) {
      quantity = id;
      view.setFlowQuantity(id);
      sync();
    },
    setTracers(on) {
      tracers = on;
      view.setFlowTracers(on);
      sync();
    },
    linkState: () => link.state(),
    mode: () => mode,
    solverStats: () => link.solver?.status().stats ?? null,
    setThrottle(l) {
      lever = l;
      // rasterising the MOCK takes a moment: once the lever rests. It is kept up to date while
      // the solver is drawn, so a fallback shows the MOCK at this throttle
      clearTimeout(mockTimer);
      mockTimer = window.setTimeout(() => {
        link.setMock(mockAt(lever));
      }, 250);
    },
  };
  for (const b of buttons)
    b.addEventListener('click', () => {
      const m = b.dataset.mode;
      api.setMode(m === undefined || m === 'off' ? null : (m as FlowVizModeId));
    });
  dil.addEventListener('input', () => {
    api.setDilation(sliderToDilation(Number(dil.value)));
  });
  qSel.addEventListener('change', () => {
    api.setQuantity(qSel.value as FieldQuantityId);
  });
  tSw.addEventListener('click', () => {
    if (mode !== null) api.setTracers(!tracersShown(FLOW_VIZ_MODES[mode], tracers));
  });
  const start = params.get('flow');
  const q = params.get('quantity');
  api.setMode(FLOW_VIZ_MODE_IDS.includes(start as FlowVizModeId) ? (start as FlowVizModeId) : null);
  if (q !== null && FIELD_QUANTITY_IDS.includes(q as FieldQuantityId))
    api.setQuantity(q as FieldQuantityId);
  sync();
  return api;
}
