// D4-95 item 4: the three r186 internals the render reaches into, pinned against the installed
// three, so a three upgrade fails CI here before it fails at the app's startup (whose checks in
// src/render/threeInternals.ts stay as the second line of defence). What each one carries:
// - the warm-up (D4-91, EngineView.warmFrame): an own renderObject on the renderer, called for
//   every object of every pass, keyed by three's own render object key (the object, the
//   material, the current render context, the lights node and the pass: D4-95 item 2), and the
//   backend's createRenderPipeline(renderObject, promises), whose promises array is three's
//   compileAsync path (createRenderPipelineAsync); three skips the draw until it is ready;
// - the warm frame's TRAA (post.ts): the history target, the previous depth node, the jitter
//   index and the camera uniforms its updateBefore rolls every frame, put back after a warm frame;
// - the pass timer (passTimer.ts): the inspector's node frame, advanced by a warm frame.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  InspectorBase,
  NodeFrame,
  PerspectiveCamera,
  REVISION,
  Renderer,
  Texture,
  DepthTexture,
  WebGPUBackend,
  WebGPURenderer,
} from 'three/webgpu';
import { texture } from 'three/tsl';
import TRAANode from 'three/addons/tsl/display/TRAANode.js';
import {
  RENDER_OBJECT_PARAMS,
  THREE_REVISION,
  TRAA_MATRICES,
  TRAA_STATE_FIELDS,
  checkBackendInternals,
  checkRendererInternals,
  checkTraaInternals,
  paramNames,
} from '../../../src/render/threeInternals';

const src = (f: unknown): string => String(f);
/** Whitespace-insensitive "contains" (three's sources are tab-indented). */
const has = (code: string, piece: string) =>
  code.replace(/\s+/g, ' ').includes(piece.replace(/\s+/g, ' '));
const built = readFileSync(
  new URL('../../../node_modules/three/build/three.webgpu.js', import.meta.url),
  'utf8',
);

