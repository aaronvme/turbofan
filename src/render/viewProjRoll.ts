// The camera's view-projections that post.ts's motion vectors read (the lean G-buffer's camera
// velocity of every scene pixel, and the rotors' reprojection): this frame's, its inverse, and
// the previous frame's, all unjittered. Each frame rolls them: previous = the last frame's, then
// this frame's. D4-91: a warm frame (EngineView.warmFrame, drawn before the tick's real frame,
// which overwrites the canvas) rolls them for its own draw and must leave them as they were, so
// the real frame after it reprojects from the last real frame.

import type { Matrix4 } from 'three/webgpu';

export interface ViewProjRoll {
  /** The uniforms' matrices (post.ts binds them to its shader nodes). */
  readonly prev: Matrix4;
  readonly curr: Matrix4;
  readonly currInv: Matrix4;
  /** Rolls to this frame's view-projection (camera.projectionMatrix x matrixWorldInverse). */
  roll(viewProj: Matrix4): void;
  /** Saves the state; the returned function puts it back (after a warm frame). */
  save(): () => void;
}

export function createViewProjRoll(prev: Matrix4, curr: Matrix4, currInv: Matrix4): ViewProjRoll {
  let havePrev = false;
  return {
    prev,
    curr,
    currInv,
    roll(viewProj) {
      if (havePrev) prev.copy(curr);
      curr.copy(viewProj);
      currInv.copy(curr).invert();
      if (!havePrev) prev.copy(curr);
      havePrev = true;
    },
    save() {
      const p = prev.clone();
      const had = havePrev;
      return () => {
        prev.copy(p);
        havePrev = had;
      };
    },
  };
}
