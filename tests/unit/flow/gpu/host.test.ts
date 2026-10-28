import { describe, expect, it } from 'vitest';
import { FLOW_DEFAULT_ERRORS } from '../../../../src/contracts/sim';
import { FLOW_SOLVER_LIMITS, selectPreferredLimits } from '../../../../src/gpu/device';
import {
  DEFAULT_TILE,
  blockageData,
  buildLayout,
  checkTile,
  stageStorageBuffers,
} from '../../../../src/flow/gpu/layout';
import {
  DEFAULT_CFL_PRECONDITIONED,
  PARAMS_BYTES,
  PARAM_FIELDS,
  packParams,
  paramsStructWgsl,
  stageParams,
} from '../../../../src/flow/gpu/params';
import { snapshotSources, solverFlowStatus } from '../../../../src/flow/gpu/status';
import { f32Lit, gasWgsl } from '../../../../src/flow/gpu/wgsl/gas';
import { DEFAULT_LIMITER, fluxWgsl } from '../../../../src/flow/gpu/wgsl/flux';
import {
  CELL_SOURCE_VEC4,
  SCALAR,
  cellSourceKernelWgsl,
  dtKernelWgsl,
  ghostKernelWgsl,
  lambdaKernelWgsl,
  primKernelWgsl,
  probeKernelWgsl,
  reductionLength,
  residualFromPartials,
  resampleKernelWgsl,
  stageKernelWgsl,
  stageWorkgroupBytes,
  tileFaceSlots,
  timeFromReduction,
} from '../../../../src/flow/gpu/wgsl/kernels';
import { THERMALLY_PERFECT, caloricallyPerfectGas } from '../../../../src/flow/reference/gas';
import {
  DEFAULT_CFL,
  DEFAULT_CFL_PHYSICAL,
  RK3_ALPHA,
} from '../../../../src/flow/reference/solver';
import { GAS_TABLES } from '../../../../src/thermo/gas';
import { BC, rectangle, singleBlock, solverMesh, threeBlockRow } from '../helpers';

const row = solverMesh(
  threeBlockRow(1, 1, 20, 12, {
    left: BC.INFLOW,
    right: BC.OUTFLOW,
    bottom: BC.AXIS,
    top: BC.SLIP_WALL,
  }),
  'f32',
);

