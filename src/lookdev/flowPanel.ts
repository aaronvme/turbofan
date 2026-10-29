// The look-dev page's flow-visuals panel (w2/flowviz round 2): the mode, the cut plane's
// quantity, the time dilation, where the field comes from (the MOCK raster or the live GPU
// solver) and what the flow visuals cost; and the legend of whatever is drawn as colour (the
// LUT's own stops, src/flow/viz/legend.ts, so the bar matches the pixels: D4-76).
// Query: ?flow=realistic|cutaway|schlieren|data&field=mock|solver&dilation=200&quantity=mach.
// &domain=full (D4-76's option: the cut plane uncropped). Keys: f the next flow mode, [ and ]
// slower / faster, m the next quantity, n the near-field crop on / off.

import { ISA_SLS } from '../contracts/ambient';
import { ENGINE_DEFINITION } from '../engine/definition';
import { GpuFlowSolver } from '../flow/gpu/device/flowSolver';
import { solverBudgetMs } from '../flow/gpu/scheduler';
import { loadMeshAsset, parseMeshManifest } from '../flow/mesh/loader';
import { solverMeshFromFile } from '../flow/reference/solverMesh';
import { FIELD_QUANTITIES, FIELD_QUANTITY_IDS, type FieldQuantityId } from '../flow/viz/fields';
import { dilationLabel, flowModeNote, legendFor, provenanceLabel } from '../flow/viz/legend';
import { FLOW_VIZ_MODES, FLOW_VIZ_MODE_IDS, type FlowVizModeId } from '../flow/viz/modes';
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
#flow .src.solver .dot { background: #5fd0b0; }
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
#legend .badge { margin-top: 2px; font-size: 10.5px; color: rgba(226,230,235,.55); }
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
  /** The MOCK field follows the throttle (a rasterised steady state). */
  setThrottle(lever: number): void;
}

/** 1/1000 .. 1/10 on a log slider of 0..100. */
const sliderToDilation = (v: number) => 10 ** (-3 + (2 * v) / 100);
const dilationToSlider = (d: number) => ((Math.log10(d) + 3) * 100) / 2;

export async function createFlowPanel(
  view: EngineView,
  params: URLSearchParams,
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
  let solver: GpuFlowSolver | null = null;
  let lever = 0;
  let mockTimer = 0;
  let fullDomain = params.get('domain') === 'full';
  view.setFlowFullDomain(fullDomain);

  if (params.get('field') === 'solver') {
    const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
    const entry = manifest.specs['130k'];
    if (entry === undefined) throw new Error('flow panel: no 130k mesh');
    const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
    const { asset, file } = await loadMeshAsset(bytes, entry);
    solver = new GpuFlowSolver();
    await solver.init({ device: view.device.device, mesh: asset, definition: ENGINE_DEFINITION });
    const kernel = solver.kernel;
    // the solver's timing start state: structure to show until the coupling (W3) drives it
    if (kernel !== null) kernel.setConserved(perfState(solverMeshFromFile(file), kernel.ref));
    view.setFlowSolverField(solver.fields());
  } else {
    view.setFlowField(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 0), ISA_SLS),
    );
  }
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

  const drawLegend = () => {
    const source = view.stats().flow.source ?? 'mock';
    const l = mode === null ? null : legendFor(mode, source, quantity ?? undefined);
    legend.hidden = l === null;
    if (l === null) return;
    const grad = l.stops
      .map((s) => `rgb(${s.rgb.join(',')}) ${(100 * s.at).toFixed(2)}%`)
      .join(',');
    legend.innerHTML = `<div class="t">${l.title}<span class="u">${l.unit}</span></div>
      <div class="bar" style="background:linear-gradient(90deg,${grad})"></div>
      <div class="ticks">${l.ticks.map((t) => `<span style="left:${(100 * t.at).toFixed(2)}%">${t.label}</span>`).join('')}</div>
      <div class="badge">${provenanceLabel(l.source)}</div>`;
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
    const src = view.stats().flow.source;
    const s = $('flow-src') as HTMLDivElement;
    s.className = `src ${src ?? 'mock'}`;
    $('flow-src-t').textContent = provenanceLabel(src ?? 'mock');
    ($('flow-note') as HTMLDivElement).textContent =
      mode === null
        ? 'Pick a mode to see the air.'
        : flowModeNote(mode, dilation, quantity ?? undefined);
    drawLegend();
    showMs();
  };

  const api: FlowPanel = {
    beforeFrame() {
      if (solver === null || mode === null) return;
      const st = view.stats();
      const budget = solverBudgetMs({
        renderMs: st.timings.frames > 0 ? st.timings.gpuTotal : null,
        flowVisualsMs: st.flow.visualsMs,
      });
      solver.step({ gpuTimeBudgetMs: budget, maxIterations: 1000 });
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
    setThrottle(l) {
      lever = l;
      if (solver !== null) return;
      // rasterising the MOCK takes a moment: once the lever rests
      clearTimeout(mockTimer);
      mockTimer = window.setTimeout(() => {
        view.setFlowField(
          createMockFlowField(
            ENGINE_DEFINITION,
            mockSteadyState(ENGINE_DEFINITION, lever),
            ISA_SLS,
          ),
        );
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
  const start = params.get('flow');
  const q = params.get('quantity');
  api.setMode(FLOW_VIZ_MODE_IDS.includes(start as FlowVizModeId) ? (start as FlowVizModeId) : null);
  if (q !== null && FIELD_QUANTITY_IDS.includes(q as FieldQuantityId))
    api.setQuantity(q as FieldQuantityId);
  sync();
  return api;
}
