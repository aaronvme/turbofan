// D4-89's mirror (the kernel round): D4-40's engine adapter default becomes minMach = M_cut = the
// global M_cut 0.02 that the CPU reference ladder adopted (w2/reference-9 d05e16d:
// tests/ladder/oracle.ts GLOBAL_MACH_CUT, ENGINE_PRECONDITIONING_CUT), as a parameter. The kernel
// already takes minMach^2 and M_cut as uniforms, so the mirror is host-side only. The oracle's
// option there is `globalMachCut` (max(minMach, cut), max(M_cut, cut); an M_cut >= 1 and a
// minMach >= 1 stay): the GPU's scheme options take it with the same meaning, so one options
// object means the same scheme on both sides once that branch is merged.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CFL_PRECONDITIONED,
  ENGINE_MACH_CUT,
  adapterPreconditioning,
  enginePreconditioning,
  stageParams,
} from '../../../../src/flow/gpu/params';
import { THERMALLY_PERFECT } from '../../../../src/flow/reference/gas';
import { DEFAULT_CFL } from '../../../../src/flow/reference/solver';

const AT_REST = {
  gas: THERMALLY_PERFECT,
  freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
};
const SIZES = { nCells: 10, nGhosts: 4, nWorkgroups: 2 };

describe('D4-89: the engine adapter default is the global M_cut', () => {
  it('is minMach = M_cut = 0.02 (D4-40 was 0.003)', () => {
    expect(ENGINE_MACH_CUT).toBe(0.02);
    expect(enginePreconditioning()).toEqual({ minMach: 0.02, machCut: 0.02 });
    // a parameter: another cut (D4-81's 0.05 trial) is one argument
    expect(enginePreconditioning(0.05)).toEqual({ minMach: 0.05, machCut: 0.05 });
    for (const bad of [0, -0.02, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => enginePreconditioning(bad), String(bad)).toThrow(/M_cut/);
  });

  it("the adapter's options: absent is the engine default at its cut, null is the plain scheme", () => {
    expect(adapterPreconditioning(undefined)).toEqual({ minMach: 0.02, machCut: 0.02 });
    expect(adapterPreconditioning(undefined, 0.05)).toEqual({ minMach: 0.05, machCut: 0.05 });
    expect(adapterPreconditioning(null)).toBeNull();
    const given = { minMach: 0.003, machCut: 0.01 };
    expect(adapterPreconditioning(given)).toBe(given);
    // a cut with explicit preconditioning (or the plain scheme) would be ignored: refused
    expect(() => adapterPreconditioning(given, 0.05)).toThrow(/machCut/);
    expect(() => adapterPreconditioning(null, 0.05)).toThrow(/machCut/);
  });

  it("the uniforms at the engine default: minMach^2 = M_cut^2, the far field's beta^2 floor", () => {
    const p = stageParams({ ...AT_REST, lowMachPreconditioning: enginePreconditioning() }, SIZES);
    const t = p.tracking[0];
    if (t === undefined) throw new Error('no params');
    expect(t.minMach2).toBe(0.02 * 0.02);
    expect(t.machCut).toBe(0.02);
    expect(t.precondition).toBe(1);
    expect(t.cfl).toBe(DEFAULT_CFL_PRECONDITIONED);
    // at rest the preconditioned far field sits at beta = M_cut (SOLVER.md 5, D4-22)
    expect(p.bcTracking.farFieldBeta2).toBe(0.02 * 0.02);
    expect(p.physical[0]?.precondition).toBe(0);
    expect(p.physical[0]?.machCut).toBe(1);
  });

  it("globalMachCut (D4-81, the oracle's option): raises minMach and M_cut to the cut", () => {
    const viaCut = stageParams(
      { ...AT_REST, lowMachPreconditioning: { minMach: 0.003, globalMachCut: 0.02 } },
      SIZES,
    );
    const direct = stageParams({ ...AT_REST, lowMachPreconditioning: { minMach: 0.02 } }, SIZES);
    expect(viaCut.tracking).toEqual(direct.tracking);
    expect(viaCut.bcTracking).toEqual(direct.bcTracking);
    // above the cut, as given
    const above = stageParams(
      { ...AT_REST, lowMachPreconditioning: { minMach: 0.05, machCut: 0.1, globalMachCut: 0.02 } },
      SIZES,
    );
    expect(above.tracking[0]?.minMach2).toBe(0.05 * 0.05);
    expect(above.tracking[0]?.machCut).toBe(0.1);
    // the dissipation scaling off (M_cut >= 1) stays off; beta still takes the cut
    const scalingOff = stageParams(
      { ...AT_REST, lowMachPreconditioning: { minMach: 0.003, machCut: 1, globalMachCut: 0.02 } },
      SIZES,
    );
    expect(scalingOff.tracking[0]?.machCut).toBe(1);
    expect(scalingOff.tracking[0]?.minMach2).toBe(0.02 * 0.02);
    // the plain scheme (minMach >= 1) stays plain, with the plain default CFL
    const plain = stageParams(
      { ...AT_REST, lowMachPreconditioning: { minMach: 1, globalMachCut: 0.02 } },
      SIZES,
    );
    expect(plain.tracking[0]?.minMach2).toBe(1);
    expect(plain.tracking[0]?.cfl).toBe(DEFAULT_CFL);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(
        () =>
          stageParams(
            { ...AT_REST, lowMachPreconditioning: { minMach: 0.003, globalMachCut: bad } },
            SIZES,
          ),
        String(bad),
      ).toThrow(/globalMachCut/);
  });
});
