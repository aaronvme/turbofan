// Per-run bookkeeping for the D0-1 protocol, on the page's frame clock (rAF timestamps in ms):
// warm-up, then `runs` runs of `runMs`; each frame and each (late) timestamp-query sample is
// attributed to the run its frame started in. Rates are counts over the fixed run window.

import { median, medianOfRuns, quantile, summarize, type Summary } from './stats';

export interface ProtocolTimes {
  readonly warmupMs: number;
  readonly runMs: number;
  readonly runs: number;
}

export type Phase = 'warmup' | 'run' | 'done';

export interface GpuSample {
  /** Frame clock time of the frame whose work was timed. */
  readonly frameT: number;
  /** Solver compute-pass GPU time (timestamp queries). */
  readonly solverMs: number;
  readonly iterations: number;
}

export interface RunResult {
  readonly index: number;
  readonly frames: number;
  readonly frameTime: Summary;
  /** Frames longer than 1.5 x the run's median frame time: at least one missed vsync. */
  readonly longFrames: number;
  /**
   * How late each rAF callback started after its frame time (performance.now() - t), or null
   * if the caller gave no callback times. The timestamps are vsync-aligned, so a callback held
   * up by a busy thread can still show a regular frame delta; a delay near a frame period
   * means that frame was produced late.
   */
  readonly callbackDelay: Summary | null;
  readonly fps: number;
  readonly iterations: number;
  readonly itPerSec: number;
  readonly gpuSamples: number;
  /** Total solver GPU time / total timed iterations, or null without samples. */
  readonly solverMsPerIt: number | null;
  /**
   * 10th percentile of the per-frame ms/it. Another process's GPU work that lands inside our
   * timestamp pair inflates single frames; this stays near the uncontended cost.
   */
  readonly solverMsPerItP10: number | null;
  readonly solverMsPerFrame: Summary | null;
}

interface RunAcc {
  deltas: number[];
  frames: number;
  iterations: number;
  gpuMs: number[];
  gpuIts: number;
  msPerIt: number[];
  delays: number[];
}

export class RunRecorder {
  private readonly p: ProtocolTimes;
  private readonly start: number;
  private readonly acc: RunAcc[];
  private lastT: number | null = null;
  private current: Phase = 'warmup';
  private index = -1;

  constructor(protocol: ProtocolTimes, startT: number) {
    this.p = protocol;
    this.start = startT;
    this.acc = Array.from({ length: protocol.runs }, () => ({
      deltas: [],
      frames: 0,
      iterations: 0,
      gpuMs: [],
      gpuIts: 0,
      msPerIt: [],
      delays: [],
    }));
  }

  get phase(): Phase {
    return this.current;
  }

  get runIndex(): number {
    return this.index;
  }

  /** The measured runs' span on the frame clock (warm-up excluded). */
  get window(): { from: number; to: number } {
    const from = this.start + this.p.warmupMs;
    return { from, to: from + this.p.runs * this.p.runMs };
  }

  private runAt(t: number): number {
    const into = t - this.start - this.p.warmupMs;
    if (into < 0) return -1;
    const r = Math.floor(into / this.p.runMs);
    return r < this.p.runs ? r : this.p.runs;
  }

  /**
   * A frame at clock time t that ran `iterations` solver iterations; `callbackAt` is the clock
   * time the callback actually started (performance.now()). Returns the phase.
   */
  frame(t: number, iterations: number, callbackAt?: number): Phase {
    if (this.current === 'done') return 'done';
    const r = this.runAt(t);
    if (r >= this.p.runs) {
      this.current = 'done';
      return 'done';
    }
    if (r >= 0) {
      const a = this.acc[r];
      if (a) {
        if (this.lastT !== null) a.deltas.push(t - this.lastT);
        a.frames++;
        a.iterations += iterations;
        if (callbackAt !== undefined) a.delays.push(callbackAt - t);
      }
      this.current = 'run';
      this.index = r;
    }
    this.lastT = t;
    return this.current;
  }

