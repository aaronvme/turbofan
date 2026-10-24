import { defineConfig } from '@playwright/test';

// End-to-end flows (throttle, modes, scenarios) against the dev server in the installed
// Chrome, so WebGPU runs on the real GPU.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5179',
    channel: 'chrome',
    headless: false,
    viewport: { width: 1920, height: 1080 },
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
  },
  webServer: {
    command: 'npx vite --port 5179 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
