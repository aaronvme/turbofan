// The MOCK raster off the frame (src/shell/mockRaster.ts says why): the sim worker posts the cycle
// state, this rasterizes the labelled MOCK into both render extents and posts the field back with
// its texel buffers transferred, and the CPU time it took. A failure is posted, never swallowed.

import type { AmbientConditions } from '../contracts/ambient';
import type { CycleState } from '../contracts/cycle';
import { ENGINE_DEFINITION } from '../engine/definition';
import { createMockFlowField, type MockCpuFlowField } from '../mocks/mockFlowField';

export interface RasterRequest {
  readonly id: number;
  readonly state: CycleState;
  readonly ambient: AmbientConditions;
}

export type RasterReply =
  | { readonly id: number; readonly field: MockCpuFlowField; readonly ms: number }
  | { readonly id: number; readonly error: string };

interface Scope {
  onmessage: ((e: MessageEvent<RasterRequest>) => void) | null;
  postMessage(m: RasterReply, transfer?: Transferable[]): void;
}
const scope = globalThis as unknown as Scope;

scope.onmessage = (e) => {
  const { id, state, ambient } = e.data;
  try {
    const t0 = performance.now();
    const field = createMockFlowField(ENGINE_DEFINITION, state, ambient, { version: id });
    const ms = performance.now() - t0;
    scope.postMessage({ id, field, ms }, [
      field.near.state.buffer,
      field.near.velocity.buffer,
      field.far.state.buffer,
      field.far.velocity.buffer,
    ]);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
