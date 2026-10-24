// Spike (d) COOP/COEP check: does a module worker get WebGPU and see a SharedArrayBuffer?

self.onmessage = async (e: MessageEvent<{ shared: SharedArrayBuffer | null }>) => {
  const { shared } = e.data;
  if (shared) Atomics.store(new Int32Array(shared), 0, 42);
  const adapter = await navigator.gpu.requestAdapter();
  self.postMessage({
    crossOriginIsolated: self.crossOriginIsolated,
    receivedSharedArrayBuffer: shared !== null,
    webgpuAdapter: adapter !== null,
  });
};
