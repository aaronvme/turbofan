// The offline render: a parameter stream played by the worklet's own synth in 128-frame quanta,
// each frame applied at the first quantum boundary at or after its post, as the worklet applies
// a port message between two process() calls. The Node checks (PHYSICS.md 3.6) listen to this.

import type { SoundFrame } from './params';
import { EngineSynth, QUANTUM_FRAMES, type SynthOptions } from './synth';

export { QUANTUM_FRAMES };

export interface TimedFrame {
  /** The frame (sample index) it is posted at. */
  readonly atFrame: number;
  readonly frame: SoundFrame;
  /** Frames to glide over (the interval to the next posting). */
  readonly rampFrames: number;
}

export function renderStream(
  stream: readonly TimedFrame[],
  totalFrames: number,
  opts: SynthOptions,
): { readonly samples: Float32Array; readonly synth: EngineSynth } {
  const synth = new EngineSynth(opts);
  const samples = new Float32Array(totalFrames);
  const ordered = [...stream].sort((a, b) => a.atFrame - b.atFrame);
  const q = new Float32Array(QUANTUM_FRAMES);
  let next = 0;
  for (let o = 0; o < totalFrames; o += QUANTUM_FRAMES) {
    for (let f = ordered[next]; f !== undefined && f.atFrame <= o; f = ordered[++next])
      synth.push(f.frame, f.rampFrames);
    const n = Math.min(QUANTUM_FRAMES, totalFrames - o);
    synth.process(q, n);
    samples.set(q.subarray(0, n), o);
  }
  return { samples, synth };
}
