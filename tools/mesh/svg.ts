// SVG plots of a multi-block mesh: grid lines per block, block outlines, walls and the axis, a
// title and a legend. Static images for docs/MESH.md, so they carry their own light surface (they
// read the same on GitHub's light and dark themes).
//
// Colour identifies blocks, but never alone: there are more blocks (12) than distinguishable
// categorical hues (8, the validated reference palette of the dataviz skill), so slots repeat on
// blocks that never touch, and every visible block is also labelled by name and in the legend.
import { BC, nodeIndex, type Block, type MultiBlockMesh } from './types';
import { faceNodeIJ } from './topology';

export interface SvgView {
  readonly title: string;
  readonly xMin: number;
  readonly xMax: number;
  readonly rMin: number;
  readonly rMax: number;
  readonly widthPx: number;
  /** Draw every n-th grid line (block outlines are always drawn). Default 1. */
  readonly lineStride?: number;
  /** Categorical slot (0-7) per block name; default: block index mod 8. */
  readonly slots?: Readonly<Record<string, number>>;
  /** Optional subtitle line under the title. */
  readonly subtitle?: string;
}

/** Reference categorical palette, light mode (dataviz skill references/palette.md). */
const SERIES = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
];
const SURFACE = '#fcfcfb';
const TEXT = '#0b0b0b';
const TEXT_2 = '#52514e';
const HEADER = 44;
const LEGEND_ROW = 20;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const fmt = (v: number): string => (Math.round(v * 10) / 10).toString();

