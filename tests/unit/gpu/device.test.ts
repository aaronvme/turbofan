import { describe, expect, it } from 'vitest';
import {
  GpuErrorLog,
  attachErrorHandlers,
  classifyError,
  requestSimDevice,
  selectFeatures,
  selectLimits,
  type GpuErrorReport,
} from '../../../src/gpu/device';

// Fakes for the parts of the WebGPU API the helper touches. Real devices are covered by
// tests/gpu (Dawn) and tests/browser (Chrome); these pin the selection and error-routing
// logic without a GPU.

class GPUValidationError {
  constructor(readonly message: string) {}
}
class GPUOutOfMemoryError {
  constructor(readonly message: string) {}
}
class GPUInternalError {
  constructor(readonly message: string) {}
}

type Listener = (event: { error: { message: string } }) => void;

class FakeDevice {
  readonly listeners = new Set<Listener>();
  onuncapturederror: Listener | null = null;
  readonly lost: Promise<{ reason: string; message: string }>;
  destroyed = false;
  private resolveLost!: (info: { reason: string; message: string }) => void;

  constructor(
    readonly features: Set<string>,
    readonly limits: Record<string, number>,
    readonly withEventTarget = true,
  ) {
    this.lost = new Promise((resolve) => {
      this.resolveLost = resolve;
    });
    if (!withEventTarget) {
      // Shape of an implementation that only offers the event-handler property.
      (this as { addEventListener?: unknown }).addEventListener = undefined;
      (this as { removeEventListener?: unknown }).removeEventListener = undefined;
    }
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === 'uncapturederror') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === 'uncapturederror') this.listeners.delete(listener);
  }

  emit(error: { message: string }): void {
    for (const l of this.listeners) l({ error });
    this.onuncapturederror?.({ error });
  }

  lose(reason: string, message: string): void {
    this.resolveLost({ reason, message });
  }

  destroy(): void {
    this.destroyed = true;
    this.resolveLost({ reason: 'destroyed', message: 'device was destroyed' });
  }
}

function fakeAdapter(features: string[], limits: Record<string, number>) {
  const requests: { requiredFeatures?: string[]; requiredLimits?: Record<string, number> }[] = [];
  let lastDevice: FakeDevice | null = null;
  const adapter = {
    features: new Set(features),
    limits,
    info: {
      vendor: 'intel',
      architecture: 'xe-lpg',
      device: 'arc-140t',
      description: 'D3D12 driver version 1.2.3',
    },
    requestDevice(desc: { requiredFeatures?: string[]; requiredLimits?: Record<string, number> }) {
      requests.push(desc);
      lastDevice = new FakeDevice(
        new Set([...(desc.requiredFeatures ?? []), 'core-features-and-limits']),
        { ...limits, ...(desc.requiredLimits ?? {}) },
      );
      return Promise.resolve(lastDevice);
    },
  };
  return {
    adapter,
    requests,
    device: () => {
      if (!lastDevice) throw new Error('no device requested yet');
      return lastDevice;
    },
  };
}