describe('GPU layout (the static buffers the kernels index)', () => {
  it('tiles every block and packs blocks, tiles and ghosts', () => {
    const L = buildLayout(row);
    expect(L.tile).toEqual(DEFAULT_TILE);
    // 20 x 12 per block in 16 x 8 tiles: 2 x 2 tiles, three blocks
    expect(L.workgroups).toBe(12);
    expect(L.tiles[0]).toEqual({ block: 0, ti: 0, tj: 0 });
    expect(L.topo.size).toBe(2 * 3 + 12 + 2 * row.nGhosts);
    const b1 = row.blocks[1];
    expect(Array.from(L.topoData.subarray(8, 12))).toEqual([
      b1?.cellOffset,
      20,
      12,
      b1?.ghostOffset,
    ]);
    expect(L.geo.extB).toBe(2 * row.nCells + L.nIFaces + L.nJFaces);
    expect(L.geoData[0]).toBe(Math.fround(row.cellR[0] ?? NaN));
    const f = 4 * L.geo.face;
    expect(Math.hypot(L.geoData[f] ?? NaN, L.geoData[f + 1] ?? NaN)).toBeCloseTo(1, 6);
  });

  it('marks slip-wall ghosts with their wall cell and the next cell inwards', () => {
    const L = buildLayout(row);
    let walls = 0;
    for (let g = 0; g < row.nGhosts; g++) {
      const o = 4 * (L.topo.ghosts + 2 * g);
      if (L.topoData[o + 2] === BC.SLIP_WALL) {
        walls++;
        expect(L.wall[row.nCells + g]).toBe(1);
        expect(L.topoData[o]).not.toBe(L.topoData[o + 1]);
      } else {
        expect(L.topoData[o]).toBe(L.topoData[o + 1]);
      }
    }
    expect(walls).toBe(3 * 2 * 20);
    const remapped = buildLayout(row, { bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD } });
    expect(remapped.wall.every((w) => w === 0)).toBe(true);
  });

  it('computes the b-weighted face sums and the signed ghost blockage', () => {
    const L = buildLayout(row);
    const { cellB, extB } = blockageData(row, L, new Float64Array(row.nCells).fill(1));
    // b = 1: the outward face vectors sum to (0, A) to the f32 metric rounding (~6e-8 |S| a face)
    for (let c = 0; c < row.nCells; c++) {
      expect(cellB[4 * c]).toBe(1);
      expect(Math.abs(cellB[4 * c + 1] ?? NaN)).toBeLessThan(3e-6 * (row.cellArea[c] ?? 0) + 1e-9);
      expect(cellB[4 * c + 2]).toBeCloseTo(row.cellArea[c] ?? NaN, 6);
    }
    const g = L.wall.findIndex((w) => w === 1);
    expect(extB[g]).toBe(-1);
    expect(extB[0]).toBe(1);
    expect(() => blockageData(row, L, new Float64Array(3))).toThrow(/values/);
    expect(() => blockageData(row, L, new Float64Array(row.nCells))).toThrow(/\(0, 1\]/);
  });

  it('stores the b-weighted S_x sum of the flow faces (slip walls excluded) in CELL_GEO.w', () => {
    // a wall at imin: its face vector is -|S| x, so the flow faces of the i = 0 cells sum to +|S|
    const duct = solverMesh(
      singleBlock(rectangle('duct', 0, 1, 1, 2, 4, 3), {
        imin: BC.SLIP_WALL,
        imax: BC.FARFIELD,
        jmin: BC.FARFIELD,
        jmax: BC.FARFIELD,
      }),
    );
    const L = buildLayout(duct);
    const b = Float64Array.from({ length: duct.nCells }, (_, c) => 0.6 + 0.1 * (c % 4));
    const { cellGeo, cellB } = blockageData(duct, L, b);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 4; i++) {
        const c = j * 4 + i;
        expect(cellGeo[4 * c]).toBe(Math.fround(duct.cellR[c] ?? NaN));
        expect(cellGeo[4 * c + 1]).toBe(Math.fround(duct.cellArea[c] ?? NaN));
        expect(cellGeo[4 * c + 2]).toBe(Math.fround(duct.cellVolR[c] ?? NaN));
        const wallFace = j * 5;
        const wallSx = i === 0 ? -(b[c] ?? NaN) * (duct.iArea[wallFace] ?? NaN) : 0;
        expect(cellGeo[4 * c + 3]).toBeCloseTo((cellB[4 * c + 1] ?? NaN) - wallSx, 6);
      }
    }
    // remapped to a far field, the wall face is a flow face: the two sums agree
    const open = buildLayout(duct, { bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD } });
    const o = blockageData(duct, open, b);
    for (let c = 0; c < duct.nCells; c++) expect(o.cellGeo[4 * c + 3]).toBe(o.cellB[4 * c + 1]);
  });

  it('refuses tiles it cannot run', () => {
    expect(() => {
      checkTile({ x: 1, y: 8 });
    }).toThrow(/tile/);
    expect(() => {
      checkTile({ x: 32, y: 16 });
    }).toThrow(/256/);
    expect(() => buildLayout(row, { tile: { x: 2.5, y: 4 } })).toThrow(/tile/);
  });

  it('tiles a small single block', () => {
    const box = solverMesh(
      singleBlock(rectangle('b', 0, 1, 0, 1, 3, 3), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.AXIS,
        jmax: BC.FARFIELD,
      }),
    );
    expect(buildLayout(box, { tile: { x: 2, y: 2 } }).workgroups).toBe(4);
  });
});

