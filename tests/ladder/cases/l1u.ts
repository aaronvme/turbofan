// L1, CPU variant: uniform M 0.5 on the 130k mesh with f64 metrics, slip walls remapped to the far
// field (uniform flow has no solution with the engine walls), 50 iterations, growth 25 -> 50.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { solverMeshFromFile } from '../../../src/flow/reference/solverMesh';
import { BC } from '../../../tools/mesh/types';
import { engineFileF64, spuriousVelocity } from '../engine';

export function run() {
  const L1 = THRESHOLDS.L1.values;
  const fs = { pressure: 101325, temperature: 288.15, velocity: 0 };
  const probe = new ReferenceSolver(solverMeshFromFile(engineFileF64()), {
    gas: THERMALLY_PERFECT,
    freeStream: fs,
  });
  const u = L1.uniformFlowMach.value * probe.ref.c;
  const s = new ReferenceSolver(probe.mesh, {
    gas: THERMALLY_PERFECT,
    freeStream: { ...fs, velocity: u },
    bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD },
  });
  s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: fs.pressure, z: 0 });
  s.iterate(25);
  const v25 = spuriousVelocity(s);
  s.iterate(25);
  const v50 = spuriousVelocity(s);
  const growthOk = v50 <= 2 * Math.max(v25, 1e-14);
  return {
    id: 'L1-uniform',
    rows: [
      {
        id: 'L1',
        metric: 'uniform M 0.5, 130k f64 metrics: max |u - u_inf| after 50 its',
        threshold: `< ${L1.maxSpuriousVelocityMPerS.value} m/s, growth 25->50 <= 2x`,
        value: v50,
        pass: v50 < L1.maxSpuriousVelocityMPerS.value && growthOk,
      },
    ],
    extra: { v25, v50, residual: s.stats.residualDensityL2 },
  };
}
