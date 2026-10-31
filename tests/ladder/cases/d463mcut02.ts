// D4-81's second run: the D4-63 contract case (cases/d463.ts: the same mesh, 1e-3 isothermal wave,
// norms and D4-79 rule) at the engine's preconditioning with the global M_cut 0.02
// (lowMachPreconditioning.globalMachCut: beta and the flux's M_cut held at or above 0.02). A trial,
// not the contract: no ladder test of its own (about 75 min); run it alone with
//   node --import ./tools/mesh/ts-resolve.mjs tests/ladder/runCase.ts d463mcut02
// which writes reports/ladder/D4-63-mcut-0.02.json and prints the rows.
import { D463_CONTRACT, runD463 } from './d463';

export function run() {
  return runD463({
    ...D463_CONTRACT,
    id: 'D4-63-mcut-0.02',
    lowMachPreconditioning: { minMach: 0.003, globalMachCut: 0.02 },
  });
}