function fakeGpu(adapter: unknown) {
  const calls: unknown[] = [];
  return {
    calls,
    gpu: {
      requestAdapter(opts: unknown) {
        calls.push(opts);
        return Promise.resolve(adapter);
      },
    } as unknown as GPU,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('selectFeatures', () => {
  const available = new Set(['timestamp-query', 'shader-f16', 'float32-filterable']);

  it('keeps required features and the optional ones the adapter has', () => {
    expect(
      selectFeatures(available, ['shader-f16'], ['timestamp-query', 'subgroups']).sort(),
    ).toEqual(['shader-f16', 'timestamp-query']);
  });

  it("requests every adapter feature for 'all'", () => {
    expect(selectFeatures(available, [], 'all').sort()).toEqual([
      'float32-filterable',
      'shader-f16',
      'timestamp-query',
    ]);
  });

  it('throws, naming the feature, when a required one is missing', () => {
    expect(() => selectFeatures(available, ['subgroups'], [])).toThrow(/subgroups/);
  });

  it('does not list a feature twice', () => {
    expect(selectFeatures(available, ['shader-f16'], ['shader-f16'])).toEqual(['shader-f16']);
  });
});

describe('selectLimits', () => {
  it("requests each named limit at the adapter's maximum", () => {
    const limits = {
      maxComputeWorkgroupStorageSize: 32768,
      maxStorageBufferBindingSize: 2 ** 31,
    } as unknown as GPUSupportedLimits;
    expect(
      selectLimits(limits, ['maxComputeWorkgroupStorageSize', 'maxStorageBufferBindingSize']),
    ).toEqual({ maxComputeWorkgroupStorageSize: 32768, maxStorageBufferBindingSize: 2 ** 31 });
  });

  it('throws on a limit the adapter does not report', () => {
    expect(() => selectLimits({} as GPUSupportedLimits, ['maxBufferSize'])).toThrow(
      /maxBufferSize/,
    );
  });
});

describe('classifyError', () => {
  it('maps the WebGPU error classes by constructor name', () => {
    expect(classifyError(new GPUValidationError('a'))).toBe('validation');
    expect(classifyError(new GPUOutOfMemoryError('a'))).toBe('out-of-memory');
    expect(classifyError(new GPUInternalError('a'))).toBe('internal');
    expect(classifyError({ message: 'x' })).toBe('unknown');
  });
});

describe('attachErrorHandlers', () => {
  it('reports uncaptured errors through an event listener, so assigning onuncapturederror later (three.js does) cannot drop them', () => {
    const device = new FakeDevice(new Set(), {});
    const reports: GpuErrorReport[] = [];
    attachErrorHandlers(device as unknown as GPUDevice, (r) => reports.push(r));
    // three's WebGPUBackend.init() assigns the property on a supplied device.
    device.onuncapturederror = () => undefined;
    device.emit(new GPUValidationError('bad bind group'));
    expect(reports).toEqual([{ kind: 'validation', message: 'bad bind group' }]);
  });

  it('falls back to the handler property when the device has no addEventListener, chaining any existing one', () => {
    const device = new FakeDevice(new Set(), {}, false);
    const previous: string[] = [];
    device.onuncapturederror = (e) => previous.push(e.error.message);
    const reports: GpuErrorReport[] = [];
    attachErrorHandlers(device as unknown as GPUDevice, (r) => reports.push(r));
    device.emit(new GPUOutOfMemoryError('oom'));
    expect(reports).toEqual([{ kind: 'out-of-memory', message: 'oom' }]);
    expect(previous).toEqual(['oom']);
  });

  it('reports an unexpected device loss, with its reason', async () => {
    const device = new FakeDevice(new Set(), {});
    const reports: GpuErrorReport[] = [];
    attachErrorHandlers(device as unknown as GPUDevice, (r) => reports.push(r));
    device.lose('unknown', 'TDR');
    await flush();
    expect(reports).toEqual([{ kind: 'device-lost', message: 'TDR', reason: 'unknown' }]);
  });

  it('also reports a "destroyed" loss unless the owner marked it intentional', async () => {
    const device = new FakeDevice(new Set(), {});
    const reports: GpuErrorReport[] = [];
    attachErrorHandlers(device as unknown as GPUDevice, (r) => reports.push(r));
    device.destroy();
    await flush();
    expect(reports.map((r) => r.reason)).toEqual(['destroyed']);
  });

  it('stops reporting errors after detach, and an intentional destroy is silent', async () => {
    const device = new FakeDevice(new Set(), {});
    const reports: GpuErrorReport[] = [];
    const handle = attachErrorHandlers(device as unknown as GPUDevice, (r) => reports.push(r));
    handle.markDestroyIntentional();
    handle.detach();
    device.emit(new GPUValidationError('late'));
    device.destroy();
    await flush();
    expect(reports).toEqual([]);
  });
});

describe('requestSimDevice', () => {
  it('requests the adapter, the selected features and the max limits, and summarises the adapter', async () => {
    const fa = fakeAdapter(['timestamp-query', 'shader-f16'], {
      maxComputeWorkgroupStorageSize: 32768,
    });
    const { gpu, calls } = fakeGpu(fa.adapter);
    const sim = await requestSimDevice(gpu, {
      optionalFeatures: ['timestamp-query', 'subgroups'],
      maxLimits: ['maxComputeWorkgroupStorageSize'],
      powerPreference: 'high-performance',
      onError: () => undefined,
    });
    expect(calls).toEqual([{ powerPreference: 'high-performance' }]);
    expect(fa.requests[0]?.requiredFeatures).toEqual(['timestamp-query']);
    expect(fa.requests[0]?.requiredLimits).toEqual({ maxComputeWorkgroupStorageSize: 32768 });
    expect(sim.info).toEqual({
      vendor: 'intel',
      architecture: 'xe-lpg',
      device: 'arc-140t',
      description: 'D3D12 driver version 1.2.3',
    });
    expect(sim.features).toContain('timestamp-query');
    expect(sim.hasTimestamps).toBe(true);
  });

  it('keeps a reference to the GPU object (dawn.node crashes if it is collected while a device lives)', async () => {
    const fa = fakeAdapter([], {});
    const { gpu } = fakeGpu(fa.adapter);
    const sim = await requestSimDevice(gpu, { onError: () => undefined });
    expect(sim.gpu).toBe(gpu);
  });

  it('throws when no adapter is available', async () => {
    const { gpu } = fakeGpu(null);
    await expect(requestSimDevice(gpu, { onError: () => undefined })).rejects.toThrow(/adapter/);
  });

  it('routes errors to the sink, and destroy() does not report its own loss', async () => {
    const fa = fakeAdapter([], {});
    const { gpu } = fakeGpu(fa.adapter);
    const reports: GpuErrorReport[] = [];
    const sim = await requestSimDevice(gpu, { onError: (r) => reports.push(r) });
    fa.device().emit(new GPUInternalError('boom'));
    sim.destroy();
    await flush();
    expect(fa.device().destroyed).toBe(true);
    expect(reports).toEqual([{ kind: 'internal', message: 'boom' }]);
    expect(sim.hasTimestamps).toBe(false);
  });
});

describe('GpuErrorLog', () => {
  it('collects reports and assertNone throws with every message', () => {
    const log = new GpuErrorLog();
    log.assertNone('clean');
    log.sink({ kind: 'validation', message: 'first' });
    log.sink({ kind: 'device-lost', message: 'second', reason: 'unknown' });
    expect(log.reports).toHaveLength(2);
    expect(() => {
      log.assertNone('after frame');
    }).toThrow(/after frame.*validation: first.*device-lost \(unknown\): second/s);
    log.clear();
    expect(log.reports).toHaveLength(0);
  });
});
