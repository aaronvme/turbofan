// Ladder L1 (PHYSICS.md 3.3), CPU variant: quiescent ambient and uniform M 0.5 flow on the real
// 130k mesh, with the axis and every block interface.
import { describe, expect, it } from 'vitest';
import {
  FIELD_EXTENTS,
  fieldExtentDomainProblems,
  minimumSolverDomain,
} from '../../src/contracts/flow';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { THERMALLY_PERFECT } from '../../src/flow/reference/gas';
import { ReferenceSolver } from '../../src/flow/reference/solver';
import { solverMeshFromFile } from '../../src/flow/reference/solverMesh';
import { BC } from '../../tools/mesh/types';
import { report } from './common';
import { engineAsset, engineFileF64, spuriousVelocity } from './engine';

const L1 = THRESHOLDS.L1.values;
const ISA = { pressure: 101325, temperature: 288.15, velocity: 0 };

describe('L1 (CPU variant): free-stream preservation on the real mesh', () => {
  it('quiescent ambient (shipped f32 asset): the residual is bitwise zero, so it stays exact', async () => {
    const { asset, file } = await engineAsset();
    // W1M-N4: the domain from the boundary patches, and the render extents inside it (W0M-I5)
    expect(asset.domain).toEqual({ xIn: -8.54, xOut: 33.75, rOut: 8.82 });
    for (const e of Object.values(FIELD_EXTENTS))
      expect(fieldExtentDomainProblems(e, asset.domain)).toEqual([]);
    const min = minimumSolverDomain(ENGINE_DEFINITION);
    expect(
      asset.domain.xIn <= min.xIn && asset.domain.xOut >= min.xOut && asset.domain.rOut >= min.rOut,
    ).toBe(true);

    const s = new ReferenceSolver(solverMeshFromFile(file), {
      gas: THERMALLY_PERFECT,
      freeStream: ISA,
    });
    expect(s.residual().every((v) => v === 0)).toBe(true);
    s.iterate(2);
    expect(s.U.every((v) => v === 0)).toBe(true);
    const v = spuriousVelocity(s);
    report('L1-quiescent', [
      {
        id: 'L1',
        metric: 'quiescent: max |u| after 2 its (residual bitwise 0, so = the 20k value)',
        threshold: `< ${L1.maxSpuriousVelocityMPerS.value} m/s`,
        value: v,
        pass: v < L1.maxSpuriousVelocityMPerS.value,
      },
    ]);
    expect(v).toBe(0);
  });

  it('uniform M 0.5 (f64 metrics, walls remapped to far field): below 1e-4 m/s and not growing', () => {
    const fs = { pressure: 101325, temperature: 288.15, velocity: 0 };
    const probe = new ReferenceSolver(solverMeshFromFile(engineFileF64()), {
      gas: THERMALLY_PERFECT,
      freeStream: fs,
    });
    const u = L1.uniformFlowMach.value * probe.ref.c;
    const free = { ...fs, velocity: u };
    const s = new ReferenceSolver(probe.mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: free,
      bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD },
    });
    s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: fs.pressure, z: 0 });
    s.iterate(25);
    const v25 = spuriousVelocity(s);
    s.iterate(25);
    const v50 = spuriousVelocity(s);
    const growthOk = v50 <= 2 * Math.max(v25, 1e-14);
    report(
      'L1-uniform',
      [
        {
          id: 'L1',
          metric: 'uniform M 0.5: max |u - u_inf| after 50 its (f64 metrics)',
          threshold: `< ${L1.maxSpuriousVelocityMPerS.value} m/s, growth 25->50 <= 2x`,
          value: v50,
          pass: v50 < L1.maxSpuriousVelocityMPerS.value && growthOk,
        },
      ],
      { v25, v50, residual: s.stats.residualDensityL2 },
    );
    expect(v50).toBeLessThan(L1.maxSpuriousVelocityMPerS.value);
    expect(growthOk).toBe(true);
  });
});
