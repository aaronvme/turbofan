// Mesh generator: builds both production specs on the real EngineDefinition. Run with
// `npm run mesh` (plain Node >= 24 with tools/mesh/ts-resolve.mjs, no dependencies).
//
//   public/mesh/mesh-<spec>.bin        the binary v2 asset (f32 metrics), not committed: the build
//   public/mesh/manifest.json          and the dev server regenerate it (`npm run mesh:assets`);
//                                      the manifest (sizes, counts, SHA-256) is committed, and
//                                      tests/mesh/asset.test.ts checks a fresh build against it
//   docs/mesh/mesh-<spec>-<view>.svg   full domain, engine overview and the zooms docs/MESH.md shows
//   docs/mesh/metrics-<spec>.json      engineMeshReport plus the spec and the explicit dt limit
//
// Options: --assets (write only public/mesh), --out <dir> (docs output, default docs/mesh).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_DEFINITION, ENGINE_MEANLINE } from '../../../src/engine/definition';
import { COLD_GAS, HOT_GAS } from '../../../src/engine/designPoint';
import {
  MESH_130K,
  MESH_80K,
  buildEngineMesh,
  meshFileMaps,
  type EngineMesh,
  type MeshSpec,
} from '../engineMesh';
import { decodeMeshFile, encodeMeshFile, meshFileFromMesh, VERSION } from '../format';
import { flowpathFromDefinition } from '../geometry/definition';
import { engineMeshReport, explicitDtLimit, type WaveSpeeds } from '../report';
import { renderSvg, type SvgView } from '../svg';

const args = process.argv.slice(2);
const assetsOnly = args.includes('--assets');
const docs = resolve(
  args.includes('--out') ? (args[args.indexOf('--out') + 1] ?? 'docs/mesh') : 'docs/mesh',
);
const assets = resolve('public/mesh');
const say = (s: string): void => {
  process.stdout.write(`${s}\n`);
};

// categorical slots such that blocks that touch never share a colour (svg.ts)
const SLOTS: Readonly<Record<string, number>> = {
  upstream: 0,
  inlet: 1,
  lip: 2,
  fan: 3,
  bypass: 4,
  core: 5,
  afterbody: 6,
  plug: 7,
  'plume-core': 0,
  'plume-bypass': 1,
  'plume-outer': 3,
  farfield: 4,
};

type View = Omit<SvgView, 'title' | 'subtitle' | 'slots'> & { name: string; title: string };

function views(mesh: EngineMesh, zooms: boolean): View[] {
  const { xIn, xOut, rOut } = mesh.domain;
  const view = (
    name: string,
    title: string,
    box: readonly [number, number, number, number],
    widthPx: number,
    lineStride?: number,
  ): View => ({
    name,
    title,
    xMin: box[0],
    xMax: box[1],
    rMin: box[2],
    rMax: box[3],
    widthPx,
    ...(lineStride === undefined ? {} : { lineStride }),
  });
  const all = [
    view('domain', 'Full domain', [xIn, xOut, 0, rOut], 1600, 8),
    view('engine', 'Engine', [-1.2, 4.0, 0, 1.6], 1400, 3),
  ];
  if (!zooms) return all;
  return [
    ...all,
    view(
      'inlet-lip',
      'Inlet lip (C-block, valence-5 points P1 and P2)',
      [-1.05, -0.45, 0.55, 1.15],
      960,
    ),
    view('fan', 'Fan: swept leading and trailing edges on grid lines', [-0.06, 0.3, 0.2, 0.8], 800),
    view('splitter', 'Splitter', [0.15, 0.55, 0.28, 0.6], 900),
    view('hpc-rear', 'HPC rear (19-20 mm chords, 4.5 mm gaps)', [1.3, 1.5, 0.24, 0.3], 1100),
    view('core-nozzle', 'Core nozzle and bypass shear layer', [2.35, 3.05, 0.15, 0.85], 900),
    view('plug', 'Plug tip (45 degree cone)', [3.1, 3.6, 0, 0.3], 960),
  ];
}

/** Six significant digits: enough for the docs, stable across platforms. */
function rounded(_key: string, v: unknown): unknown {
  return typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v;
}

