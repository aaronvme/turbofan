// Per-pass GPU timings of the render (W1G-I2). three's timestamp queries time every render
// context (one GPU render pass each); src/render/passTimer.ts records each context's name,
// and this pure module maps the names onto our passes and keeps rolling medians, so the
// performance work can see where the GPU time goes instead of one serialized CPU+GPU number.
//
// Names come from three r186 (pinned): a PassNode renders its scene under the pass's name
// ("Opaque", "Rotors"), the post nodes render quads named "AO", "TRAA", "DoF [ ... ]",
// "Bloom [ ... ]" (the depth of field also blurs its circle of confusion with "Gaussian Blur
// [ ... ]"), an RTT node "<name> [ RTT ]", the shadow map "Shadow Map [ <light> ]"
// (plus "VSM..." blurs), and the RenderPipeline's final quad "Render Pipeline".

import { MAX_PASS_MS } from './timestamps.ts';

export const PASS_GROUPS = [
  'shadow',
  'opaque',
  'rotors',
  'gtao',
  'composite',
  'traa',
  'dof',
  'bloom',
  'output',
  'other',
] as const;
export type PassGroup = (typeof PASS_GROUPS)[number];
export type PassMs = Readonly<Record<PassGroup, number>>;

const RULES: readonly (readonly [RegExp, PassGroup])[] = [
  [/^Shadow Map|^VSM/, 'shadow'],
  [/^Opaque$/, 'opaque'],
  [/^Rotors$/, 'rotors'],
  [/^AO$/, 'gtao'],
  [/^Composite \[ RTT \]$/, 'composite'],
  [/^TRAA$/, 'traa'],
  [/^DoF \[|^Gaussian Blur \[/, 'dof'],
  [/^Bloom \[/, 'bloom'],
  [/^Render Pipeline$/, 'output'],
];

export function passGroupOf(label: string): PassGroup {
  for (const [re, g] of RULES) if (re.test(label)) return g;
  return 'other';
}

/**
 * The flow visuals' passes (w2/flowviz: the scenes and quads it names "Flow ..."). They are not
 * a render group: P4 is the render GPU time excluding the solver and the flow visuals (D4-2), so
 * they are summed apart (`sumFlowMs`), into D4-2's flow-visual time and its 2 ms budget.
 */
export function isFlowPass(label: string): boolean {
  return /^Flow /.test(label);
}

const validMs = (ms: number): boolean => ms >= 0 && ms <= MAX_PASS_MS;

/**
 * One frame's flow-visual passes, ms (invalid durations dropped, as in sumByGroup); NaN when the
 * frame has no valid flow duration (W2V-N13: no flow time, which is not a 0 ms flow time).
 */
export function sumFlowMs(entries: Iterable<{ label: string; ms: number }>): number {
  let t = 0;
  let any = false;
  for (const e of entries)
    if (isFlowPass(e.label) && validMs(e.ms)) {
      t += e.ms;
      any = true;
    }
  return any ? t : Number.NaN;
}

const zero = (): Record<PassGroup, number> =>
  Object.fromEntries(PASS_GROUPS.map((g) => [g, 0])) as Record<PassGroup, number>;

/** One frame's passes summed per group; invalid durations (see MAX_PASS_MS) are dropped. */
export function sumByGroup(entries: Iterable<{ label: string; ms: number }>): PassMs {
  const out = zero();
  for (const e of entries) {
    if (!validMs(e.ms) || isFlowPass(e.label)) continue;
    const g = passGroupOf(e.label);
    out[g] += e.ms;
  }
  return out;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] ?? Number.NaN) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

export interface PassMedians {
  readonly frames: number;
  /** Median GPU ms per pass group. */
  readonly gpu: PassMs;
  /** Median of the per-frame GPU totals (not the sum of the medians). */
  readonly gpuTotal: number;
  /** Median CPU ms per frame (JS time to encode and submit it). */
  readonly cpu: number;
  /**
   * Median GPU ms of the flow-visual render passes (not in `gpu` or `gpuTotal`), over the frames
   * that drew them; 0 when none did (W2V-N13).
   */
  readonly flow: number;
}

/** One frame's GPU ms per pass group and CPU ms. */
export interface FrameSample {
  readonly gpu: PassMs;
  readonly cpu: number;
  /** The frame's flow-visual render passes, ms (w2/flowviz; absent: none drawn). */
  readonly flow?: number;
}

export interface Spread {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

/** Every frame of one timing run (W1L-I4: not a rolling window). */
export interface RunSummary {
  readonly frames: number;
  readonly gpu: Readonly<Record<PassGroup, Spread>>;
  /** Of the per-frame GPU totals. */
  readonly gpuTotal: Spread;
  readonly cpu: Spread;
}

/** Quantile by linear interpolation between order statistics (R type 7); NaN when empty. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((x, y) => x - y);
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  const a = s[lo] ?? Number.NaN;
  const b = s[Math.min(lo + 1, s.length - 1)] ?? a;
  return a + (h - lo) * (b - a);
}

const spread = (xs: readonly number[]): Spread => ({
  p10: quantile(xs, 0.1),
  p50: quantile(xs, 0.5),
  p90: quantile(xs, 0.9),
});

export function summarizeRun(frames: readonly FrameSample[]): RunSummary {
  const gpu = {} as Record<PassGroup, Spread>;
  for (const g of PASS_GROUPS) gpu[g] = spread(frames.map((f) => f.gpu[g]));
  const totals = frames.map((f) => PASS_GROUPS.reduce((t, g) => t + f.gpu[g], 0));
  return {
    frames: frames.length,
    gpu,
    gpuTotal: spread(totals),
    cpu: spread(frames.map((f) => f.cpu)),
  };
}

/** The last `window` frames' pass timings (the overlay), plus every frame of a timing run. */
export class RollingPassStats {
  private readonly frames: { gpu: PassMs; total: number; cpu: number; flow: number | null }[] = [];
  private run: FrameSample[] | null = null;
  private readonly window: number;
  // no parameter property: Node's type stripping (tools/lookdev/capture.ts imports this) rejects it
  constructor(window: number) {
    if (!(Number.isInteger(window) && window > 0)) throw new Error('RollingPassStats: window > 0');
    this.window = window;
  }

  /** One frame: its render passes, its CPU ms and (if any were drawn) its flow passes, ms. */
  push(gpu: PassMs, cpuMs: number, flowMs?: number): void {
    let total = 0;
    for (const g of PASS_GROUPS) total += gpu[g];
    // W2V-N13: a frame without a flow time (none drawn, or every flow query dropped) is skipped
    // by the flow median, not counted as 0
    const flow = flowMs !== undefined && Number.isFinite(flowMs) ? flowMs : null;
    this.frames.push({ gpu, total, cpu: cpuMs, flow });
    if (this.frames.length > this.window) this.frames.shift();
    this.run?.push(flow === null ? { gpu, cpu: cpuMs } : { gpu, cpu: cpuMs, flow });
  }

  /** Starts recording every frame pushed from now on (a timing run). */
  beginRun(): void {
    this.run = [];
  }

  /** The frames recorded since beginRun (empty if none), and stops recording. */
  endRun(): FrameSample[] {
    const r = this.run ?? [];
    this.run = null;
    return r;
  }

  /** The flow passes' median over the frames that drew them; 0 when none did. */
  private flowMedian(): number {
    const xs: number[] = [];
    for (const f of this.frames) if (f.flow !== null) xs.push(f.flow);
    return xs.length === 0 ? 0 : median(xs);
  }

  medians(): PassMedians {
    const gpu = zero();
    for (const g of PASS_GROUPS) gpu[g] = median(this.frames.map((f) => f.gpu[g]));
    return {
      frames: this.frames.length,
      gpu,
      gpuTotal: median(this.frames.map((f) => f.total)),
      cpu: median(this.frames.map((f) => f.cpu)),
      flow: this.flowMedian(),
    };
  }
}
