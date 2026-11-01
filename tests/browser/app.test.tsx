// The whole app in the installed Chrome (w2/app-ui): <App/> boots the D2-4 worker on the real
// cycle model and the GPU, a snapshot arrives, and each of the 5 view modes draws with no WebGPU
// error and no fatal message, on a canvas with content. Each mode is shot at 1920 x 1001 and
// 1366 x 768 (the screenshots go to reports/ui/, ignored; VITE_UI_LOOKDEV=1 writes them to
// docs/look-dev/ui/ instead, as flowviz's W2V-N8). D4-82: the solver's field is labelled
// "solver (uncoupled until W3)" on the badge and the legend. W2F-N5: the worker's frame cost is
// recorded while the gas path is held (the W1K-I2 part-power fit's slam), to reports/ui/, the sim
// stepped on a fixed dt so the case is the same every run (D4-98 item 2, W2H-I5).
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { VIEW_MODES, type ViewMode } from '../../src/contracts/ui';
import type { FrameBudget } from '../../src/shell/protocol';
import { BACKING_STORE_MAX_PX } from '../../src/shell/pixelCap';
import { SETTLED_FRAMES } from '../../src/shell/settle';
import { App } from '../../src/ui/App';
import { useApp } from '../../src/ui/store';
import { failedBars, schlierenSignature, type SchlierenSignature } from './lib/schlierenCheck';
import '../../src/ui/global.css';

const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const OUT = env?.VITE_UI_LOOKDEV === '1' ? 'docs/look-dev/ui' : 'reports/ui';

const SIZES = [
  { id: '1920', w: 1920, h: 1001 },
  { id: '1366', w: 1366, h: 768 },
] as const;

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

async function until(what: string, pred: () => boolean, timeoutMs = 60_000): Promise<void> {
  const t0 = performance.now();
  while (!pred()) {
    const c = useApp.getState().connection;
    if (c.state === 'failed' || c.state === 'lost' || c.state === 'unsupported')
      throw new Error(`${what}: the app stopped (${c.state}: ${c.message})`);
    if (performance.now() - t0 > timeoutMs) throw new Error(`${what}: not within ${timeoutMs} ms`);
    await sleep(50);
  }
}

/** The worker's GPU errors and fatal messages (the store collects both), and its own errors. */
function problems(): string[] {
  const s = useApp.getState();
  return [...s.gpuErrors, ...(s.diagnostics?.errors ?? [])];
}

const fresh = useApp.getState();

async function boot(cycle?: 'partPowerFit') {
  // a fresh store: the last test's snapshot must not pass for this app's
  useApp.setState(fresh, true);
  render(cycle === undefined ? <App /> : <App cycle={cycle} />);
  await until('ready and a snapshot', () => {
    const s = useApp.getState();
    return s.connection.state === 'running' && s.snapshot !== null && s.diagnostics?.field != null;
  });
}

interface Shot {
  readonly w: number;
  readonly h: number;
  /** The luminance spread and the lit fraction of the centre of the view (the engine). */
  readonly centreStd: number;
  readonly centreLit: number;
  /**
   * W2A-I6: the frame's knife-edge Schlieren signature (null: no engine box on screen), on the
   * canvas alone (W2A-I10: the overlay hidden for that screenshot, so no label or legend in it).
   */
  readonly schlieren: SchlierenSignature | null;
  readonly jpeg: string;
}

const bitmapOf = async (png: string) =>
  createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());

/** The worker's canvas alone: a screenshot with the overlay hidden (W2A-I10). */
async function canvasAlone(): Promise<ImageBitmap> {
  const overlay = document.querySelector<HTMLElement>('.overlay');
  const was = overlay?.style.visibility ?? '';
  if (overlay !== null) overlay.style.visibility = 'hidden';
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await bitmapOf(await page.screenshot({ save: false }));
  } finally {
    if (overlay !== null) overlay.style.visibility = was;
  }
}

