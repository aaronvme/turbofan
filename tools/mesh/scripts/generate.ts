// Mesh generator: builds both production specs on the placeholder flowpath and writes the docs
// artefacts. Run with `npm run mesh` (plain Node >= 24 with tools/mesh/ts-resolve.mjs, no deps).
//
//   docs/mesh/mesh-<spec>-<view>.svg   full domain, engine overview and the zooms docs/MESH.md shows
//   docs/mesh/metrics-<spec>.json      engineMeshReport (counts, quality, resolution) plus the spec
//   <tmp>/turbofan-mesh-<spec>-<p>.bin the binary v1 asset, f64 and f32, round-tripped bitwise
//                                      (written to the OS temp dir, not committed)
//
// Options: --out <dir> (default docs/mesh).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  MESH_130K,
  MESH_80K,
  buildEngineMesh,
  type EngineMesh,
  type MeshSpec,
} from '../engineMesh';
import { decodeMeshFile, encodeMeshFile, meshFileFromMesh } from '../format';
import { placeholderFlowpath } from '../geometry/placeholder';
import { engineMeshReport } from '../report';
import { renderSvg, type SvgView } from '../svg';

const out = resolve(
  process.argv.includes('--out')
    ? (process.argv[process.argv.indexOf('--out') + 1] ?? 'docs/mesh')
    : 'docs/mesh',
);
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
  const all: View[] = [
    {
      name: 'domain',
      title: 'Full domain',
      xMin: xIn,
      xMax: xOut,
      rMin: 0,
      rMax: rOut,
      widthPx: 1600,
      lineStride: 8,
    },
    {
      name: 'engine',
      title: 'Engine',
      xMin: -1.2,
      xMax: 4.2,
      rMin: 0,
      rMax: 1.6,
      widthPx: 1400,
      lineStride: 3,
    },
  ];
  if (!zooms) return all;
  return [
    ...all,
    {
      name: 'inlet-lip',
      title: 'Inlet lip (C-block)',
      xMin: -0.95,
      xMax: -0.35,
      rMin: 0.55,
      rMax: 1.05,
      widthPx: 960,
    },
    {
      name: 'splitter',
      title: 'Splitter',
      xMin: 0.22,
      xMax: 0.72,
      rMin: 0.26,
      rMax: 0.8,
      widthPx: 800,
    },
    {
      name: 'hpc-rear',
      title: 'HPC rear (2.5 cm annulus)',
      xMin: 1.3,
      xMax: 1.72,
      rMin: 0.2,
      rMax: 0.36,
      widthPx: 960,
    },
    {
      name: 'core-nozzle',
      title: 'Core nozzle and bypass shear layer',
      xMin: 2.6,
      xMax: 3.3,
      rMin: 0.12,
      rMax: 0.78,
      widthPx: 900,
    },
    {
      name: 'plug',
      title: 'Plug',
      xMin: 2.9,
      xMax: 3.8,
      rMin: 0,
      rMax: 0.5,
      widthPx: 960,
    },
  ];
}

/** Six significant digits: enough for the docs, stable across platforms. */
function rounded(_key: string, v: unknown): unknown {
  return typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v;
}

function roundTrip(mesh: EngineMesh, precision: 'f64' | 'f32'): { path: string; bytes: number } {
  const bytes = encodeMeshFile(meshFileFromMesh(mesh, precision));
  const path = join(tmpdir(), `turbofan-mesh-${mesh.spec.name}-${precision}.bin`);
  writeFileSync(path, bytes);
  const again = encodeMeshFile(decodeMeshFile(new Uint8Array(readFileSync(path))));
  if (again.length !== bytes.length || again.some((b, k) => b !== bytes[k]))
    throw new Error(`${path}: writer -> reader -> writer is not bitwise identical`);
  return { path, bytes: bytes.length };
}

function generate(spec: MeshSpec, zooms: boolean): void {
  const geometry = placeholderFlowpath();
  const t0 = performance.now();
  const mesh = buildEngineMesh(geometry, spec);
  const ms = performance.now() - t0;
  const report = engineMeshReport(mesh);
  say(
    `${spec.name}: ${mesh.totalCells} cells (${(100 * report.deviation).toFixed(1)} % from ` +
      `${spec.targetCells}), built in ${ms.toFixed(0)} ms`,
  );
  say(
    `  worst: stretch ${report.worst.maxStretch.value.toFixed(3)} (${report.worst.maxStretch.block}),` +
      ` skew ${report.worst.maxSkewDeg.value.toFixed(1)} deg (${report.worst.maxSkewDeg.block}),` +
      ` min Jacobian ${report.worst.minJacobian.value.toExponential(2)} m^2,` +
      ` min edge ${(1000 * report.worst.minEdge.value).toFixed(2)} mm (${report.worst.minEdge.block})`,
  );
  const files = (['f64', 'f32'] as const).map((p) => roundTrip(mesh, p));
  for (const f of files) say(`  binary v1 round trip ok: ${f.path} (${f.bytes} bytes)`);

  writeFileSync(
    join(out, `metrics-${spec.name}.json`),
    `${JSON.stringify({ spec, report, binaryBytes: { f64: files[0]?.bytes, f32: files[1]?.bytes } }, rounded, 2)}\n`,
  );
  const subtitle = `${geometry.name} - ${spec.name} spec, ${mesh.totalCells} cells`;
  for (const v of views(mesh, zooms)) {
    const { name, ...view } = v;
    const svg = renderSvg(mesh, { ...view, subtitle, slots: SLOTS });
    writeFileSync(join(out, `mesh-${spec.name}-${name}.svg`), svg);
    say(`  wrote mesh-${spec.name}-${name}.svg (${(svg.length / 1024).toFixed(0)} kB)`);
  }
}

mkdirSync(out, { recursive: true });
generate(MESH_130K, true);
generate(MESH_80K, false);
