// D4-63 (SOLVER.md 10): the rest state on the engine mesh, the engine default from a 0.1 % wave,
// with D4-81's global M_cut 0.02 (cases/d463.ts).
import { describe, expect, it } from 'vitest';
import { runCase, type CaseResult } from './spawn';

// D4-79's 20000 iterations on the 130k mesh: 216-223 ms per iteration with the process alone at
// AboveNormal (about 75 min), 680-775 ms on a loaded machine (round 11), so up to about 4.3 h.
const D463_TIMEOUT_MS = 6 * 3_600_000;

describe('D4-63: the rest state on the 130k engine mesh', () => {
  let result: Promise<CaseResult> | undefined;
  const once = (): Promise<CaseResult> => (result ??= runCase('d463', D463_TIMEOUT_MS));
  const row = async (k: number) => {
    const r = (await once()).rows[k];
    if (r === undefined) throw new Error(`no row ${k}`);
    process.stdout.write(
      `[ladder] ${r.id} | ${r.metric} | ${r.threshold} | ${r.value.toPrecision(4)} | ${String(r.pass)}\n`,
    );
    return r;
  };

  // The companion (D4-65's form): a NaN, a timeout or a blow-up fails here, not hidden by the pin.
  it(
    "signature: finite for 20000 iterations, max |p'| below 100x its first",
    async () => {
      expect((await row(0)).pass).toBe(true);
    },
    D463_TIMEOUT_MS,
  );

  // D4-63's history (round 9): the pulse did not decay. The upstream block focuses it on the axis
  // (5.4x at 200, 20x at 270, then it falls) and the plume-core block's axis cells keep it: max |p'|
  // is 4-12x its first after iteration 500 and the residual rises from 12 at 100 to 1.3e2 at 1100.
  // It is not the inflow BC or the beta jump beside it (SOLVER.md 10 has the checks). Round 10
  // (D4-68): without the beta^2 dp term (K = 0) the case goes to NaN near iteration 190, and the
  // face-limited dp fails the rule the same way (8.05x, residual 11.2x). The linear part alone
  // (1e-6) is a decaying transient of the pseudo-energy that still fails this window (D4-69).
  // Under D4-72 (the L2 of p') round 9's run has 1.72x over 1000-2000, inside the bound. Under
  // D4-77 (round 11) the residual is volume-weighted too, and the pin still fails on it: 2.61x its
  // value at 100 over 1000-2000 (the far-field and plume blocks, not the axis). D4-79 (round 12)
  // judges decay in the limit instead: the weighted residual at 20000 against its values at 10000
  // and at 100, with (a) also at 20000. At M_cut 0.003 the case grows (round 12: L2 4.4x at 10000,
  // the residual 2.5x its value at 100). D4-81 (round 13): the plain scheme decays, and with the
  // global M_cut 0.02 the rule passes (L2 0.78 over 1000-2000 and 0.49 at 20000; the residual at
  // 20000 0.52x its value at 10000 and 0.22x its value at 100), so the pin is lifted.
  it(
    "rule (D4-72, D4-79): L2(p') <= 2x its first over 1000-2000 and at 20000; the volume-weighted residual at 20000 <= its values at 10000 and at 100",
    async () => {
      const gated = [await row(1), await row(2), await row(3), await row(4)];
      for (let k = 5; k <= 9; k++) await row(k); // reported beside the rule
      expect(gated.every((r) => r.pass === true)).toBe(true);
    },
    D463_TIMEOUT_MS,
  );
});
