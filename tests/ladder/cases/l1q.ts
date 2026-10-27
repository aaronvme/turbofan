// L1, CPU variant (PHYSICS.md 3.3): the quiescent ambient on the shipped 130k asset (f32 metrics).
// The residual is bitwise zero, so every later iteration is bitwise identical: the value after 2
// iterations is the value after 20k.
import {
  FIELD_EXTENTS,
  fieldExtentDomainProblems,
  minimumSolverDomain,
} from '../../../src/contracts/flow';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { solverMeshFromFile } from '../../../src/flow/reference/solverMesh';
import { engineAsset, spuriousVelocity } from '../engine';

export async function run() {
  const L1 = THRESHOLDS.L1.values;
  const { asset, file } = await engineAsset();
  // W1M-N4: the domain from the boundary patches; the render extents and the minimum domain inside it
  const d = asset.domain;
  const min = minimumSolverDomain(ENGINE_DEFINITION);
  const domainOk =
    d.xIn === -8.54 &&
    d.xOut === 33.75 &&
    d.rOut === 8.82 &&
    Object.values(FIELD_EXTENTS).every((e) => fieldExtentDomainProblems(e, d).length === 0) &&
    d.xIn <= min.xIn &&
    d.xOut >= min.xOut &&
    d.rOut >= min.rOut;
  const s = new ReferenceSolver(solverMeshFromFile(file), {
    gas: THERMALLY_PERFECT,
    freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
  });
  const exactZero = s.residual().every((v) => v === 0);
  s.iterate(2);
  const stateZero = s.U.every((v) => v === 0);
  const v = spuriousVelocity(s);
  return {
    id: 'L1-quiescent',
    rows: [
      {
        id: 'L1',
        metric: 'quiescent, 130k f32 asset: max |u| (residual bitwise 0, so = the 20k value)',
        threshold: `< ${L1.maxSpuriousVelocityMPerS.value} m/s`,
        value: v,
        pass: v < L1.maxSpuriousVelocityMPerS.value && exactZero && stateZero,
      },
      {
        id: 'L1',
        metric: 'asset domain from the boundary patches (W1M-N4)',
        threshold: 'x -8.54..33.75, r 8.82; extents inside',
        value: d.rOut,
        pass: domainOk,
      },
    ],
    extra: { domain: d, exactZero, stateZero },
  };
}