/** A screenshot of the page (the worker's canvas composited with the overlay), as a JPEG. */
async function shoot(): Promise<Shot> {
  const bmp = await bitmapOf(await page.screenshot({ save: false }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0);
  // the middle third of the width (between the columns), the middle half of the height
  const x0 = Math.round(bmp.width * 0.36);
  const y0 = Math.round(bmp.height * 0.3);
  const w = Math.round(bmp.width * 0.28);
  const h = Math.round(bmp.height * 0.4);
  const px = ctx.getImageData(x0, y0, w, h).data;
  let sum = 0;
  let sum2 = 0;
  let lit = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const l =
      (0.2126 * (px[4 * i] ?? 0) + 0.7152 * (px[4 * i + 1] ?? 0) + 0.0722 * (px[4 * i + 2] ?? 0)) /
      255;
    sum += l;
    sum2 += l * l;
    if (l > 0.25) lit++;
  }
  const mean = sum / n;
  // the JPEG at the CSS size (the shared Chrome runs at the OS's 1.5x scale)
  const out = document.createElement('canvas');
  out.width = window.innerWidth;
  out.height = window.innerHeight;
  out.getContext('2d')?.drawImage(bmp, 0, 0, out.width, out.height);
  const jpeg = out.toDataURL('image/jpeg', 0.9).slice('data:image/jpeg;base64,'.length);
  // the canvas's luminance at the CSS size, for the Schlieren signature (the engine box and the
  // free area are in CSS px)
  const raw = await canvasAlone();
  const cv = document.createElement('canvas');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  cv.getContext('2d')?.drawImage(raw, 0, 0, cv.width, cv.height);
  const cpx = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data;
  const lum = new Float32Array(out.width * out.height);
  if (cpx !== undefined)
    for (let i = 0; i < lum.length; i++)
      lum[i] =
        (0.2126 * (cpx[4 * i] ?? 0) +
          0.7152 * (cpx[4 * i + 1] ?? 0) +
          0.0722 * (cpx[4 * i + 2] ?? 0)) /
        255;
  const engineBox = useApp.getState().engineBox;
  const view = document.querySelector('.center')?.getBoundingClientRect();
  const schlieren =
    engineBox === null || view === undefined
      ? null
      : schlierenSignature(lum, cv.width, cv.height, engineBox, {
          x: view.left,
          y: view.top,
          w: view.width,
          h: view.height,
        });
  return {
    w: bmp.width,
    h: bmp.height,
    centreStd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    centreLit: lit / n,
    schlieren,
    jpeg,
  };
}

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};
const overlap = (a: DOMRect, b: DOMRect): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** The part of an element its scroll containers show (the drawer and the columns scroll). */
function shown(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom];
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    if (!p.matches('.drawer, .col')) continue;
    const c = p.getBoundingClientRect();
    [l, t, rt, b] = [
      Math.max(l, c.left),
      Math.max(t, c.top),
      Math.min(rt, c.right),
      Math.min(b, c.bottom),
    ];
  }
  return new DOMRect(l, t, Math.max(0, rt - l), Math.max(0, b - t));
}
const nameOf = (el: Element): string =>
  el.getAttribute('aria-label') ??
  el.closest('[aria-label]')?.getAttribute('aria-label') ??
  el.getAttribute('class') ??
  el.tagName;

type Seg = readonly [number, number, number, number];
/** Whether two segments cross properly (touching ends do not count). */
function segmentsCross(p: Seg, q: Seg): boolean {
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  return (
    o(p[0], p[1], p[2], p[3], q[0], q[1]) * o(p[0], p[1], p[2], p[3], q[2], q[3]) < 0 &&
    o(q[0], q[1], q[2], q[3], p[0], p[1]) * o(q[0], q[1], q[2], q[3], p[2], p[3]) < 0
  );
}
const edges = (r: DOMRect): Seg[] => [
  [r.left, r.top, r.right, r.top],
  [r.right, r.top, r.right, r.bottom],
  [r.right, r.bottom, r.left, r.bottom],
  [r.left, r.bottom, r.left, r.top],
];

/**
 * W2A-I3: the callouts as drawn: each rendered label against the others and against the blocks
 * the layout reserves, its text not cut, and no leader line crossing another leader or running
 * through another label (the layout's unit test checks the boxes it reserves; this checks what
 * the CSS renders, 147 x 37 px against 132 x 34 before the fix).
 */
