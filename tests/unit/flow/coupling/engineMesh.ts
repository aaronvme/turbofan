// The 130k production mesh as the solver sees it (f64 metrics, built in memory from the engine
// definition, the asset's cells and zones), shared by the coupling tests.
import { solverMeshFromFile, type SolverMesh } from '../../../../src/flow/reference/solverMesh';
import { engineFileF64 } from '../../../ladder/engine';

let cached: SolverMesh | undefined;

export function engineSolverMesh(): SolverMesh {
  cached ??= solverMeshFromFile(engineFileF64());
  return cached;
}
