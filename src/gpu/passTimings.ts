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

import { MAX_PASS_MS } from './timestamps';

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

const zero = (): Record<PassGroup, number> =>
  Object.fromEntries(PASS_GROUPS.map((g) => [g, 0])) as Record<PassGroup, number>;

/** One frame's passes summed per group; invalid durations (see MAX_PASS_MS) are dropped. */
export function sumByGroup(entries: Iterable<{ label: string; ms: number }>): PassMs {
  const out = zero();
  for (const e of entries) {
    if (!(e.ms >= 0 && e.ms <= MAX_PASS_MS)) continue;
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
}

/** The last `window` frames' pass timings. */
export class RollingPassStats {
  private readonly frames: { gpu: PassMs; total: number; cpu: number }[] = [];
  constructor(private readonly window: number) {
    if (!(Number.isInteger(window) && window > 0)) throw new Error('RollingPassStats: window > 0');
  }

  push(gpu: PassMs, cpuMs: number): void {
    let total = 0;
    for (const g of PASS_GROUPS) total += gpu[g];
    this.frames.push({ gpu, total, cpu: cpuMs });
    if (this.frames.length > this.window) this.frames.shift();
  }

  medians(): PassMedians {
    const gpu = zero();
    for (const g of PASS_GROUPS) gpu[g] = median(this.frames.map((f) => f.gpu[g]));
    return {
      frames: this.frames.length,
      gpu,
      gpuTotal: median(this.frames.map((f) => f.total)),
      cpu: median(this.frames.map((f) => f.cpu)),
    };
  }
}