function calloutProblems(): string[] {
  const out: string[] = [];
  const host = document.querySelector('.overlay .callouts');
  if (host === null) return out;
  const hostRect = host.getBoundingClientRect();
  const labels = [...host.querySelectorAll<HTMLElement>('.callout')].filter(visible);
  const reserved = [...document.querySelectorAll('.overlay [data-reserve]')].filter(
    (el) => visible(el) && shown(el).height > 0,
  );
  const id = (el: HTMLElement) => el.dataset.id ?? el.textContent;
  labels.forEach((a, i) => {
    const ra = a.getBoundingClientRect();
    for (const b of labels.slice(i + 1))
      if (overlap(ra, b.getBoundingClientRect()) > 0.5)
        out.push(`callout ${id(a)} overlaps callout ${id(b)}`);
    for (const r of reserved)
      if (overlap(ra, shown(r)) > 0.5) out.push(`callout ${id(a)} overlaps ${nameOf(r)}`);
    if (a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1)
      out.push(`callout ${id(a)} is cut off`);
  });
  // the leaders, in page px (the SVG fills the callouts' host)
  const leaders = [...host.querySelectorAll('.leaders line')].map((l) => {
    const n = (k: string) => Number(l.getAttribute(k));
    return {
      id: l.getAttribute('data-id') ?? '',
      seg: [
        hostRect.left + n('x1'),
        hostRect.top + n('y1'),
        hostRect.left + n('x2'),
        hostRect.top + n('y2'),
      ] as Seg,
    };
  });
  leaders.forEach((a, i) => {
    // W2A-N28: round 5's rule as drawn: no anchor under a panel, and no leader through one
    for (const r of reserved) {
      const b = shown(r);
      const [ax, ay] = a.seg;
      if (ax > b.left && ax < b.right && ay > b.top && ay < b.bottom)
        out.push(`callout ${a.id}'s anchor is under ${nameOf(r)}`);
      else if (edges(b).some((e) => segmentsCross(a.seg, e)))
        out.push(`leader ${a.id} runs through ${nameOf(r)}`);
    }
    for (const b of leaders.slice(i + 1))
      if (segmentsCross(a.seg, b.seg)) out.push(`leader ${a.id} crosses leader ${b.id}`);
    for (const l of labels)
      if (
        l.dataset.id !== a.id &&
        edges(l.getBoundingClientRect()).some((e) => segmentsCross(a.seg, e))
      )
        out.push(`leader ${a.id} runs through callout ${id(l)}`);
  });
  return out;
}

/**
 * The layout bar (Aaron's "ultra high level ui"; W2 app-ui NEXT 3): at the shot sizes nothing in
 * the overlay is off screen, cut off (a panel or column whose content overflows it) or overlapping
 * (two blocks, two labels in a chart, two dials), and the callouts as drawn (W2A-I3) collide with
 * nothing and their leaders cross nothing. The drawer scrolls by design.
 */
function layoutProblems(): string[] {
  const out: string[] = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const blocks = [
    ...document.querySelectorAll(
      '.overlay .topbar, .overlay .panel, .overlay .panel-toggles, .overlay .drawer, .overlay .dock-row, .overlay .legend, .overlay .annunciators > *',
    ),
  ].filter((el) => visible(el) && shown(el).height > 0);
  for (const b of blocks) {
    const r = shown(b);
    if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5)
      out.push(
        `${nameOf(b)} is off screen: ${r.left.toFixed(0)},${r.top.toFixed(0)}-${r.right.toFixed(0)},${r.bottom.toFixed(0)} of ${String(W)}x${String(H)}`,
      );
  }
  blocks.forEach((a, i) => {
    for (const b of blocks.slice(i + 1)) {
      if (a.contains(b) || b.contains(a)) continue;
      if (overlap(shown(a), shown(b)) > 1) out.push(`${nameOf(a)} overlaps ${nameOf(b)}`);
    }
  });
  for (const el of document.querySelectorAll('.overlay .col, .overlay .panel, .overlay .topbar')) {
    if (!visible(el) || el.closest('.drawer') !== null) continue;
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
      out.push(
        `${nameOf(el)} is cut off: content ${String(el.scrollWidth)}x${String(el.scrollHeight)} in ${String(el.clientWidth)}x${String(el.clientHeight)}`,
      );
  }
  for (const svg of document.querySelectorAll('.overlay svg')) {
    const texts = [...svg.querySelectorAll('text')].filter(visible);
    texts.forEach((a, i) => {
      for (const b of texts.slice(i + 1))
        if (overlap(a.getBoundingClientRect(), b.getBoundingClientRect()) > 0.5)
          out.push(`${nameOf(svg)}: "${a.textContent}" overlaps "${b.textContent}"`);
    });
  }
  const dials = [...document.querySelectorAll('.engine-display .dial, .engine-display .readouts')];
  dials.forEach((a, i) => {
    for (const b of dials.slice(i + 1))
      if (overlap(a.getBoundingClientRect(), b.getBoundingClientRect()) > 1)
        out.push(`engine display: ${nameOf(a)} overlaps ${nameOf(b)}`);
  });
  out.push(...calloutProblems());
  return out;
}

