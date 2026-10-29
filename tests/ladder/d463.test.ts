// D4-63 (SOLVER.md 10): the rest state on the engine mesh, the engine default from a 0.1 % wave.
import { describe, expect, it } from 'vitest';
import { runCase, type CaseResult } from './spawn';

describe('D4-63: the rest state on the 130k engine mesh', () => {
  let result: Promise<CaseResult> | undefined;
  const once = (): Promise<CaseResult> => (result ??= runCase('d463'));
  const row = async (k: number) => {
    const r = (await once()).rows[k];
    if (r === undefined) throw new Error(`no row ${k}`);
    process.stdout.write(
      `[ladder] ${r.id} | ${r.metric} | ${r.threshold} | ${r.value.toPrecision(4)} | ${String(r.pass)}\n`,
    );
    return r;
  };

  // The companion (D4-65's form): a NaN, a timeout or a blow-up fails here, not hidden by the pin.
  it("signature: finite for 2000 iterations, max |p'| below 100x its first", async () => {
    expect((await row(0)).pass).toBe(true);
  });

  // KNOWN-FAIL (D4-63, round 9): the pulse does not decay. The upstream block focuses it on the axis
  // (5.4x at 200, 20x at 270, then it falls) and the plume-core block's axis cells keep it: max |p'|
  // is 4-12x its first after iteration 500 and the residual rises from 12 at 100 to 1.3e2 at 1100.
  // It is not the inflow BC or the beta jump beside it (SOLVER.md 10 has the checks). Round 10
  // (D4-68): without the beta^2 dp term (K = 0) the case goes to NaN near iteration 190, and the
  // face-limited dp fails the rule the same way (8.05x, residual 11.2x). The linear part alone
  // (1e-6) is a decaying transient of the pseudo-energy that still fails this window (D4-69).
  // Under D4-72 (the L2 of p') round 9's run has 1.72x over 1000-2000, inside the bound, so the
  // pin now fails on the residual: 1.49e2 against 12.4 at iteration 100.
  it.fails(
    "rule (D4-72): L2(p') <= 2x its first and the residual below its value at 100, over 1000-2000",
    async () => {
      const a = await row(1);
      const b = await row(2);
      await row(3); // max |p'|, reported beside the rule (D4-72)
      expect(a.pass && b.pass).toBe(true);
    },
  );
});
