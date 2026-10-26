import { defineConfig } from 'vitest/config';

// The full-size mesh requirement suite (`npm run test:mesh`, part of `npm run gates`): builds the
// 130k and 80k production meshes on the real EngineDefinition and checks every requirement in
// docs/MESH.md, plus the generated asset's content hash. Kept out of the unit suite (`npm test`)
// so that stays fast and mutation testing of tools/mesh does not rebuild production meshes.
export default defineConfig({
  test: {
    include: ['tests/mesh/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
