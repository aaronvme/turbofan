// D4-63's linear part (D4-69, D4-79): the d463 case (cases/d463.ts: the same mesh, scheme, norms and
// rule) from a 1e-6 wave with an isentropic start (rho' = p' / c^2), round 10's run. At this
// amplitude the beta^2 dp term does not lift beta, so it is the linear iteration about rest. D4-79
// applies the rule to it as well. It has no ladder test of its own (the ladder runs the contract
// case once, about an hour on the 130k mesh); run it alone with
//   node --import ./tools/mesh/ts-resolve.mjs tests/ladder/runCase.ts d463lin
// which writes reports/ladder/D4-63-linear.json and prints the rows.
import { runD463 } from './d463';

export function run() {
  return runD463({ id: 'D4-63-linear', amplitude: 1e-6, start: 'isentropic' });
}
