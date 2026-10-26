// Prints what Dawn (webgpu@0.6.2) sees on this machine: adapter info, backend, features
// and limits, plus the device features we get when requesting all of them. Evidence for
// docs/GPU_FACTS.md (spike e). Run: node spikes/dawn/adapter-info.ts
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);

const gpu = create([]);
const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) throw new Error('Dawn found no adapter');
const limits: Record<string, number> = {};
for (const key in adapter.limits) {
  const value = (adapter.limits as unknown as Record<string, unknown>)[key];
  if (typeof value === 'number') limits[key] = value;
}
const device = await adapter.requestDevice({
  requiredFeatures: [...(adapter.features as unknown as Set<GPUFeatureName>)],
});
const { vendor, architecture, device: name, description, isFallbackAdapter } = adapter.info;
process.stdout.write(
  JSON.stringify(
    {
      node: process.version,
      webgpu: '0.6.2',
      adapter: { vendor, architecture, device: name, description, isFallbackAdapter },
      // dawn.node exposes the backend only through the description string.
      backend: /D3D12/i.test(description) ? 'd3d12' : description,
      adapterFeatures: [...(adapter.features as unknown as Set<string>)].sort(),
      deviceFeatures: [...(device.features as unknown as Set<string>)].sort(),
      limits,
    },
    null,
    2,
  ) + '\n',
);
device.destroy();