describe('uniform parameters', () => {
  const opts = {
    gas: caloricallyPerfectGas(1.4, 287.05287),
    freeStream: { pressure: 1e5, temperature: 300, velocity: 50 },
  };
  const sizes = { nCells: 10, nGhosts: 4, nWorkgroups: 2 };

  it('generates the WGSL struct and the packer from one field list', () => {
    const wgsl = paramsStructWgsl();
    for (const [name, type] of PARAM_FIELDS) expect(wgsl).toContain(`${name}: ${type},`);
    expect(PARAMS_BYTES % 16).toBe(0);
    expect(() => stageParams({ ...opts, cfl: 0 }, sizes)).toThrow(/cfl 0 must be > 0/);
    expect(() => stageParams({ ...opts, cflPhysical: -1 }, sizes)).toThrow(/cflPhysical/);
    const set = stageParams(opts, sizes);
    const second = set.tracking[1];
    const first = set.tracking[0];
    if (second === undefined || first === undefined) throw new Error('no params');
    const buf = packParams(second);
    expect(buf.byteLength).toBe(PARAMS_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const at = (n: string) => PARAM_FIELDS.findIndex(([k]) => k === n);
    expect(f[at('alpha')]).toBe(Math.fround(RK3_ALPHA[1]));
    expect(u[at('stage')]).toBe(1);
    expect(f[at('rhoInf')]).toBe(Math.fround(1e5 / (287.05287 * 300)));
    expect(() => packParams({ ...first, stage: 1.5 })).toThrow(/u32/);
    expect(() => packParams({ ...first, cfl: Number.NaN })).toThrow(/cfl/);
  });

  it('holds the SOLVER.md 10 defaults and the SSP-RK3 weights', () => {
    const set = stageParams(opts, sizes);
    expect(set.tracking.map((p) => p.cfl)).toEqual([DEFAULT_CFL, DEFAULT_CFL, DEFAULT_CFL]);
    expect(set.physical.map((p) => [p.w0, p.w1])).toEqual([
      [0, 1],
      [0.75, 0.25],
      [1 / 3, 2 / 3],
    ]);
    expect(set.physical[0]?.cflPhysical).toBe(DEFAULT_CFL_PHYSICAL);
    expect(set.tracking[0]?.machCut).toBe(1);
    expect(set.tracking[0]?.dp0).toBeCloseTo(set.bcPhysical.p0 - 1e5, 6);
    const pre = stageParams({ ...opts, lowMachPreconditioning: { minMach: 0.003 } }, sizes);
    expect(pre.tracking[0]?.cfl).toBe(DEFAULT_CFL_PRECONDITIONED);
    expect(pre.tracking[0]?.machCut).toBe(0.003);
    expect(pre.tracking[0]?.precondition).toBe(1);
    expect(pre.physical[0]?.precondition).toBe(0);
    expect(pre.physical[0]?.machCut).toBe(1);
    expect(pre.tracking[0]?.farBeta2).toBeLessThan(1);
    expect(pre.physical[0]?.farBeta2).toBe(1);
    const off = stageParams({ ...opts, lowMachPreconditioning: { minMach: 1, machCut: 2 } }, sizes);
    expect(off.tracking[0]?.cfl).toBe(DEFAULT_CFL);
    expect(off.tracking[0]?.machCut).toBe(1);
    const fast = stageParams({ ...opts, freeStream: { ...opts.freeStream, velocity: 500 } }, sizes);
    expect(fast.tracking[0]?.supersonicInflow).toBe(1);
  });
});

describe('WGSL generation', () => {
  const L = buildLayout(row);
  const ko = { gas: THERMALLY_PERFECT, layout: L };

  it('takes the gas coefficients from src/thermo, printed as exact f32 literals', () => {
    const w = gasWgsl(THERMALLY_PERFECT);
    const c = GAS_TABLES.gases.air.low.cp;
    expect(w).toContain(`const AIR_LO_CP: vec4f = vec4f(${c.slice(0, 4).map(f32Lit).join(', ')});`);
    expect(w).toContain(`const T_BREAK: f32 = ${f32Lit(GAS_TABLES.tBreakK)};`);
    expect(f32Lit(1000)).toBe('1000.0f');
    expect(f32Lit(-0)).toBe('-0.0f');
    expect(f32Lit(0.1)).toBe(`${Math.fround(0.1)}f`);
    expect(() => f32Lit(1e40)).toThrow(/f32/);
    expect(gasWgsl(caloricallyPerfectGas(1.4, 287.05287))).toContain('calorically perfect');
  });

  it('bakes the layout into every kernel and switches the optional bindings', () => {
    for (const code of [
      primKernelWgsl(ko),
      ghostKernelWgsl(ko),
      lambdaKernelWgsl(ko),
      dtKernelWgsl(ko),
      cellSourceKernelWgsl(ko),
      resampleKernelWgsl(ko),
      probeKernelWgsl(ko),
    ]) {
      expect(code).toContain(`const EXT_B: u32 = ${L.geo.extB}u;`);
      expect(code).toContain('struct Params');
    }
    const plain = stageKernelWgsl(ko);
    expect(plain).toContain('const TX: u32 = 16u;');
    expect(plain).not.toContain('binding(8)');
    expect(plain).not.toContain('binding(9)');
    const full = stageKernelWgsl({ ...ko, sources: true, faceDump: true });
    expect(full).toContain('binding(8) var<storage, read> src');
    expect(full).toContain('binding(9) var<storage, read_write> dump');
    expect(cellSourceKernelWgsl(ko)).toContain(`${CELL_SOURCE_VEC4}u * c`);
    expect(() => fluxWgsl('smooth' as never)).toThrow(/not implemented/);
    // W2S-B-B1: the oracle's limiter vocabulary ('sharp' | 'smooth', w2/reference round 4), so
    // an oracle option forwarded to the kernel names the same limiter
    expect(DEFAULT_LIMITER).toBe('sharp');
    expect(fluxWgsl('sharp')).toBe(fluxWgsl());
    expect(() => fluxWgsl('vanAlbadaSharp' as never)).toThrow(/not implemented/);
  });

  it('sizes the tile memory under the 16 KiB default and the face-dump stride', () => {
    expect(stageWorkgroupBytes(DEFAULT_TILE)).toBeLessThanOrEqual(16384);
    expect(stageWorkgroupBytes({ x: 8, y: 8 })).toBeLessThan(stageWorkgroupBytes(DEFAULT_TILE));
    expect(tileFaceSlots(DEFAULT_TILE)).toBe(17 * 8 + 16 * 9);
  });

  it('reads the residual and the clock from the reduction buffer', () => {
    const red = new Float32Array(reductionLength(L));
    expect(red.length).toBe(2 * L.workgroups + SCALAR.count);
    for (let w = 0; w < L.workgroups; w++) red[w] = 2;
    expect(residualFromPartials(red, L)).toBeCloseTo(Math.sqrt((2 * L.workgroups) / L.nCells), 12);
    red[2 * L.workgroups + SCALAR.timeHi] = 1.5;
    red[2 * L.workgroups + SCALAR.timeLo] = 0.25;
    expect(timeFromReduction(red, L)).toBe(1.25);
  });
});

describe('solver status (W1F-I1) and provenance (W1F-N1)', () => {
  const stats = {
    iterationsThisStep: 3,
    totalIterations: 300,
    gpuTimeMs: 4.2,
    residualDensityL2: 1e-3,
    physicalTimeS: 0,
  };
  const health = {
    initialised: true,
    initError: null,
    lost: null,
    mode: 'tracking' as const,
    stats,
  };

  it('reports initialising, running, unavailable and lost', () => {
    expect(solverFlowStatus({ ...health, initialised: false, stats: null }).status).toBe(
      'initialising',
    );
    expect(solverFlowStatus(health)).toMatchObject({ status: 'running', error: null, stats });
    expect(solverFlowStatus({ ...health, initError: 'no adapter' })).toMatchObject({
      status: 'unavailable',
      error: 'no adapter',
    });
    expect(solverFlowStatus({ ...health, lost: { message: 'device hung' } })).toMatchObject({
      status: 'lost',
      error: 'device hung',
    });
  });

  it('gives an empty loss message the default and keeps a NaN GPU time from failing the solver', () => {
    expect(solverFlowStatus({ ...health, lost: { message: '  ' } }).error).toBe(
      FLOW_DEFAULT_ERRORS.lost,
    );
    const glitch = solverFlowStatus({ ...health, stats: { ...stats, gpuTimeMs: Number.NaN } });
    expect(glitch.status).toBe('running');
    expect(glitch.stats?.gpuTimeMs).toBeNull();
    const diverged = solverFlowStatus({
      ...health,
      stats: { ...stats, residualDensityL2: Infinity },
    });
    expect(diverged.status).toBe('diverged');
    expect(diverged.error).toMatch(/residual is Infinity after 300/);
  });

  it('copies the provenance from the cycle model and the field shown', () => {
    expect(snapshotSources({ source: 'model' }, { source: 'solver' })).toEqual({
      cycle: 'model',
      flow: 'solver',
    });
    expect(snapshotSources({ source: 'mock' }, { source: 'mock' })).toEqual({
      cycle: 'mock',
      flow: 'mock',
    });
    expect(snapshotSources({ source: 'model' }, null).flow).toBe('none');
  });
});

describe('D4-50: the stage kernel storage buffers against the device limit', () => {
  it('binds 8, 9 with sources, 10 with the face dump; packs geo and topo when the device is short', () => {
    expect(stageStorageBuffers({ sources: false, faceDump: false }, 8)).toEqual({
      buffers: 8,
      packed: false,
    });
    expect(stageStorageBuffers({ sources: true, faceDump: false }, 16)).toEqual({
      buffers: 9,
      packed: false,
    });
    // an adapter with WebGPU's default 8: the two read-only static buffers share one binding
    expect(stageStorageBuffers({ sources: true, faceDump: false }, 8)).toEqual({
      buffers: 8,
      packed: true,
    });
    expect(stageStorageBuffers({ sources: true, faceDump: false }, 16, true)).toEqual({
      buffers: 8,
      packed: true,
    });
    expect(() => stageStorageBuffers({ sources: true, faceDump: true }, 8)).toThrow(
      /needs 10 storage buffers \(9 packed\).*allows 8.*maxStorageBuffersPerShaderStage/,
    );
    expect(FLOW_SOLVER_LIMITS.maxStorageBuffersPerShaderStage).toBe(
      stageStorageBuffers({ sources: true, faceDump: false }, 99).buffers,
    );
  });

  it('requests a preferred limit at the adapter value when the adapter offers less', () => {
    const adapter = { maxStorageBuffersPerShaderStage: 8, maxBufferSize: 2 ** 31 };
    expect(
      selectPreferredLimits(adapter as unknown as GPUSupportedLimits, FLOW_SOLVER_LIMITS),
    ).toEqual({ maxStorageBuffersPerShaderStage: 8 });
    const arc = { maxStorageBuffersPerShaderStage: 16 };
    expect(selectPreferredLimits(arc as unknown as GPUSupportedLimits, FLOW_SOLVER_LIMITS)).toEqual(
      { maxStorageBuffersPerShaderStage: 9 },
    );
    expect(() =>
      selectPreferredLimits({} as unknown as GPUSupportedLimits, FLOW_SOLVER_LIMITS),
    ).toThrow(/does not report limit/);
  });
});