/**
 * D4-97 item 2 (W2A-I8): in the cut views (Cutaway, Data) the axial rows hold, at both sizes:
 * every label shown sits in a row above or below the engine's screen box, clear of it, and each
 * row keeps the parts' axial order left to right (D4-92 zz). The camera is framed for the rows,
 * and a label with no room in its row is hidden by priority, never placed on the section.
 */
function axialRowProblems(): string[] {
  const out: string[] = [];
  const host = document.querySelector('.overlay .callouts');
  const box = useApp.getState().engineBox;
  if (host === null || box === null) return ['no callouts or no engine box'];
  const h = host.getBoundingClientRect();
  const axial = new Map(useApp.getState().anchors.map((a) => [a.id, a.axial]));
  const labels = [...host.querySelectorAll<HTMLElement>('.callout[data-id]')]
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id ?? '', x: r.left - h.left, y: r.top - h.top, b: r.bottom - h.top };
    });
  if (labels.length === 0) out.push('no label shown');
  for (const above of [true, false]) {
    const row = labels.filter((l) => (above ? l.b <= box.y + 0.5 : l.y >= box.y + box.h - 0.5));
    const order = [...row].sort((p, q) => p.x - q.x).map((l) => axial.get(l.id) ?? NaN);
    if (order.some((v, k) => k > 0 && v < (order[k - 1] ?? -Infinity)))
      out.push(
        `the ${above ? 'top' : 'bottom'} row is out of axial order: ${row.map((l) => l.id).join(', ')}`,
      );
  }
  for (const l of labels)
    if (!(l.b <= box.y + 0.5 || l.y >= box.y + box.h - 0.5))
      out.push(
        `callout ${l.id} is on the engine (${l.y.toFixed(0)}-${l.b.toFixed(0)} in ${box.y.toFixed(0)}-${(box.y + box.h).toFixed(0)}), not in a row`,
      );
  return out;
}

/** D4-88: the worker says the view has settled in `mode` (its transition done, TRAA converged). */
function settledIn(mode: ViewMode): boolean {
  const s = useApp.getState();
  return (
    s.snapshot?.view.viewMode === mode &&
    s.diagnostics?.view.mode === mode &&
    s.diagnostics.view.settledFrames >= SETTLED_FRAMES
  );
}

async function toMode(mode: ViewMode) {
  await page.getByRole('radio', { name: new RegExp(`^${mode}`, 'i') }).click();
  // W2A-I4: shoot on the worker's settled-view signal, not after a fixed wait
  await until(`view mode ${mode} settled`, () => settledIn(mode));
  // the callouts' CSS move (160 ms) and the next snapshot's layout
  const v = useApp.getState().snapshot?.version ?? 0;
  await until('two more snapshots', () => (useApp.getState().snapshot?.version ?? 0) >= v + 2);
}

