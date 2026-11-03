// The main-thread side of the engine sound (D5-4): the AudioContext, made only when the viewer
// turns the sound on (the click is the user gesture autoplay needs), the AudioWorklet module
// (src/audio/worklet/processor.ts, loaded by Vite as a worker-style URL), a GainNode for the
// volume and an AnalyserNode the browser suite reads. Each new snapshot's sound inputs become a
// SoundFrame (src/audio/sources.ts) posted to the worklet's port, gliding over the interval since
// the last posting; the worklet smooths. The sim/UI boundary stays message-based: the inputs come
// from the store, which only ever holds the worker's snapshots.

import type { EngineDefinition } from '../../contracts/engine';
import {
  NOISE_VOICES,
  SYNTH_PROCESSOR_NAME,
  rampFramesFor,
  volumeGain,
  type SynthMessage,
  type SynthProcessorOptions,
} from '../params';
import { createSoundModel, engineSoundFrame, type SoundInputs } from '../sources';

export interface SoundController {
  /** Starts (or resumes) the sound at a volume; call it from the viewer's gesture. */
  enable(volume: number): Promise<void>;
  /** Fades the sound out and suspends the context. */
  disable(): void;
  setVolume(v: number): void;
  /** The output's analyser (null before the first enable). */
  readonly analyser: AnalyserNode | null;
  readonly context: AudioContext | null;
}

/** Subscribes to the sound inputs of each new snapshot; returns the unsubscribe. */
export type InputsSubscription = (onInputs: (i: SoundInputs) => void) => () => void;

export interface EngineSoundOptions {
  readonly definition: EngineDefinition;
  /** The worklet failed after it started (its processor threw). */
  readonly onError: (message: string) => void;
}

/** The volume's and the mute's glide, s (a time constant: no click). */
const GAIN_TAU_S = 0.03;
/** After a mute's fade the context is suspended (the audio thread idles). */
const SUSPEND_AFTER_MS = 200;

export function createEngineSound(
  subscribe: InputsSubscription,
  opts: EngineSoundOptions,
): SoundController {
  const model = createSoundModel(opts.definition);
  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let gain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let unsubscribe: (() => void) | null = null;
  let lastPost = Number.NEGATIVE_INFINITY;
  let wanted = false;
  // read through a call: an await in enable() may see disable() turn it off
  const isWanted = () => wanted;
  let starting: Promise<void> | null = null;

  const post = (i: SoundInputs) => {
    if (node === null || ctx === null) return;
    const now = performance.now();
    const message: SynthMessage = {
      type: 'frame',
      frame: engineSoundFrame(model, i),
      rampFrames: rampFramesFor(now - lastPost, ctx.sampleRate),
    };
    lastPost = now;
    node.port.postMessage(message);
  };

  const build = async (c: AudioContext): Promise<void> => {
    const { default: url } = await import('./processor.ts?worker&url');
    await c.audioWorklet.addModule(url);
    const processorOptions: SynthProcessorOptions = {
      toneCount: model.tones.length,
      noiseCount: NOISE_VOICES.length,
      seed: 1,
    };
    const n = new AudioWorkletNode(c, SYNTH_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions,
    });
    n.onprocessorerror = () => {
      opts.onError('the engine-sound worklet stopped (its processor threw)');
    };
    const g = new GainNode(c, { gain: 0 });
    const a = new AnalyserNode(c, { fftSize: 2048 });
    n.connect(g);
    g.connect(a);
    a.connect(c.destination);
    node = n;
    gain = g;
    analyser = a;
  };

  return {
    get analyser() {
      return analyser;
    },
    get context() {
      return ctx;
    },
    async enable(volume: number) {
      wanted = true;
      // made inside the gesture's call, before any await
      ctx ??= new AudioContext({ latencyHint: 'interactive' });
      const c = ctx;
      const resumed = c.resume();
      if (node === null) {
        starting ??= build(c);
        await starting;
      }
      await resumed;
      if (!isWanted()) return;
      gain?.gain.setTargetAtTime(volumeGain(volume), c.currentTime, GAIN_TAU_S);
      unsubscribe ??= subscribe(post);
    },
    disable() {
      wanted = false;
      unsubscribe?.();
      unsubscribe = null;
      lastPost = Number.NEGATIVE_INFINITY;
      const c = ctx;
      if (c === null) return;
      gain?.gain.setTargetAtTime(0, c.currentTime, GAIN_TAU_S / 2);
      setTimeout(() => {
        if (!wanted && c.state === 'running') void c.suspend();
      }, SUSPEND_AFTER_MS);
    },
    setVolume(v: number) {
      if (ctx === null || gain === null || !wanted) return;
      gain.gain.setTargetAtTime(volumeGain(v), ctx.currentTime, GAIN_TAU_S);
    },
  };
}
