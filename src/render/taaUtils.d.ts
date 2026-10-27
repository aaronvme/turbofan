// three r186 ships examples/jsm/tsl/utils/TAAUtils.js without types (@types/three 0.186 has
// none); the three TSL functions our TRAA resolve reuses (src/render/traaResolve.ts).
declare module 'three/addons/tsl/utils/TAAUtils.js' {
  export const clipAABB: (...args: unknown[]) => unknown;
  export const flickerReduction: (...args: unknown[]) => unknown;
  export const samplePreviousDepth: (...args: unknown[]) => unknown;
}
