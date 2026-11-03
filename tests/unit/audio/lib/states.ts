// Cycle states for the engine-sound checks, from the reference cycle model (the app's), so the
// sound is checked on the states it will play. Deterministic: fixed steps, ISA SLS.
import { ISA_SLS } from '../../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  type CycleInputs,
  type CycleState,
} from '../../../../src/contracts/cycle';
import { createCycleModel } from '../../../../src/cycle/model';
import { ENGINE_DEFINITION } from '../../../../src/engine/definition';

export const DEF = ENGINE_DEFINITION;
export const AMBIENT = ISA_SLS;

export const runInputs = (throttleLever: number): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  throttleLever,
  fuelLever: 'run',
  ignition: 'auto',
});

/** The stabilised ground-idle state the model resets to. */
export function groundIdle(): CycleState {
  return createCycleModel().reset('groundIdle', ISA_SLS);
}

/** Near-steady states at each lever, each held `holdS` from the last (one model, 20 Hz steps). */
export function leverStates(levers: readonly number[], holdS = 8): CycleState[] {
  const m = createCycleModel();
  m.reset('groundIdle', ISA_SLS);
  const out: CycleState[] = [];
  for (const lever of levers) {
    let s = m.state();
    for (let i = 0; i < Math.round(holdS / 0.05); i++) s = m.step(0.05, runInputs(lever));
    out.push(s);
  }
  return out;
}

/** A state with its spool speeds replaced (frequencies only; the gas path is idle's). */
export function withSpeeds(s: CycleState, n1Percent: number, n2Percent: number): CycleState {
  const n1Rpm = (n1Percent / 100) * DEF.designPoint.n1Rpm;
  const n2Rpm = (n2Percent / 100) * DEF.designPoint.n2Rpm;
  return { ...s, n1Rpm, n2Rpm, n1Percent, n2Percent };
}
