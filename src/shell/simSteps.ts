// D4-98 item 2 (W2H-I5): the wall step the worker advances the sim by each frame. The app steps
// the real frame time. The browser suite can ask for fixed steps instead (the `debug` message),
// so a case on the part-power fit is the same every run: with the real frame times its sub-idle
// throw was intermittent (the cause is the part-power round's). Fixed steps come in counted
// batches; with none left the sim holds (no step), so an input sent between two batches meets the
// same step every run.

import { MAX_WALL_STEP_S } from '../contracts/sim';

export interface SimStepper {
  /**
   * Adds `frames` fixed frames of `dtS` each to those left (0: hold the sim on the fixed steps).
   * False, and ignored, for a request that cannot be stepped (dt outside (0, MAX_WALL_STEP_S], a
   * count that is not a whole number of frames).
   */
  add(dtS: number, frames: number): boolean;
  /** Back to the real frame time (the app's). */
  realTime(): void;
  /** This frame's wall step: the frame's own dt in real time, else the next fixed step, or 0. */
  next(frameDtS: number): number;
  /** null in real time; else the fixed frames stepped so far and those left. */
  state(): { readonly frames: number; readonly left: number } | null;
}

export function createSimStepper(): SimStepper {
  let fixed: { dtS: number; frames: number; left: number } | null = null;
  return {
    add(dtS, frames) {
      const okDt = dtS > 0 && dtS <= MAX_WALL_STEP_S;
      if (!okDt || !Number.isSafeInteger(frames) || frames < 0) return false;
      fixed = { dtS, frames: fixed?.frames ?? 0, left: (fixed?.left ?? 0) + frames };
      return true;
    },
    realTime() {
      fixed = null;
    },
    next(frameDtS) {
      if (fixed === null) return frameDtS;
      if (fixed.left === 0) return 0;
      fixed.left--;
      fixed.frames++;
      return fixed.dtS;
    },
    state: () => (fixed === null ? null : { frames: fixed.frames, left: fixed.left }),
  };
}