describe('the app in Chrome', () => {
  afterEach(() => {
    cleanup();
  });

  for (const size of SIZES)
    it(`boots, draws all 5 modes with no GPU error at ${size.w} x ${size.h}, and shoots them`, async () => {
      await page.viewport(size.w, size.h);
      await boot();
      expect(problems()).toEqual([]);
      const rows: string[] = [];
      const layout: string[] = [];
      for (const [i, mode] of VIEW_MODES.entries()) {
        await toMode(mode);
        layout.push(...layoutProblems().map((p) => `${mode}: ${p}`));
        if (mode === 'cutaway' || mode === 'data') {
          layout.push(...axialRowProblems().map((p) => `${mode}: ${p}`));
          const shownIds = [...document.querySelectorAll<HTMLElement>('.overlay .callout[data-id]')]
            .filter(visible)
            .map((el) => el.dataset.id);
          rows.push(
            `  ${mode} callouts shown (${String(shownIds.length)}): ${shownIds.join(', ')}`,
          );
        }
        const shot = await shoot();
        await commands.writeFile(
          `${OUT}/${size.id}-${String(i + 1)}-${mode}.jpg`,
          shot.jpeg,
          'base64',
        );
        const d = useApp.getState().diagnostics;
        const bs = d?.backingStore;
        rows.push(
          `${mode}: ${String(shot.w)}x${String(shot.h)} centre std ${shot.centreStd.toFixed(3)} lit ${shot.centreLit.toFixed(3)} · backing ${String(bs?.width)}x${String(bs?.height)} · render ${d?.budget.renderGpuMs?.toFixed(1) ?? '-'} ms · flow ${d?.budget.flowVisualsGpuMs.toFixed(1) ?? '-'} ms · ${String(d?.budget.fps)} fps`,
        );
        // D4-85: up to high the backing store is capped at 1920 x 1080 pixels
        expect((bs?.width ?? Infinity) * (bs?.height ?? Infinity), mode).toBeLessThanOrEqual(
          BACKING_STORE_MAX_PX,
        );
        // the engine is drawn: the centre of the view is not one flat colour
        expect(shot.centreStd, `${mode}: centre luminance spread`).toBeGreaterThan(0.03);
        // and lit, except in Schlieren, which draws the engine as a dim silhouette by design
        // (the beauty x 0.22 inside the engine box, src/render/post.ts). Round 2's Schlieren
        // shots passed this only because they showed the exploded engine (W2A-I4).
        if (mode !== 'schlieren')
          expect(shot.centreLit, `${mode}: lit fraction of the centre`).toBeGreaterThan(0.02);
        // W2A-I6: Schlieren's own check (the grey field, the dim silhouette, the banded jet), on
        // the canvas alone. W2A-I10: each bar has its own failing control, stated before the run:
        // Realistic and Exploded (a lit engine) fail the silhouette bar, Cutaway and Data (the
        // studio round a near-field plane) the grey-share bar, and S1 (the knife edge off, below)
        // the jet bar
        const sig = JSON.stringify(shot.schlieren);
        rows.push(`  ${mode} schlieren signature ${sig}`);
        const fails = shot.schlieren === null ? null : failedBars(shot.schlieren);
        if (mode === 'schlieren') {
          expect(shot.schlieren?.pass, `schlieren: ${sig}`).toBe(true);
          // S1: the same view with the knife edge compositing no deflection (the bandless jet)
          useApp.getState().post({ type: 'debug', knifeEdge: false });
          const v = useApp.getState().snapshot?.version ?? 0;
          await until('S1 drawn', () => (useApp.getState().snapshot?.version ?? 0) >= v + 10);
          const s1 = await shoot();
          useApp.getState().post({ type: 'debug', knifeEdge: true });
          const s1sig = JSON.stringify(s1.schlieren);
          rows.push(`  schlieren S1 (knife edge off, control) schlieren signature ${s1sig}`);
          expect(s1.schlieren?.pass, `S1 (control): ${s1sig}`).toBe(false);
          expect(s1.schlieren === null ? null : failedBars(s1.schlieren), s1sig).toContain('jet');
          const v1 = useApp.getState().snapshot?.version ?? 0;
          await until(
            'knife edge back',
            () => (useApp.getState().snapshot?.version ?? 0) >= v1 + 10,
          );
        } else {
          expect(shot.schlieren?.pass, `${mode} (control): ${sig}`).toBe(false);
          expect(fails, `${mode} (control): ${sig}`).toContain(
            mode === 'realistic' || mode === 'exploded' ? 'silhouette' : 'grey',
          );
        }
        expect(problems(), mode).toEqual([]);
      }
      // the drawer (Diagnostics and What's simulated) opens without covering the other panels
      await page.getByRole('button', { name: 'Diagnostics' }).click();
      await page.getByRole('button', { name: "What's simulated" }).click();
      await sleep(300);
      layout.push(...layoutProblems().map((p) => `drawer open: ${p}`));
      const drawer = await shoot();
      await commands.writeFile(`${OUT}/${size.id}-6-drawer.jpg`, drawer.jpeg, 'base64');
      // D4-85's record: the engine render back in Realistic once the frame-cost window (120
      // frames) holds only settled Realistic frames, beside P4's 8 ms (indicative: shared machine)
      await page.getByRole('button', { name: 'Diagnostics' }).click();
      await page.getByRole('button', { name: "What's simulated" }).click();
      await toMode('realistic');
      const v0 = useApp.getState().snapshot?.version ?? 0;
      await until(
        'a full frame-cost window',
        () => (useApp.getState().snapshot?.version ?? 0) >= v0 + 50,
      );
      const settled = useApp.getState().diagnostics;
      await commands.writeFile(
        `reports/ui/render-${size.id}.json`,
        `${JSON.stringify(
          {
            viewport: `${String(size.w)}x${String(size.h)}`,
            devicePixelRatio: window.devicePixelRatio,
            backingStore: settled?.backingStore,
            realisticRenderGpuMs: settled?.budget.renderGpuMs,
            flowVisualsGpuMs: settled?.budget.flowVisualsGpuMs,
            fps: settled?.budget.fps,
            p4BudgetMs: 8,
          },
          null,
          2,
        )}\n`,
      );
      rows.push(
        `realistic again (a full window): render ${settled?.budget.renderGpuMs?.toFixed(1) ?? '-'} ms · flow ${settled?.budget.flowVisualsGpuMs.toFixed(1) ?? '-'} ms · ${String(settled?.budget.fps)} fps at dpr ${String(window.devicePixelRatio)}`,
      );
      // D4-85: ultra is the explicit opt-in to the full device pixel ratio
      const dpr = useApp.getState().diagnostics?.backingStore.dpr ?? 0;
      await page.getByRole('combobox', { name: 'Quality' }).selectOptions('ultra');
      await until('the ultra backing store', () => {
        const b = useApp.getState().diagnostics?.backingStore;
        return b?.width === Math.floor(window.innerWidth * Math.min(2, window.devicePixelRatio));
      });
      const ultra = useApp.getState().diagnostics?.backingStore;
      await commands.writeFile(
        `${OUT}/${size.id}-shots.txt`,
        `${[...rows, `ultra: backing ${String(ultra?.width)}x${String(ultra?.height)} at dpr ${String(ultra?.dpr)} (high: ${String(dpr)})`, ...layout.map((l) => `LAYOUT ${l}`)].join('\n')}\n`,
      );
      expect(useApp.getState().connection.state).toBe('running');
      expect(problems()).toEqual([]);
      expect(layout).toEqual([]);
    });

  it('D4-82: the solver field is labelled uncoupled until W3 on the badge and the legend', async () => {
    await page.viewport(1920, 1001);
    await boot();
    await toMode('data');
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await page
      .getByRole('group', { name: 'Drawn flow field' })
      .getByRole('button', { name: 'Solver' })
      .click();
    await until(
      'the solver field bound (or a fallback)',
      () => useApp.getState().diagnostics?.field?.asked === 'solver',
    );
    const field = useApp.getState().diagnostics?.field;
    // a fallback here would be a real failure to start the solver: say why
    expect(field?.fallback ?? null).toBeNull();
    expect(field?.coupling).toBe('uncoupled');
    await until(
      'the snapshot says solver',
      () => useApp.getState().snapshot?.sources.flow === 'solver',
    );
    const prov = document.querySelector('[aria-label="Data provenance"]')?.textContent ?? '';
    expect(prov).toContain('FIELD: solver (uncoupled until W3)');
    const legend = document.querySelector('[aria-label="Flow legend"]')?.textContent ?? '';
    expect(legend).toMatch(/solver \(uncoupled until W3\)/);
    await sleep(1500);
    const d = useApp.getState().diagnostics;
    // the drawn solver steps at D4-2's budget
    expect(d?.budget.solverIterations ?? 0).toBeGreaterThan(0);
    const shot = await shoot();
    await commands.writeFile(`${OUT}/1920-data-solver.jpg`, shot.jpeg, 'base64');
    expect(problems()).toEqual([]);
  });

  it('W2F-N5: records the worker frame cost while the gas path is held (the part-power fit slam, on a fixed dt: W2H-I5)', async () => {
    await page.viewport(1366, 768);
    await boot('partPowerFit');
    // W2A-I5: five quick ArrowUp presses on the focused lever land at 0.05 (the lever shows what
    // it sent until the snapshot's seq echo catches up; before, each press restarted from the
    // last echo and the worker ended at 0.01)
    const lever = document.querySelector<HTMLInputElement>('input[type="range"]');
    if (lever === null) throw new Error('no thrust lever');
    lever.focus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(lever.value).toBe('0.05');
    await until(
      'the lever echoed',
      () => {
        const s = useApp.getState().snapshot;
        return s !== null && Math.abs(s.inputs.throttleLever - 0.05) < 1e-9;
      },
      5000,
    );
    expect(lever.value).toBe('0.05');
    // D4-98 item 2 (W2H-I5): the case steps the sim on a fixed dt, so it is the same every run
    // (with the real frame times the fit's sub-idle throw was intermittent; its cause is the
    // part-power round's). The sim holds, resets to ground idle, and steps counted frames of
    // FIXED_DT; each lever change is sent while it holds, so the inputs meet the same steps every
    // run. The app itself keeps the real frame time.
    const FIXED_DT = 1 / 60;
    let asked = 0;
    const step = async (frames: number, what: string) => {
      asked += frames;
      useApp.getState().post({ type: 'debug', simSteps: { dtS: FIXED_DT, frames } });
      await until(what, () => (useApp.getState().diagnostics?.fixedSteps?.frames ?? -1) >= asked);
      expect(useApp.getState().diagnostics?.fixedSteps?.left, what).toBe(0);
    };
    await step(0, 'the sim held on the fixed steps');
    useApp.getState().send({ type: 'reset', initial: 'groundIdle' });
    useApp.getState().send({ type: 'setThrottle', lever: 0.05 });
    // 3 s at 0.05, then the w2f-c12 probe's case: the lever ramped from idle to take-off over 1 s
    // of sim time, in 20 steps of 0.05 every 3 frames
    await step(180, 'the idle hold');
    const before = useApp.getState().diagnostics?.budget;
    for (let k = 1; k <= 20; k++) {
      useApp.getState().send({ type: 'setThrottle', lever: 0.05 * k });
      await step(3, `the ramp at ${String(0.05 * k)}`);
    }
    const worst: Record<string, number> = {};
    const keep = (k: keyof FrameBudget, v: number | null) => {
      if (v !== null && Number.isFinite(v)) worst[k] = Math.max(worst[k] ?? 0, v);
    };
    let heldSnapshots = 0;
    let snapshots = 0;
    let lastVersion = -1;
    // then 20 s of sim time at take-off, stepped as one batch (the frame cost is the worker's)
    asked += 1200;
    useApp.getState().post({ type: 'debug', simSteps: { dtS: FIXED_DT, frames: 1200 } });
    const t0 = performance.now();
    while ((useApp.getState().diagnostics?.fixedSteps?.frames ?? -1) < asked) {
      if (performance.now() - t0 > 90_000)
        throw new Error('the 1200 fixed frames: not within 90 s');
      const s = useApp.getState();
      if (s.snapshot !== null && s.snapshot.version !== lastVersion && s.diagnostics !== null) {
        lastVersion = s.snapshot.version;
        snapshots++;
        if (s.snapshot.cycle.gasPathSolve.status === 'held') heldSnapshots++;
        const b = s.diagnostics.budget;
        for (const k of [
          'cycleCpuMs',
          'cycleCpuMaxMs',
          'cycleCpuHeldMs',
          'frameCpuMs',
          'frameCpuMaxMs',
          'frameCpuHeldMs',
          'mockRasterMs',
        ] as const)
          keep(k, b[k]);
      }
      await sleep(16);
    }
    const s = useApp.getState();
    const end = s.diagnostics?.budget;
    const record = {
      viewport: '1366x768',
      fixedDtS: FIXED_DT,
      fixedFrames: s.diagnostics?.fixedSteps?.frames ?? null,
      simTimeS: s.snapshot?.clock.simTimeS ?? null,
      lostSolves: s.snapshot?.cycle.gasPathSolve.lostSolves ?? 0,
      heldSnapshots,
      snapshots,
      idle:
        before === undefined
          ? null
          : {
              cycleCpuMs: before.cycleCpuMs,
              frameCpuMs: before.frameCpuMs,
              mockRasterMs: before.mockRasterMs,
            },
      worstOverTheSlam: worst,
      end:
        end === undefined
          ? null
          : {
              cycleCpuMs: end.cycleCpuMs,
              frameCpuMs: end.frameCpuMs,
              mockRasters: end.mockRasters,
              fps: end.fps,
            },
      n1End: s.snapshot?.cycle.n1Percent ?? null,
    };
    await commands.writeFile('reports/ui/frame-cost.json', `${JSON.stringify(record, null, 2)}\n`);
    // every frame asked for was stepped on the fixed dt (W2H-I5: the same case every run)
    expect(record.fixedFrames).toBe(asked);
    // the case exercises a held gas path, or its numbers would not answer W2F-N5
    expect(record.lostSolves).toBeGreaterThan(0);
    expect(problems()).toEqual([]);
  });
});
