// Placeholder shell until W2/ui. It only reports whether WebGPU is available.
export function App() {
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  return (
    <main className="shell">
      <h1>Turbofan</h1>
      <p>{hasWebGpu ? 'WebGPU available' : 'WebGPU is not available in this browser'}</p>
    </main>
  );
}
