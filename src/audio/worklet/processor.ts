// The engine sound's AudioWorkletProcessor (D5-4): the same EngineSynth the Node checks render
// (src/audio/synth.ts), on the audio thread. Frames arrive on the port at about the snapshot rate;
// each is applied before the next 128-frame quantum and glided over its rampFrames. Mono, copied
// to every output channel (the listener's angle is in the levels, not in a pan).

import { SYNTH_PROCESSOR_NAME, type SynthMessage, type SynthProcessorOptions } from '../params';
import { EngineSynth } from '../synth';

// the AudioWorkletGlobalScope's names (TypeScript's DOM library does not declare them)
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  ctor: new (options: {
    readonly processorOptions?: SynthProcessorOptions;
  }) => AudioWorkletProcessor,
): void;

class EngineSynthProcessor extends AudioWorkletProcessor {
  private readonly synth: EngineSynth;

  constructor(options: { readonly processorOptions?: SynthProcessorOptions }) {
    super();
    const o = options.processorOptions;
    if (o === undefined) throw new Error(`${SYNTH_PROCESSOR_NAME}: no processorOptions`);
    this.synth = new EngineSynth({
      sampleRate,
      toneCount: o.toneCount,
      noiseCount: o.noiseCount,
      seed: o.seed,
    });
    this.port.onmessage = (e: MessageEvent<SynthMessage>) => {
      this.synth.push(e.data.frame, e.data.rampFrames);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const first = out?.[0];
    if (out === undefined || first === undefined) return true;
    this.synth.process(first, first.length);
    for (let c = 1; c < out.length; c++) out[c]?.set(first);
    return true;
  }
}

registerProcessor(SYNTH_PROCESSOR_NAME, EngineSynthProcessor);
