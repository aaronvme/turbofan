// D4-81's first run: the D4-63 contract case (cases/d463.ts: the same mesh, 1e-3 isothermal wave,
// norms and D4-79 rule) in the plain scheme, with no low-Mach preconditioning and the plain default
// CFL 1.5 (round 9's plain run, there only to 1000). It shows whether the preconditioning is the
// source of the contract's late growth. No ladder test of its own (about 75 min); run it alone with
//   node --import ./tools/mesh/ts-resolve.mjs tests/ladder/runCase.ts d463plain
// which writes reports/ladder/D4-63-plain.json and prints the rows.
import { D463_CONTRACT, runD463 } from './d463';

export function run() {
  return runD463({ ...D463_CONTRACT, id: 'D4-63-plain', lowMachPreconditioning: null });
}
