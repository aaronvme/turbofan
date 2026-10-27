// The reference solver assembled (docs/SOLVER.md sections 2, 8-11): ghost layout, exact quiescence,
// free-stream preservation on a curvilinear axisymmetric mesh (the GCL), conservation and
// orientation independence across block interfaces, well-balanced blockage, and both time steppers.
import { describe, expect, it } from 'vitest';
import { buildGhostMap, ghostIndex } from '../../../tools/mesh/ghost';
import { meshFileFromMesh } from '../../../tools/mesh/format';
import type { MultiBlockMesh } from '../../../tools/mesh/types';
import { THERMALLY_PERFECT, caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { RK3_ALPHA, ReferenceSolver } from '../../../src/flow/reference/solver';
import { solverMeshFromFile, extIndex } from '../../../src/flow/reference/solverMesh';
import { massSourceRates, type SourceModel } from '../../../src/flow/reference/sources';
import { NP } from '../../../src/flow/reference/state';
import { BC, gridBlock, rectangle, singleBlock, solverMesh, threeBlockRow } from './helpers';

const AMBIENT = { pressure: 101325, temperature: 288.15, velocity: 0 } as const;

const allBcs = threeBlockRow(0.2, 0.15, 6, 5, {
  left: BC.INFLOW,
  right: BC.OUTFLOW,
  bottom: BC.AXIS,
  top: BC.FARFIELD,
});
const closed = threeBlockRow(0.2, 0.15, 6, 5, {
  left: BC.SLIP_WALL,
  right: BC.SLIP_WALL,
  bottom: BC.AXIS,
  top: BC.SLIP_WALL,
});

/** A smooth disturbance: pressure bump, swirl, a hot fuel-air spot. */
function pulse(x: number, r: number) {
  const g = Math.exp(-((x - 0.25) ** 2 + (r - 0.07) ** 2) / 0.003);
  return {
    rho: 1.225 * (1 + 0.05 * g),
    u: 15 * g,
    v: -8 * g,
    w: 40 * g * (r / 0.15),
    p: 101325 * (1 + 0.1 * g),
    z: 0.02 * g,
  };
}

describe('solver mesh', () => {
  it('numbers ghosts like tools/mesh/ghost.ts and gives outward boundary normals', () => {
    const file = meshFileFromMesh(allBcs, 'f64');
    const mesh = solverMeshFromFile(file);
    const map = buildGhostMap(allBcs, 2);
    expect(mesh.nGhosts).toBe(map.src.length);
    for (let b = 0; b < 3; b++) {
      const blk = allBcs.blocks[b];
      if (blk === undefined) throw new Error('block');
      for (let c = 0; c < blk.nj; c++) {
        for (const layer of [1, 2]) {
          expect(extIndex(mesh, b, -layer, c)).toBe(
            mesh.nCells + ghostIndex(map, allBcs, b, 'imin', layer, c),
          );
          expect(extIndex(mesh, b, blk.ni - 1 + layer, c)).toBe(
            mesh.nCells + ghostIndex(map, allBcs, b, 'imax', layer, c),
          );
        }
      }
      for (let c = 0; c < blk.ni; c++) {
        expect(extIndex(mesh, b, c, -1)).toBe(
          mesh.nCells + ghostIndex(map, allBcs, b, 'jmin', 1, c),
        );
        expect(extIndex(mesh, b, c, blk.nj + 1)).toBe(
          mesh.nCells + ghostIndex(map, allBcs, b, 'jmax', 2, c),
        );
      }
    }
    // block A (i along +x): imin ghosts face -x, its top (jmax) faces +r; block B is rotated
    const gA = extIndex(mesh, 0, -1, 2) - mesh.nCells;
    expect(mesh.ghostNx[gA]).toBeCloseTo(-1, 12);
    expect(mesh.ghostNr[gA]).toBeCloseTo(0, 12);
    const gTop = extIndex(mesh, 0, 3, 5) - mesh.nCells;
    expect(mesh.ghostNr[gTop]).toBeCloseTo(1, 12);
    const gBtop = extIndex(mesh, 1, 3, -1) - mesh.nCells; // B's jmin is the top (r = H)
    expect(mesh.ghostNr[gBtop]).toBeCloseTo(1, 12);
  });

  it('rejects a mesh with fewer than two cells across a block', () => {
    const thin = singleBlock(rectangle('thin', 0, 1, 0, 1, 1, 4), {
      imin: BC.SLIP_WALL,
      imax: BC.SLIP_WALL,
      jmin: BC.AXIS,
      jmax: BC.SLIP_WALL,
    });
    expect(() => solverMesh(thin)).toThrow();
  });
});

describe('reference solver: exactness', () => {
  it('keeps the quiescent ambient exactly (bitwise) with every BC, both modes', () => {
    const s = new ReferenceSolver(solverMesh(allBcs), {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
    });
    const R = s.residual();
    expect(R.every((v) => v === 0)).toBe(true);
    s.iterate(3);
    s.stepPhysical();
    expect(s.U.every((v) => v === 0)).toBe(true);
    expect(s.stats.residualDensityL2).toBe(0);
  });

  it('preserves a uniform M 0.5 stream on the curvilinear axisymmetric mesh (GCL)', () => {
    const fs = { pressure: 101325, temperature: 288.15, velocity: 0.5 * 340.29 };
    const s = new ReferenceSolver(solverMesh(allBcs), { gas: THERMALLY_PERFECT, freeStream: fs });
    s.setUniform({ rho: s.ref.rho, u: fs.velocity, v: 0, w: 0, p: fs.pressure, z: 0 });
    s.iterate(20);
    const P = s.primitives();
    let du = 0;
    let dp = 0;
    for (let c = 0; c < s.mesh.nCells; c++) {
      du = Math.max(du, Math.abs((P[NP * c + 1] ?? 0) - fs.velocity), Math.abs(P[NP * c + 2] ?? 0));
      dp = Math.max(dp, Math.abs(P[NP * c + 4] ?? 0));
    }
    expect(du).toBeLessThan(1e-9);
    expect(dp).toBeLessThan(1e-6);
  });

  it('balances a uniform pressure exactly against a varying blockage (p grad b term)', () => {
    const s = new ReferenceSolver(solverMesh(closed), {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
    });
    const b = new Float64Array(s.mesh.nCells);
    for (let c = 0; c < b.length; c++) {
      const x = s.mesh.cellX[c] ?? 0;
      const r = s.mesh.cellR[c] ?? 0;
      b[c] = 1 - 0.3 * Math.exp(-((x - 0.3) ** 2) / 0.004) * (1 + r);
    }
    s.setBlockage(b);
    s.setUniform({ rho: 1.3, u: 0, v: 0, w: 0, p: 1.3e5, z: 0 });
    s.iterate(10);
    const P = s.primitives();
    for (let c = 0; c < s.mesh.nCells; c++) {
      expect(Math.abs(P[NP * c + 1] ?? NaN)).toBeLessThan(1e-9);
      expect(Math.abs(P[NP * c + 2] ?? NaN)).toBeLessThan(1e-9);
    }
  });
});

describe('reference solver: block interfaces', () => {
  it('conserves mass, energy, angular momentum and fuel across min/max, max/max and min/min interfaces', () => {
    const s = new ReferenceSolver(solverMesh(closed), {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
    });
    s.setState((x, r) => pulse(x, r));
    const before = s.totals();
    for (let k = 0; k < 30; k++) s.stepPhysical();
    const after = s.totals();
    const scale = s.absTotals();
    for (const m of [0, 3, 4, 5]) {
      expect(Math.abs((after[m] ?? NaN) - (before[m] ?? NaN))).toBeLessThan(
        1e-13 * (scale[m] ?? NaN),
      );
    }
    // and the pulse really moved
    expect(Math.abs(s.primitives()[NP * 40 + 1] ?? 0)).toBeGreaterThan(0.01);
  });

  it('gives the same field on three rotated blocks as on one block over the same nodes', () => {
    const one = rectangle('one', 0, 0.6, 0, 0.15, 18, 5);
    const single: MultiBlockMesh = singleBlock(one, {
      imin: BC.INFLOW,
      imax: BC.OUTFLOW,
      jmin: BC.AXIS,
      jmax: BC.FARFIELD,
    });
    const three = threeBlockRow(
      0.2,
      0.15,
      6,
      5,
      { left: BC.INFLOW, right: BC.OUTFLOW, bottom: BC.AXIS, top: BC.FARFIELD },
      0,
    );
    const a = new ReferenceSolver(solverMesh(single), {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
    });
    const b = new ReferenceSolver(solverMesh(three), {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
    });
    a.setState((x, r) => pulse(x, r));
    b.setState((x, r) => pulse(x, r));
    a.iterate(8);
    b.iterate(8);
    const Pa = a.primitives();
    const Pb = b.primitives();
    // map block-row cells to the single block by centroid
    const key = (x: number, r: number) => `${Math.round(x * 1e6)},${Math.round(r * 1e6)}`;
    const at = new Map<string, number>();
    for (let c = 0; c < a.mesh.nCells; c++)
      at.set(key(a.mesh.cellX[c] ?? 0, a.mesh.cellR[c] ?? 0), c);
    let worst = 0;
    for (let c = 0; c < b.mesh.nCells; c++) {
      const ca = at.get(key(b.mesh.cellX[c] ?? 0, b.mesh.cellR[c] ?? 0));
      expect(ca).toBeDefined();
      for (const k of [0, 1, 2, 3, 4]) {
        worst = Math.max(
          worst,
          Math.abs((Pa[NP * (ca ?? 0) + k] ?? NaN) - (Pb[NP * c + k] ?? NaN)) /
            (k === 4 ? 1e4 : k === 0 ? 0.06 : 40),
        );
      }
    }
    expect(worst).toBeLessThan(1e-10);
  });
});

describe('reference solver: time stepping', () => {
  // a uniform state with a linear relaxation source s = -k U: no fluxes, so every cell follows
  // the scheme's amplification factor exactly
  const box = singleBlock(
    gridBlock('box', 3, 3, (i, j) => ({ x: 0.1 * i + 0.02 * j, r: 1 + 0.1 * j })),
    {
      imin: BC.SLIP_WALL,
      imax: BC.SLIP_WALL,
      jmin: BC.SLIP_WALL,
      jmax: BC.SLIP_WALL,
    },
  );
  const K = 2000;
  const decay =
    (implicit: boolean): SourceModel =>
    (ctx, out) => {
      for (let c = 0; c < ctx.mesh.nCells; c++) {
        for (let m = 0; m < 6; m++) {
          out.rate[6 * c + m] = -K * (ctx.U[6 * c + m] ?? 0);
          out.damping[6 * c + m] = implicit ? K : 0;
        }
      }
    };
  const start = { rho: 1.3, u: 0, v: 0, w: 0, p: 1.15e5, z: 0 };

  it.each([false, true])(
    'SSP-RK3 has the Shu-Osher amplification (point-implicit: %s)',
    (implicit) => {
      const gas = caloricallyPerfectGas(1.4, 287.05287);
      const s = new ReferenceSolver(solverMesh(box), {
        gas,
        freeStream: AMBIENT,
        sources: decay(implicit),
      });
      s.setUniform(start);
      const u0 = s.U[0] ?? NaN;
      const dt = 1e-4;
      s.stepPhysical(dt);
      const a = K * dt;
      const G = implicit
        ? 1 / 3 + ((2 / 3) * (3 / 4 + 1 / 4 / (1 + a) ** 2)) / (1 + a)
        : 1 - a + a ** 2 / 2 - a ** 3 / 6;
      for (let c = 0; c < s.mesh.nCells; c++) expect((s.U[6 * c] ?? NaN) / u0).toBeCloseTo(G, 12);
      expect(s.time).toBe(dt);
    },
  );

  it.each([false, true])(
    'the tracking RK3 has the low-storage amplification with local dt (point-implicit: %s)',
    (implicit) => {
      const gas = caloricallyPerfectGas(1.4, 287.05287);
      // local steps differ per cell, so a decaying density would make the field non-uniform and
      // drive fluxes; decay only a tiny swirl instead: rho r w has no flux while the mass flux is 0
      const swirlDecay: SourceModel = (ctx, out) => {
        for (let c = 0; c < ctx.mesh.nCells; c++) {
          out.rate[6 * c + 3] = -K * (ctx.U[6 * c + 3] ?? 0);
          out.damping[6 * c + 3] = implicit ? K : 0;
        }
      };
      const s = new ReferenceSolver(solverMesh(box), {
        gas,
        freeStream: AMBIENT,
        sources: swirlDecay,
      });
      s.setUniform({ ...start, w: 0.01 });
      const u0 = Float64Array.from(s.U);
      s.iterate(1);
      const dts = s.localDt();
      expect(new Set(Array.from(dts)).size).toBeGreaterThan(1); // the cells differ in size
      for (let c = 0; c < s.mesh.nCells; c++) {
        const a = K * (dts[c] ?? NaN);
        let g = 1;
        for (const alpha of RK3_ALPHA) g = 1 - (alpha * a * g) / (implicit ? 1 + alpha * a : 1);
        expect((s.U[6 * c + 3] ?? NaN) / (u0[6 * c + 3] ?? NaN)).toBeCloseTo(g, 10);
      }
    },
  );

  it('uses alpha = (0.2, 0.5, 1) and reports the density residual', () => {
    expect([...RK3_ALPHA]).toEqual([0.2, 0.5, 1]);
    const s = new ReferenceSolver(solverMesh(closed), {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
    });
    s.setState((x, r) => pulse(x, r));
    const st = s.iterate(2);
    expect(st.residualDensityL2).toBeGreaterThan(0);
    expect(s.iterations).toBe(2);
  });

  it('remaps BC codes when asked (slip wall -> far field)', () => {
    const fs = { pressure: 101325, temperature: 288.15, velocity: 100 };
    const s = new ReferenceSolver(solverMesh(closed), {
      gas: THERMALLY_PERFECT,
      freeStream: fs,
      bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD },
    });
    s.setUniform({ rho: s.ref.rho, u: 100, v: 0, w: 0, p: fs.pressure, z: 0 });
    s.iterate(3);
    const P = s.primitives();
    for (let c = 0; c < s.mesh.nCells; c++)
      expect(Math.abs((P[NP * c + 1] ?? 0) - 100)).toBeLessThan(1e-9);
  });
});

describe('volume sources', () => {
  it('a mass source carries the local stagnation enthalpy gauge', () => {
    const s = new ReferenceSolver(solverMesh(closed), {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
    });
    s.setUniform({ rho: 1.1, u: 30, v: 5, w: 12, p: 1.05e5, z: 0.01 });
    const P = s.primitives();
    const out = new Float64Array(6);
    massSourceRates(s.ref, P, 0, s.mesh.cellR[0] ?? 1, -2, out, 0);
    expect(out[0]).toBe(-2);
    expect(out[1]).toBeCloseTo(-2 * 30, 12);
    expect(out[3]).toBeCloseTo(-2 * (P[3] ?? NaN), 12);
    expect(out[5]).toBeCloseTo(-2 * 0.01, 12);
    expect(out[4]).toBeLessThan(0);
  });
});
