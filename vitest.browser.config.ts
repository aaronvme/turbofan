import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

// Real-browser tests: the installed Chrome (D3D12 + Intel Arc), headed, so WebGPU and
// timings are the real ones. Integration and performance checks live here.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/browser/**/*.test.{ts,tsx}'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      headless: false,
      provider: playwright({
        launchOptions: { channel: 'chrome', args: ['--enable-unsafe-webgpu'] },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
