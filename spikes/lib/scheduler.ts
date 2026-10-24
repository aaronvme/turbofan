// Solver iterations per frame, sized from timestamp-query measurements so the solver stays
// inside its GPU budget (plan: <= 7 ms of GPU per frame at 60 fps). Timestamp results arrive a
// few frames late, so the per-iteration cost is an exponential moving average.

export interface SchedulerOptions {
  readonly budgetMs: number;
  readonly min: number;
  readonly max: number;
  readonly initial: number;
  /** Weight of a new sample in the moving average (0..1]. */
  readonly smoothing?: number;
}

export class IterationScheduler {
  private readonly opts: Required<SchedulerOptions>;
  private average: number | null = null;
  private current: number;

  constructor(opts: SchedulerOptions) {
    this.opts = { smoothing: 0.2, ...opts };
    this.current = opts.initial;
  }

  get iterations(): number {
    return this.current;
  }

  get msPerIteration(): number | null {
    return this.average;
  }

  /** A measured frame: `iterations` solver iterations took `gpuMs` of GPU time. */
  observe(iterations: number, gpuMs: number): void {
    if (iterations <= 0 || !(gpuMs > 0) || !Number.isFinite(gpuMs)) return;
    const sample = gpuMs / iterations;
    const a = this.opts.smoothing;
    this.average = this.average === null ? sample : (1 - a) * this.average + a * sample;
    const fit = Math.floor(this.opts.budgetMs / this.average);
    this.current = Math.min(this.opts.max, Math.max(this.opts.min, fit));
  }
}
