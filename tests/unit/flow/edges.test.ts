// Edge paths of the reference solver that the scheme tests do not reach: the face-flux diagnostic
// in both directions, f32 storage, the supersonic inflow, the preconditioner at beta = 1, and the
// solver mesh's input checks.
import { describe, expect, it } from 'vitest';
import { meshFileFromMesh } from '../../../tools/mesh/format';
import { BC as MESH_BC } from '../../../tools/mesh/types';
import { boundaryParams, ghostPrimitive } from '../../../src/flow/reference/boundary';
import { THERMALLY_PERFECT, referenceState } from '../../../src/flow/reference/gas';
import { preconditionIncrement } from '../../../src/flow/reference/precondition';
import { physicalFlux } from '../../../src/flow/reference/slau2';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { extIndex, solverMeshFromFile } from '../../../src/flow/reference/solverMesh';
import { NP, physicalToPrim } from '../../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from './helpers';

const box = singleBlock(rectangle('box', 0, 0.4, 0.2, 0.5, 6, 5), {
  imin: BC.FARFIELD,
  imax: BC.FARFIELD,
  jmin: BC.FARFIELD,
  jmax: BC.FARFIELD,
});
const fs = { pressure: 101325, temperature: 288.15, velocity: 60 } as const;

describe('reference solver: diagnostics and storage', () => {
  it('faceFlux gives the physical flux of a uniform stream through i- and j-faces', () => {
    const mesh = solverMesh(box);
    const s = new ReferenceSolver(mesh, { gas: THERMALLY_PERFECT, freeStream: fs });
    const state = { rho: s.ref.rho, u: 60, v: 0, w: 0, p: 101325, z: 0 };
    s.setUniform(state);
    const blk = mesh.blocks[0];
    if (blk === undefined) throw new Error('no block');
    for (const [dir, i, j, face] of [
      ['i', 2, 3, blk.iFaceOffset + 3 * (blk.ni + 1) + 2],
      ['j', 4, 1, blk.jFaceOffset + 1 * blk.ni + 4],
    ] as const) {
      const F = s.faceFlux(0, dir, i, j);
      const nx = (dir === 'i' ? mesh.iNx[face] : mesh.jNx[face]) as number;
      const nr = (dir === 'i' ? mesh.iNr[face] : mesh.jNr[face]) as number;
      const area = (dir === 'i' ? mesh.iArea[face] : mesh.jArea[face]) as number;
      const rf = (dir === 'i' ? mesh.iRf[face] : mesh.jRf[face]) as number;
      const exact = new Float64Array(6);
      physicalFlux(s.ref, physicalToPrim(s.ref, state, rf), 0, nx, nr, area, rf, exact);
      for (let k = 0; k < 6; k++) expect(F[k]).toBeCloseTo(exact[k] as number, 6);
    }
    expect(() => s.faceFlux(3, 'i', 0, 0)).toThrow(/no block/);
  });

  it("storage 'f32' keeps every state value f32-representable", () => {
    const s = new ReferenceSolver(solverMesh(box), {
      gas: THERMALLY_PERFECT,
      freeStream: fs,
      storage: 'f32',
    });
    s.setState((x, r) => ({
      rho: 1.2 + 0.01 * x,
      u: 60 + 5 * r,
      v: 2,
      w: 3,
      p: 101325 + 50 * x,
      z: 0,
    }));
    expect(s.U.every((x) => Math.fround(x) === x)).toBe(true);
    s.iterate(2);
    s.stepPhysical();
    expect(s.U.every((x) => Math.fround(x) === x)).toBe(true);
  });
});

describe('reference solver: boundary and preconditioner edges', () => {
  it('a supersonic free stream is imposed whole at an inflow', () => {
    const ref = referenceState(THERMALLY_PERFECT, {
      pressure: 1e5,
      temperature: 250,
      velocity: 600,
    });
    const q = physicalToPrim(ref, { rho: 1.6, u: 500, v: 10, w: 0, p: 1.2e5, z: 0 }, 1);
    const g = new Float64Array(NP);
    ghostPrimitive(ref, boundaryParams(ref), MESH_BC.INFLOW, q, 0, -1, 0, g, 0);
    expect(Array.from(g.subarray(0, 7))).toEqual([0, 600, 0, 0, 0, 0, 0]);
    expect(g[7]).toBe(ref.c);
  });

  it('the increment is unchanged at beta^2 = 1', () => {
    const ref = referenceState(THERMALLY_PERFECT, fs);
    const P = physicalToPrim(ref, { rho: 1.1, u: 30, v: 1, w: 2, p: 1e5, z: 0 }, 0.3);
    const dU = Float64Array.from([1, 2, 3, 4, 5, 6]);
    preconditionIncrement(ref, P, 0, 0.3, 1, dU, 0);
    expect(Array.from(dU)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('the solver mesh rejects a wrong ghost-layer count, a thin block and a corner index', () => {
    const file = meshFileFromMesh(box, 'f64');
    expect(() => solverMeshFromFile({ ...file, ghostLayers: 3 })).toThrow(/ghost layers/);
    // the asset writer refuses thin blocks too, so the file is edited by hand
    const thin = { ...file, blocks: file.blocks.map((b) => ({ ...b, ni: 1 })) };
    expect(() => solverMeshFromFile(thin)).toThrow(/thinner/);
    const mesh = solverMeshFromFile(file);
    expect(() => extIndex(mesh, 0, -1, -1)).toThrow(/corner/);
    expect(() => extIndex(mesh, 0, -3, 0)).toThrow(/halo/);
  });
});
