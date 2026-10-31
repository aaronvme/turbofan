// The three r186 internals the render reaches into (not three's API, not in @types/three), in one
// place, with the startup checks that throw if one moved (D4-95 item 4: the second line of
// defence; tests/unit/render/threeInternals.test.ts pins each against the installed three, so an
// upgrade fails CI first). Who uses them:
// - the warm-up (D4-91, EngineView.warmFrame): an own renderObject on the renderer (three calls
//   the instance's for every object of every pass), keyed by three's own render object key, which
//   holds the current render context (D4-95 item 2); the backend's createRenderPipeline with a
//   promises array, three's compileAsync path (createRenderPipelineAsync);
// - TRAA's render-scale and warm patches (post.ts): its history target, previous depth node,
//   jitter index and the camera uniforms its updateBefore rolls each frame.

/** The three revision these internals were checked against (package.json pins 0.186.1). */
export const THREE_REVISION = '186';

/** Renderer.renderObject's parameters, in order: the warm key reads 0, 4, 6 and 8. */
export const RENDER_OBJECT_PARAMS = [
  'object',
  'scene',
  'camera',
  'geometry',
  'material',
  'group',
  'lightsNode',
  'clippingContext',
  'passId',
] as const;

/** The TRAANode fields post.ts reads and writes (its render-scale fix and the warm frame). */
export const TRAA_STATE_FIELDS = [
  '_historyRenderTarget',
  '_previousDepthNode',
  'updateBefore',
  '_jitterIndex',
] as const;

/** TRAA's camera uniforms, which its updateBefore rolls each frame (a warm frame puts them back). */
export const TRAA_MATRICES = [
  '_cameraNearFar',
  '_cameraWorldMatrix',
  '_cameraWorldMatrixInverse',
  '_cameraProjectionMatrixInverse',
  '_previousCameraWorldMatrix',
  '_previousCameraProjectionMatrixInverse',
] as const;

/** The renderer's own state the warm key reads. */
export interface ThreeRendererInternals {
  /** The render context of the scene being drawn: set by _renderScene before its objects. */
  readonly _currentRenderContext: { readonly id: number } | null;
}

/** A function's parameter names, from its source (defaults dropped). */
export function paramNames(fn: unknown): string[] {
  const code = String(fn);
  const open = code.indexOf('(');
  let depth = 0;
  let close = open;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      close = i;
      break;
    }
  }
  return code
    .slice(open + 1, close)
    .split(',')
    .map((p) => (p.split('=')[0] ?? '').trim())
    .filter((p) => p !== '');
}

const fail = (what: string): never => {
  throw new Error(`three r${THREE_REVISION}'s ${what} moved (src/render/threeInternals.ts)`);
};

/** The renderer internals the warm-up uses: throws if one moved. */
export function checkRendererInternals(renderer: object): void {
  if (!('_currentRenderContext' in renderer)) fail('Renderer._currentRenderContext');
  const proto = Object.getPrototypeOf(renderer) as { renderObject?: unknown } | null;
  const own = proto?.renderObject;
  if (typeof own !== 'function') return fail('Renderer.prototype.renderObject');
  const params = paramNames(own);
  if (params.join() !== RENDER_OBJECT_PARAMS.join())
    fail(`Renderer.prototype.renderObject(${params.join(', ')})`);
}

/** The backend's createRenderPipeline(renderObject, promises): throws if it moved. */
export function checkBackendInternals(backend: object): void {
  const create = (backend as { createRenderPipeline?: unknown }).createRenderPipeline;
  if (typeof create !== 'function' || paramNames(create).join() !== 'renderObject,promises')
    fail('WebGPUBackend.createRenderPipeline(renderObject, promises)');
}

/** TRAANode's state the patches touch: throws if a field moved. */
export function checkTraaInternals(traaNode: object): void {
  for (const field of [...TRAA_STATE_FIELDS, ...TRAA_MATRICES])
    if (!(field in traaNode) || (traaNode as Record<string, unknown>)[field] === undefined)
      fail(`TRAANode.${field}`);
}
