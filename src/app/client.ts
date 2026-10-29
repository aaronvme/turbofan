// The main-thread side of D2-4: it creates the sim worker, transfers the canvas to it, owns the
// size and DPR (ResizeObserver, matchMedia on the resolution) and is the orbit event proxy
// (pointer drag, wheel, keys become OrbitInput messages). Snapshots go into the store.

import { DRAG_RAD_PER_PX, orbitInputForKey } from '../shell/orbit';
import type { FromWorker, ToWorker } from '../shell/protocol';
import { useApp } from '../ui/store';

export interface Client {
  dispose(): void;
}

export function startClient(canvas: HTMLCanvasElement): Client {
  const app = useApp.getState();
  if (!('gpu' in navigator)) {
    app.setConnection({ state: 'unsupported', message: 'This browser has no WebGPU.' });
    return { dispose: () => undefined };
  }
  if (typeof canvas.transferControlToOffscreen !== 'function') {
    app.setConnection({ state: 'unsupported', message: 'This browser has no OffscreenCanvas.' });
    return { dispose: () => undefined };
  }
  const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  const post = (m: ToWorker, transfer: Transferable[] = []) => {
    worker.postMessage(m, transfer);
  };
  useApp.setState({ post: (m) => post(m) });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    useApp.getState().receive(e.data);
  };
  worker.onerror = (e) => {
    useApp.getState().setConnection({ state: 'failed', message: `worker: ${e.message}` });
  };

  const size = () => {
    const r = canvas.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(r.width)),
      height: Math.max(1, Math.round(r.height)),
      dpr: Math.min(2, window.devicePixelRatio || 1),
    };
  };
  const offscreen = canvas.transferControlToOffscreen();
  post({ type: 'init', canvas: offscreen, ...size() }, [offscreen]);
  // the slow-motion default the look-dev uses (1/200 s per s), as a render-state command
  useApp.getState().send({ type: 'setRenderState', render: { particleTimeDilation: 200 } });

  let last = '';
  const resize = () => {
    const s = size();
    const key = `${s.width}x${s.height}@${s.dpr}`;
    if (key === last) return;
    last = key;
    post({ type: 'resize', ...s });
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const dprQuery = () => window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  let mq = dprQuery();
  const onDpr = () => {
    resize();
    mq.removeEventListener('change', onDpr);
    mq = dprQuery();
    mq.addEventListener('change', onDpr);
  };
  mq.addEventListener('change', onDpr);

  // the OrbitControls event proxy (D2-4): the worker has no DOM, so input is forwarded
  let drag: { x: number; y: number; id: number } | null = null;
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (drag === null || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag = { ...drag, x: e.clientX, y: e.clientY };
    useApp.getState().orbit({ dAzimuth: -dx * DRAG_RAD_PER_PX, dElevation: dy * DRAG_RAD_PER_PX });
  };
  const onUp = (e: PointerEvent) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    useApp.getState().orbit({ zoom: Math.max(-0.3, Math.min(0.3, e.deltaY * 0.001)) });
  };
  const onKey = (e: KeyboardEvent) => {
    const input = orbitInputForKey(e.key, e.shiftKey);
    if (input === null) return;
    e.preventDefault();
    useApp.getState().orbit(input);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  return {
    dispose() {
      ro.disconnect();
      mq.removeEventListener('change', onDpr);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      worker.terminate();
      useApp.setState({ post: () => undefined });
    },
  };
}