describe('three r186 internals (D4-95 item 4)', () => {
  it('the installed three is the revision these were checked against', () => {
    expect(REVISION).toBe(THREE_REVISION);
    const pkg = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.three).toBe(`0.${THREE_REVISION}.1`);
  });

  it('paramNames reads a method’s parameters, defaults and all', () => {
    expect(
      paramNames(function f(a: number, b = 2, c = null) {
        return [a, b, c];
      }),
    ).toEqual(['a', 'b', 'c']);
    class K {
      m(x: number, y?: string) {
        return [x, y];
      }
    }
    expect(paramNames(K.prototype.m)).toEqual(['x', 'y']);
  });

  it('the renderer calls an own renderObject for every object, with these parameters', () => {
    const proto = Renderer.prototype as unknown as Record<string, unknown>;
    expect(paramNames(proto.renderObject)).toEqual([...RENDER_OBJECT_PARAMS]);
    // _renderScene and the object loop: the function called is looked up on the instance
    expect(has(src(proto._renderScene), 'this._currentRenderContext = renderContext;')).toBe(true);
    expect(
      has(
        src(proto._renderScene),
        'this._currentRenderObjectFunction = this._renderObjectFunction || this.renderObject;',
      ),
    ).toBe(true);
    expect(
      has(
        src(proto._renderObjects),
        'this._currentRenderObjectFunction( object, scene, camera, geometry, material, group, lightsNode, clippingContext, passId );',
      ),
    ).toBe(true);
  });

  it("three's render object key is the object, material, current render context, lights node and pass", () => {
    const proto = Renderer.prototype as unknown as Record<string, unknown>;
    expect(
      has(
        src(proto._renderObjectDirect),
        'this._objects.get( object, material, scene, camera, lightsNode, this._currentRenderContext, clippingContext, passId )',
      ),
    ).toBe(true);
    expect(has(built, `const chainMap = this.getChainMap( passId );`)).toBe(true);
    expect(
      has(
        built,
        `_chainKeys[ 0 ] = object; _chainKeys[ 1 ] = material; _chainKeys[ 2 ] = renderContext; _chainKeys[ 3 ] = lightsNode;`,
      ),
    ).toBe(true);
    // the render context is keyed by the target's attachments, the MRT and the call depth
    expect(
      has(built, `const renderStateKey = attachmentState + '-' + mrtState + '-' + callDepth;`),
    ).toBe(true);
    // and a draw waits for its pipeline (an asynchronous compile skips the object until ready)
    expect(
      has(
        src(proto._renderObjectDirect),
        'if ( this._pipelines.isReady( renderObject ) ) { this.backend.draw( renderObject, this.info );',
      ),
    ).toBe(true);
  });

  it("the backend's createRenderPipeline(renderObject, promises) is three's compileAsync path", () => {
    const backend = new WebGPUBackend({});
    expect(paramNames(WebGPUBackend.prototype.createRenderPipeline)).toEqual([
      'renderObject',
      'promises',
    ]);
    expect(
      has(
        src(WebGPUBackend.prototype.createRenderPipeline),
        'this.pipelineUtils.createRenderPipeline( renderObject, promises );',
      ),
    ).toBe(true);
    const utils = (backend as unknown as { pipelineUtils: Record<string, unknown> }).pipelineUtils;
    const create = src(utils.createRenderPipeline);
    expect(
      has(
        create,
        'if ( promises === null ) { pipelineData.pipeline = device.createRenderPipeline(',
      ),
    ).toBe(true);
    expect(
      has(
        create,
        'pipelinePromise = device.createRenderPipelineAsync( _renderPipelineDescriptor );',
      ),
    ).toBe(true);
    expect(has(create, 'promises.push( p );')).toBe(true);
    // the startup check passes on three's own renderer and backend
    expect(() => {
      checkBackendInternals(backend);
    }).not.toThrow();
  });

  it("TRAANode's state, which a warm frame saves and puts back, is where the patches expect it", () => {
    const node = new TRAANode(
      texture(new Texture()),
      texture(new DepthTexture(4, 4)),
      texture(new Texture()),
      new PerspectiveCamera(),
    ) as unknown as Record<string, unknown>;
    for (const f of [...TRAA_STATE_FIELDS, ...TRAA_MATRICES]) expect(f in node, f).toBe(true);
    const history = node._historyRenderTarget as { isRenderTarget?: boolean; clone?: unknown };
    expect(history.isRenderTarget).toBe(true);
    expect(typeof history.clone).toBe('function');
    expect('value' in (node._previousDepthNode as object)).toBe(true);
    expect(typeof node._jitterIndex).toBe('number');
    for (const m of TRAA_MATRICES) {
      const u = node[m] as { value?: { clone?: unknown; copy?: unknown } };
      expect(typeof u.value?.clone, m).toBe('function');
      expect(typeof u.value?.copy, m).toBe('function');
    }
    // what its updateBefore rolls each frame (so a warm frame must put it back)
    const update = src(node.updateBefore);
    expect(
      has(update, 'this._previousCameraWorldMatrix.value.copy( this._cameraWorldMatrix.value );'),
    ).toBe(true);
    expect(has(update, 'this._jitterIndex ++;')).toBe(true);
    expect(() => {
      checkTraaInternals(node);
    }).not.toThrow();
    expect(() => {
      checkTraaInternals({ ...node, _jitterIndex: undefined, _historyRenderTarget: undefined });
    }).toThrow(/_historyRenderTarget/);
  });

  it("the inspector's node frame, which the pass timer advances for a warm frame", () => {
    const get = Object.getOwnPropertyDescriptor(InspectorBase.prototype, 'nodeFrame')?.get;
    expect(typeof get).toBe('function');
    expect(has(src(get), 'return this._renderer._nodes.nodeFrame;')).toBe(true);
    expect(typeof NodeFrame.prototype.update).toBe('function');
  });

  it("the startup checks pass on three's own renderer (a canvas stand-in: no GPU here)", () => {
    const canvas = {
      style: {},
      width: 1,
      height: 1,
      addEventListener() {},
      getContext: () => null,
    };
    const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement });
    expect(() => {
      checkRendererInternals(renderer);
    }).not.toThrow();
    expect(() => {
      checkBackendInternals(renderer.backend);
    }).not.toThrow();
  });

  it('the startup checks throw on a renderer whose internals moved', () => {
    expect(() => {
      checkRendererInternals({ backend: {} });
    }).toThrow(/_currentRenderContext|renderObject/);
    const fake = Object.create({
      renderObject(a: unknown) {
        return a;
      },
    }) as object;
    expect(() => {
      checkRendererInternals(Object.assign(fake, { _currentRenderContext: null }));
    }).toThrow(/renderObject/);
    expect(() => {
      checkBackendInternals({
        createRenderPipeline(ro: unknown) {
          return ro;
        },
      });
    }).toThrow(/createRenderPipeline/);
  });
});
