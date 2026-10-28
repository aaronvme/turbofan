// Our own GPUDevice, shared by the solver and three.js (`new WebGPURenderer({ device })`).
// Creating it ourselves lets the solver ask for the limits and features it needs (three
// would otherwise request its own set), and puts error reporting under our control.
//
// Error routing (docs/GPU_FACTS.md, spike b): three's WebGPUBackend.init() *assigns*
// `device.onuncapturederror` on a supplied device, replacing whatever was there, and its
// default handler only logs. So we listen with addEventListener, which three cannot
// clobber, and report every uncaptured error and every unexpected loss to a sink. Nothing
// here swallows an error (CLAUDE.md, P3).

export type GpuErrorKind = 'validation' | 'out-of-memory' | 'internal' | 'unknown' | 'device-lost';

export interface GpuErrorReport {
  readonly kind: GpuErrorKind;
  readonly message: string;
  /** GPUDeviceLostReason, for kind 'device-lost'. */
  readonly reason?: string;
}

export type GpuErrorSink = (report: GpuErrorReport) => void;

export type LimitName = Exclude<keyof GPUSupportedLimits, '__brand'>;

export interface AdapterSummary {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

export interface SimDeviceOptions {
  /** Features the device must have; the request fails if the adapter lacks one. */
  readonly requiredFeatures?: readonly GPUFeatureName[];
  /** Features to enable when the adapter has them, or 'all' for everything it offers. */
  readonly optionalFeatures?: readonly GPUFeatureName[] | 'all';
  /** Limits to request at the adapter's maximum (the defaults are lower). */
  readonly maxLimits?: readonly LimitName[];
  /**
   * Limits wanted at these values, each requested at min(value, the adapter's), so the request
   * never fails; a consumer whose need is not met falls back (FLOW_SOLVER_LIMITS, D4-50).
   */
  readonly preferredLimits?: Readonly<Partial<Record<LimitName, number>>>;
  readonly powerPreference?: GPUPowerPreference;
  readonly label?: string;
  readonly onError: GpuErrorSink;
}

export interface SimDevice {
  /**
   * The GPU object the adapter came from. Held on purpose: dawn.node tears its instance
   * down when this object is garbage-collected, and a live device then crashes the
   * process (access violation; docs/GPU_FACTS.md, spike e).
   */
  readonly gpu: GPU;
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly info: AdapterSummary;
  readonly features: readonly string[];
  readonly hasTimestamps: boolean;
  /** Destroys the device. The 'destroyed' loss this causes is not reported as an error. */
  destroy(): void;
}

export interface ErrorHandlerHandle {
  /** The next 'destroyed' loss is expected (we called destroy()) and is not reported. */
  markDestroyIntentional(): void;
  /** Stops reporting. */
  detach(): void;
}

/** Required features plus the optional ones the adapter supports, without duplicates. */
export function selectFeatures(
  available: ReadonlySet<string>,
  required: readonly GPUFeatureName[],
  optional: readonly GPUFeatureName[] | 'all',
): GPUFeatureName[] {
  const missing = required.filter((f) => !available.has(f));
  if (missing.length > 0) {
    throw new Error(`GPU adapter lacks required feature(s): ${missing.join(', ')}`);
  }
  const wanted = optional === 'all' ? ([...available] as GPUFeatureName[]) : optional;
  const selected = new Set<GPUFeatureName>(required);
  for (const f of wanted) if (available.has(f)) selected.add(f);
  return [...selected];
}

/** Each named limit at the adapter's maximum. */
export function selectLimits(
  adapterLimits: GPUSupportedLimits,
  names: readonly LimitName[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const value = (adapterLimits as unknown as Record<string, unknown>)[name];
    if (typeof value !== 'number') {
      throw new Error(`GPU adapter does not report limit ${name}`);
    }
    out[name] = value;
  }
  return out;
}

/** Each preferred limit at min(value, the adapter's) (SimDeviceOptions.preferredLimits). */
export function selectPreferredLimits(
  adapterLimits: GPUSupportedLimits,
  preferred: Readonly<Partial<Record<LimitName, number>>>,
): Record<string, number> {
  const names = Object.keys(preferred) as LimitName[];
  const max = selectLimits(adapterLimits, names);
  const out: Record<string, number> = {};
  for (const name of names) out[name] = Math.min(preferred[name] ?? 0, max[name] ?? 0);
  return out;
}

/**
 * D4-50: the limits the flow solver wants. Its stage kernel binds 9 storage buffers with the cell
 * sources (WebGPU's default is 8); a device that has only 8 gets the packed form
 * (src/flow/gpu/layout.ts stageStorageBuffers). The Arc 140T's adapter offers 16 (GPU_FACTS M1).
 */
export const FLOW_SOLVER_LIMITS: Readonly<Partial<Record<LimitName, number>>> = {
  maxStorageBuffersPerShaderStage: 9,
};

/** Error class by constructor name, which works for Chrome's and Dawn's error objects. */
export function classifyError(error: GPUError): GpuErrorKind {
  switch (error.constructor.name) {
    case 'GPUValidationError':
      return 'validation';
    case 'GPUOutOfMemoryError':
      return 'out-of-memory';
    case 'GPUInternalError':
      return 'internal';
    default:
      return 'unknown';
  }
}

export function attachErrorHandlers(device: GPUDevice, sink: GpuErrorSink): ErrorHandlerHandle {
  let attached = true;
  let destroyIntentional = false;

  const onUncaptured = (event: GPUUncapturedErrorEvent): void => {
    if (!attached) return;
    sink({ kind: classifyError(event.error), message: event.error.message });
  };

  let detachListener: () => void;
  if (typeof device.addEventListener === 'function') {
    device.addEventListener('uncapturederror', onUncaptured);
    detachListener = () => {
      device.removeEventListener('uncapturederror', onUncaptured);
    };
  } else {
    // No EventTarget: chain the property. Whoever assigns it after us replaces this, so
    // with three.js this path needs re-attaching after the renderer initialises.
    const previous = device.onuncapturederror;
    device.onuncapturederror = (event: GPUUncapturedErrorEvent) => {
      onUncaptured(event);
      previous?.call(device, event);
    };
    detachListener = () => {
      device.onuncapturederror = previous;
    };
  }

  void device.lost.then((info) => {
    if (!attached) return;
    if (info.reason === 'destroyed' && destroyIntentional) return;
    sink({ kind: 'device-lost', message: info.message, reason: info.reason });
  });

  return {
    markDestroyIntentional: () => {
      destroyIntentional = true;
    },
    detach: () => {
      attached = false;
      detachListener();
    },
  };
}

export async function requestSimDevice(gpu: GPU, options: SimDeviceOptions): Promise<SimDevice> {
  const adapter = await gpu.requestAdapter(
    options.powerPreference ? { powerPreference: options.powerPreference } : undefined,
  );
  if (!adapter) throw new Error('No WebGPU adapter available');

  const requiredFeatures = selectFeatures(
    adapter.features,
    options.requiredFeatures ?? [],
    options.optionalFeatures ?? [],
  );
  const requiredLimits = {
    ...selectPreferredLimits(adapter.limits, options.preferredLimits ?? {}),
    ...selectLimits(adapter.limits, options.maxLimits ?? []),
  };
  const device = await adapter.requestDevice({
    ...(options.label ? { label: options.label } : {}),
    requiredFeatures,
    requiredLimits,
  });
  const handle = attachErrorHandlers(device, options.onError);

  const { vendor, architecture, device: deviceName, description } = adapter.info;
  return {
    gpu,
    adapter,
    device,
    info: { vendor, architecture, device: deviceName, description },
    features: [...(device.features as unknown as ReadonlySet<string>)],
    hasTimestamps: device.features.has('timestamp-query'),
    destroy: () => {
      handle.markDestroyIntentional();
      device.destroy();
    },
  };
}

/** A sink that keeps every report, for tests and benchmarks that must see zero errors. */
export class GpuErrorLog {
  readonly reports: GpuErrorReport[] = [];

  readonly sink: GpuErrorSink = (report) => {
    this.reports.push(report);
  };

  clear(): void {
    this.reports.length = 0;
  }

  assertNone(context: string): void {
    if (this.reports.length === 0) return;
    const lines = this.reports.map(
      (r) => `${r.kind}${r.reason ? ` (${r.reason})` : ''}: ${r.message}`,
    );
    throw new Error(`GPU errors during ${context}:\n${lines.join('\n')}`);
  }
}
