// Lets plain Node (>= 24, native type stripping) run the mesher's TypeScript directly:
//   node --import ./tools/mesh/ts-resolve.mjs tools/mesh/scripts/generate.ts
// The sources use extensionless relative imports (bundler resolution, as Vite and Vitest expect),
// so this synchronous resolve hook retries a failed relative specifier with `.ts` appended.
// No dependency: module.registerHooks is built into Node 24.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.') || specifier.endsWith('.ts')) throw err;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