// Signal speeds for the explicit time-step estimate (D0-7): in the core, |c_x| + c axially and c
// radially from the design-point mean line (linear in x between row edges); elsewhere 650 m/s
// both ways (|u| + c of the cold stream and the near field stays below that).
const planes = ENGINE_MEANLINE.filter(
  (row) => row.component !== 'fan' && row.component !== 'bypassDuct',
)
  .flatMap((row) => {
    const g = row.component === 'hpt' || row.component === 'lpt' ? HOT_GAS : COLD_GAS;
    const R = g.cpJPerKgK * (1 - 1 / g.gamma);
    return [row.inlet, row.exit].map((p) => {
      const c = Math.sqrt((g.gamma * R * p.ttK) / (1 + 0.5 * (g.gamma - 1) * p.mach * p.mach));
      return { x: p.x, ax: Math.abs(p.cxMPerS) + c, ar: c };
    });
  })
  .sort((a, b) => a.x - b.x);
function speeds(x: number, _r: number, block: string): WaveSpeeds {
  if (block !== 'core') return { ax: 650, ar: 650 };
  const k = planes.findIndex((p) => p.x >= x);
  const b = planes[k < 0 ? planes.length - 1 : k];
  const a = planes[k <= 0 ? 0 : k - 1];
  if (a === undefined || b === undefined) return { ax: 650, ar: 650 };
  const u = b.x > a.x ? Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x))) : 0;
  return { ax: a.ax + u * (b.ax - a.ax), ar: a.ar + u * (b.ar - a.ar) };
}

const geometry = flowpathFromDefinition(ENGINE_DEFINITION);
const manifest: Record<string, unknown> = {};

function generate(spec: MeshSpec, zooms: boolean): void {
  const t0 = performance.now();
  const mesh = buildEngineMesh(geometry, spec);
  const ms = performance.now() - t0;
  const bytes = encodeMeshFile(meshFileFromMesh(mesh, 'f32', meshFileMaps(mesh)));
  const again = encodeMeshFile(decodeMeshFile(bytes));
  if (again.length !== bytes.length || again.some((b, k) => b !== bytes[k]))
    throw new Error(`${spec.name}: writer -> reader -> writer is not bitwise identical`);
  const file = `mesh-${spec.name}.bin`;
  writeFileSync(join(assets, file), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest[spec.name] = {
    file,
    bytes: bytes.length,
    cells: mesh.totalCells,
    blocks: mesh.blocks.length,
    sha256,
  };
  say(
    `${spec.name}: ${mesh.totalCells} cells, built in ${ms.toFixed(0)} ms; ${file} ` +
      `${bytes.length} bytes, sha256 ${sha256.slice(0, 16)}...`,
  );
  if (assetsOnly) return;

  const report = engineMeshReport(mesh);
  const dt = explicitDtLimit(mesh, speeds);
  const f64 = encodeMeshFile(meshFileFromMesh(mesh, 'f64', meshFileMaps(mesh))).length;
  say(
    `  worst: stretch ${report.worst.maxStretch.value.toFixed(3)} (${report.worst.maxStretch.block}),` +
      ` skew ${report.worst.maxSkewDeg.value.toFixed(1)} deg (${report.worst.maxSkewDeg.block}),` +
      ` min Jacobian ${report.worst.minJacobian.value.toExponential(2)} m^2,` +
      ` min edge ${(1000 * report.worst.minEdge.value).toFixed(2)} mm (${report.worst.minEdge.block}),` +
      ` explicit dt ${(1e6 * dt.dt).toFixed(2)} us (${dt.block})`,
  );
  const json = {
    spec,
    report,
    stations: mesh.stations,
    rows: mesh.rows,
    explicitDt: dt,
    binaryBytes: { f64, f32: bytes.length },
  };
  writeFileSync(join(docs, `metrics-${spec.name}.json`), `${JSON.stringify(json, rounded, 2)}\n`);
  const subtitle = `${geometry.name} - ${spec.name} spec, ${mesh.totalCells} cells`;
  for (const v of views(mesh, zooms)) {
    const { name, ...rest } = v;
    const svg = renderSvg(mesh, { ...rest, subtitle, slots: SLOTS });
    writeFileSync(join(docs, `mesh-${spec.name}-${name}.svg`), svg);
    say(`  wrote mesh-${spec.name}-${name}.svg (${(svg.length / 1024).toFixed(0)} kB)`);
  }
}

mkdirSync(assets, { recursive: true });
if (!assetsOnly) mkdirSync(docs, { recursive: true });
generate(MESH_130K, true);
generate(MESH_80K, false);
writeFileSync(
  join(assets, 'manifest.json'),
  `${JSON.stringify({ format: 'turbofan-mesh', version: VERSION, specs: manifest }, null, 2)}\n`,
);
say('wrote public/mesh/manifest.json');
