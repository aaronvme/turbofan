// Per-frame GPU timing with timestamp queries that never stalls the queue: a ring of slots,
// each with its own query range and MAP_READ buffer. A frame acquires a free slot (or skips
// timing if all are still being read back), writes `pairs` (begin, end) timestamps, resolves
// them, and reads them back asynchronously a few frames later.

import { pairDurationMs } from '../../src/gpu/timestamps';

export interface RingSlot {
  /** timestampWrites for pass `pair` of this frame. */
  writes(pair: number): GPUComputePassTimestampWrites;
  /** Resolve this slot's queries into its read-back buffer (same encoder, after the passes). */
  resolve(encoder: GPUCommandEncoder): void;
  /** After submit: the pass durations in ms (NaN for an invalid pair, see pairDurationMs). */
  read(): Promise<number[]>;
}

export class TimestampRing {
  private readonly pairs: number;
  private readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly readBuffers: GPUBuffer[];
  private readonly busy: boolean[];
  private next = 0;
  private readonly raw: bigint[] = [];

  constructor(device: GPUDevice, opts: { slots: number; pairs: number }) {
    this.pairs = opts.pairs;
    const perSlot = 2 * opts.pairs;
    this.querySet = device.createQuerySet({
      label: 'timestamp ring',
      type: 'timestamp',
      count: perSlot * opts.slots,
    });
    // resolveQuerySet needs a 256-byte aligned destination offset.
    this.resolveBuffer = device.createBuffer({
      label: 'timestamp ring resolve',
      size: 256 * opts.slots,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffers = Array.from({ length: opts.slots }, (_, k) =>
      device.createBuffer({
        label: `timestamp ring read ${k}`,
        size: 8 * perSlot,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
    );
    this.busy = Array.from({ length: opts.slots }, () => false);
  }

  /** Every raw timestamp read back so far (for quantum detection). */
  rawTimestamps(): readonly bigint[] {
    return this.raw;
  }

  acquire(): RingSlot | null {
    const n = this.busy.length;
    for (let k = 0; k < n; k++) {
      const s = (this.next + k) % n;
      if (!this.busy[s]) {
        this.next = (s + 1) % n;
        this.busy[s] = true;
        return this.slot(s);
      }
    }
    return null;
  }

  private slot(s: number): RingSlot {
    const perSlot = 2 * this.pairs;
    const first = s * perSlot;
    const readBuffer = this.readBuffers[s];
    if (!readBuffer) throw new Error('bad slot');
    return {
      writes: (pair) => ({
        querySet: this.querySet,
        beginningOfPassWriteIndex: first + 2 * pair,
        endOfPassWriteIndex: first + 2 * pair + 1,
      }),
      resolve: (encoder) => {
        encoder.resolveQuerySet(this.querySet, first, perSlot, this.resolveBuffer, 256 * s);
        encoder.copyBufferToBuffer(this.resolveBuffer, 256 * s, readBuffer, 0, 8 * perSlot);
      },
      read: async () => {
        try {
          await readBuffer.mapAsync(GPUMapMode.READ);
          const values = new BigUint64Array(readBuffer.getMappedRange().slice(0));
          readBuffer.unmap();
          this.raw.push(...values);
          return Array.from({ length: this.pairs }, (_, p) =>
            pairDurationMs(values[2 * p] ?? 0n, values[2 * p + 1] ?? 0n),
          );
        } finally {
          this.busy[s] = false;
        }
      },
    };
  }

  destroy(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    for (const b of this.readBuffers) b.destroy();
  }
}