export function renderSvg(mesh: MultiBlockMesh, view: SvgView): string {
  const W = view.widthPx;
  const H = Math.max(1, Math.round((W * (view.rMax - view.rMin)) / (view.xMax - view.xMin)));
  const sx = W / (view.xMax - view.xMin);
  const sy = H / (view.rMax - view.rMin);
  const px = (x: number): number => (x - view.xMin) * sx;
  const py = (r: number): number => HEADER + (view.rMax - r) * sy;
  const stride = Math.max(1, view.lineStride ?? 1);
  // segment visibility test with a small margin
  const mx = 0.02 * (view.xMax - view.xMin);
  const mr = 0.02 * (view.rMax - view.rMin);
  const segVisible = (x0: number, r0: number, x1: number, r1: number): boolean =>
    Math.max(x0, x1) >= view.xMin - mx &&
    Math.min(x0, x1) <= view.xMax + mx &&
    Math.max(r0, r1) >= view.rMin - mr &&
    Math.min(r0, r1) <= view.rMax + mr;

  /** Path data for a node sequence, broken into visible runs. */
  const polyline = (b: Block, nodes: readonly [number, number][]): string => {
    let d = '';
    let open = false;
    for (let k = 0; k + 1 < nodes.length; k++) {
      const [i0, j0] = nodes[k] as [number, number];
      const [i1, j1] = nodes[k + 1] as [number, number];
      const a = nodeIndex(b, i0, j0);
      const c = nodeIndex(b, i1, j1);
      const x0 = b.x[a] ?? 0;
      const r0 = b.r[a] ?? 0;
      const x1 = b.x[c] ?? 0;
      const r1 = b.r[c] ?? 0;
      if (!segVisible(x0, r0, x1, r1)) {
        open = false;
        continue;
      }
      if (!open) d += `M${fmt(px(x0))} ${fmt(py(r0))}`;
      d += `L${fmt(px(x1))} ${fmt(py(r1))}`;
      open = true;
    }
    return d;
  };
  const row = (j: number, b: Block): [number, number][] =>
    Array.from({ length: b.ni + 1 }, (_, i) => [i, j]);
  const col = (i: number, b: Block): [number, number][] =>
    Array.from({ length: b.nj + 1 }, (_, j) => [i, j]);

  const groups: string[] = [];
  const labels: string[] = [];
  const visible: { name: string; colour: string }[] = [];
  mesh.blocks.forEach((b, bi) => {
    const colour = SERIES[(view.slots?.[b.name] ?? bi) % SERIES.length] ?? TEXT_2;
    let grid = '';
    for (let j = stride; j < b.nj; j += stride) grid += polyline(b, row(j, b));
    for (let i = stride; i < b.ni; i += stride) grid += polyline(b, col(i, b));
    const outline =
      polyline(b, row(0, b)) +
      polyline(b, row(b.nj, b)) +
      polyline(b, col(0, b)) +
      polyline(b, col(b.ni, b));
    if (grid === '' && outline === '') return;
    visible.push({ name: b.name, colour });
    groups.push(
      `<g data-block="${escapeXml(b.name)}">` +
        (grid === '' ? '' : `<path class="grid" stroke="${colour}" d="${grid}"/>`) +
        `<path class="outline" d="${outline}"/></g>`,
    );
    // label at the visible node nearest the block's visible centroid
    let sxv = 0;
    let srv = 0;
    let n = 0;
    for (let k = 0; k < b.x.length; k++) {
      const x = b.x[k] ?? 0;
      const r = b.r[k] ?? 0;
      if (x >= view.xMin && x <= view.xMax && r >= view.rMin && r <= view.rMax) {
        sxv += x;
        srv += r;
        n++;
      }
    }
    if (n > 0) {
      labels.push(
        `<text class="block-label" x="${fmt(px(sxv / n))}" y="${fmt(py(srv / n))}">${escapeXml(b.name)}</text>`,
      );
    }
  });

  const boundaries: string[] = [];
  for (const p of mesh.patches) {
    if (p.bc !== BC.SLIP_WALL && p.bc !== BC.AXIS) continue;
    const b = mesh.blocks[p.block];
    if (b === undefined) continue;
    const nodes: [number, number][] = [];
    for (let k = p.start; k <= p.end; k++) nodes.push(faceNodeIJ(b, p.face, k));
    const d = polyline(b, nodes);
    if (d !== '') boundaries.push(`<path class="${p.bc === BC.AXIS ? 'axis' : 'wall'}" d="${d}"/>`);
  }

  const perRow = Math.max(1, Math.floor(W / 130));
  const legendRows = Math.ceil(visible.length / perRow);
  const total = HEADER + H + 10 + legendRows * LEGEND_ROW + 6;
  const legend = visible
    .map((v, k) => {
      const x = 12 + (k % perRow) * 130;
      const y = HEADER + H + 10 + Math.floor(k / perRow) * LEGEND_ROW;
      return (
        `<g class="legend-item" transform="translate(${x} ${y})">` +
        `<rect width="14" height="10" y="2" rx="2" fill="${v.colour}"/>` +
        `<text x="20" y="11">${escapeXml(v.name)}</text></g>`
      );
    })
    .join('');

  const title = escapeXml(view.title);
  const subtitle = view.subtitle === undefined ? '' : escapeXml(view.subtitle);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${total}" width="${W}" height="${total}" role="img" aria-labelledby="t d">`,
    `<title id="t">${title}</title><desc id="d">${subtitle === '' ? title : subtitle}</desc>`,
    '<style>',
    `text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;fill:${TEXT}}`,
    `.sub{fill:${TEXT_2};font-size:12px}.ttl{font-size:15px;font-weight:600}`,
    '.grid{fill:none;stroke-width:0.45;stroke-linejoin:round}',
    `.outline{fill:none;stroke:${TEXT_2};stroke-width:0.9}`,
    `.wall{fill:none;stroke:${TEXT};stroke-width:1.8;stroke-linecap:round}`,
    `.axis{fill:none;stroke:${TEXT_2};stroke-width:1.2;stroke-dasharray:6 4}`,
    `.block-label{font-size:11px;text-anchor:middle;paint-order:stroke;stroke:${SURFACE};stroke-width:3px}`,
    `.legend-item text{font-size:12px;fill:${TEXT_2}}`,
    '</style>',
    `<rect width="${W}" height="${total}" fill="${SURFACE}"/>`,
    `<text class="ttl" x="12" y="20">${title}</text>`,
    subtitle === '' ? '' : `<text class="sub" x="12" y="37">${subtitle}</text>`,
    `<clipPath id="plot"><rect x="0" y="${HEADER}" width="${W}" height="${H}"/></clipPath>`,
    `<g clip-path="url(#plot)">${groups.join('')}${boundaries.join('')}${labels.join('')}</g>`,
    legend,
    '</svg>',
    '',
  ].join('\n');
}
