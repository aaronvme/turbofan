// Does a live Dawn device keep Node's process alive (the researched claim) or not?
// Creates a device, keeps references to it and to the GPU object on globalThis (a collected
// GPU object crashes dawn.node), submits one empty command buffer, and returns. If the process
// exits on its own, a live device does not hold the event loop open.
// Run: node spikes/dawn/exit-probe.ts   (exits within a second or two when the claim is wrong)
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);

const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('Dawn found no adapter');
const device = await adapter.requestDevice();
device.queue.submit([device.createCommandEncoder().finish()]);
await device.queue.onSubmittedWorkDone();
Object.assign(globalThis, { keepGpu: gpu, keepDevice: device });
const started = performance.now();
process.on('exit', () => {
  process.stdout.write(
    `exit-probe: process exited ${(performance.now() - started).toFixed(0)} ms after the last await, device never destroyed\n`,
  );
});
process.stdout.write('exit-probe: device alive, nothing else scheduled\n');
