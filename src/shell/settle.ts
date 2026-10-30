// D4-88's settled-view signal: how many frames the engine view has been settled in the mode the
// viewer asked for (its transition done: the wedge open or closed, the parts assembled or apart,
// the spools at speed or stopped; EngineView.viewSettled()). The worker counts them and sends the
// count with each snapshot's diagnostics, so the browser suite shoots a mode once it shows that
// mode (W2A-I4: the 1.5 s wall-time sleep shot the exploded engine under the Schlieren label) and
// the callouts show only on a settled view (W2A-N10). Pure.

import type { ViewMode } from '../contracts/ui';

/**
 * A view is settled once it has been for this many frames: TRAA's history (and the tracers'
 * streaks) converge over about half a second at 60 fps after the geometry stops moving.
 */
export const SETTLED_FRAMES = 30;

export interface SettleTracker {
  /** One frame in `mode` (the asked one); the frames settled in it so far, 0 on any change. */
  frame(mode: ViewMode, viewSettled: boolean): number;
}

export function createSettleTracker(): SettleTracker {
  let mode: ViewMode | null = null;
  let frames = 0;
  return {
    frame(m, settled) {
      // the first frame is the boot's mode, not a switch; a switch starts the count again even
      // if its first frame reads settled (the view has not drawn the new mode yet)
      const switched = mode !== null && m !== mode;
      mode = m;
      frames = switched || !settled ? 0 : frames + 1;
      return frames;
    },
  };
}