  gpu(sample: GpuSample): void {
    const r = this.runAt(sample.frameT);
    const a = r >= 0 ? this.acc[r] : undefined;
    if (!a) return;
    a.gpuMs.push(sample.solverMs);
    a.gpuIts += sample.iterations;
    if (sample.iterations > 0) a.msPerIt.push(sample.solverMs / sample.iterations);
  }

  results(): RunResult[] {
    if (this.current !== 'done') throw new Error('protocol not done yet');
    const sec = this.p.runMs / 1000;
    return this.acc.map((a, index) => {
      const total = a.gpuMs.reduce((s, x) => s + x, 0);
      const typical = a.deltas.length > 0 ? median(a.deltas) : 0;
      return {
        index,
        frames: a.frames,
        frameTime: summarize(a.deltas),
        longFrames: a.deltas.filter((d) => d > 1.5 * typical).length,
        callbackDelay: a.delays.length > 0 ? summarize(a.delays) : null,
        fps: a.frames / sec,
        iterations: a.iterations,
        itPerSec: a.iterations / sec,
        gpuSamples: a.gpuMs.length,
        solverMsPerIt: a.gpuIts > 0 ? total / a.gpuIts : null,
        solverMsPerItP10: a.msPerIt.length > 0 ? quantile(a.msPerIt, 0.1) : null,
        solverMsPerFrame: a.gpuMs.length > 0 ? summarize(a.gpuMs) : null,
      };
    });
  }
}

/** Iterations per second inside the plan's budget: 7 ms of solver GPU per 60 Hz frame. */
export function solverBudgetItPerSec(msPerIt: number): number {
  return (60 * 7) / msPerIt;
}

export interface Aggregate {
  readonly runs: number;
  readonly itPerSec: number;
  readonly fps: number;
  readonly frameTimeP50: number;
  readonly frameTimeP95: number;
  readonly frameTimeP99: number;
  readonly longFrames: number;
  readonly callbackDelayP95: number | null;
  readonly callbackDelayP99: number | null;
  readonly solverMsPerIt: number | null;
  readonly solverMsPerItP10: number | null;
  readonly solverMsPerFrameP50: number | null;
  /** 1000 / ms per iteration: the rate if the solver had the whole GPU. */
  readonly saturatedItPerSec: number | null;
  /** solverBudgetItPerSec(ms per iteration). */
  readonly budgetItPerSec: number | null;
}

/** D0-1: the median over runs of each metric (per metric, not "the median run"). */
export function aggregateRuns(runs: readonly RunResult[]): Aggregate {
  const m = (xs: number[]) => (xs.length % 2 === 1 ? medianOfRuns(xs) : median(xs));
  const gpu = runs.flatMap((r) => (r.solverMsPerIt === null ? [] : [r.solverMsPerIt]));
  const perFrame = runs.flatMap((r) => (r.solverMsPerFrame ? [r.solverMsPerFrame.p50] : []));
  const p10 = runs.flatMap((r) => (r.solverMsPerItP10 === null ? [] : [r.solverMsPerItP10]));
  const delays = runs.flatMap((r) => (r.callbackDelay ? [r.callbackDelay] : []));
  const msPerIt = gpu.length > 0 ? m(gpu) : null;
  return {
    runs: runs.length,
    itPerSec: m(runs.map((r) => r.itPerSec)),
    fps: m(runs.map((r) => r.fps)),
    frameTimeP50: m(runs.map((r) => r.frameTime.p50)),
    frameTimeP95: m(runs.map((r) => r.frameTime.p95)),
    frameTimeP99: m(runs.map((r) => r.frameTime.p99)),
    longFrames: m(runs.map((r) => r.longFrames)),
    callbackDelayP95: delays.length > 0 ? m(delays.map((d) => d.p95)) : null,
    callbackDelayP99: delays.length > 0 ? m(delays.map((d) => d.p99)) : null,
    solverMsPerIt: msPerIt,
    solverMsPerItP10: p10.length > 0 ? m(p10) : null,
    solverMsPerFrameP50: perFrame.length > 0 ? m(perFrame) : null,
    saturatedItPerSec: msPerIt === null ? null : 1000 / msPerIt,
    budgetItPerSec: msPerIt === null ? null : solverBudgetItPerSec(msPerIt),
  };
}
