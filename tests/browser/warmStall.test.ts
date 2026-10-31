// D4-95 item 2: what the background warm frames cost, configuration by configuration, after the
// boot's (an engine view on the main thread, warmed as the worker warms it: one budgeted warm
// frame every second frame, before the real frame). Round 4 read Schlieren's 0.65-1.1 s hitch as
// a GPU-process compile; this measures it: every frame pings the GPU process (a submit and its
// onSubmittedWorkDone, so a stall there shows as a late reply), the frame's own CPU is timed, and
// every render pipeline three creates is logged with its object, material and render context.
//
// What it found (round 5): the hitch was the warm frame's own CPU. Schlieren's composite reached
// the scene passes at another renderer call depth than TRAA's chain does, and three keys its
// render contexts by the call depth, so every engine object got a second render object, a node
// rebuild (~15 ms each, ~0.7 s) and a second pipeline, inside one warm frame: the warm budget
// keyed objects by their render target, so it saw none of them as new. Checked here, every run:
// - a warm frame creates pipelines only while drawing objects its budget counted as new;
// - no background configuration recompiles an object the boot already drew with that material.
// The timings are recorded (reports/ui/warm-stall.json), indicative, not gated.
import { commands } from 'vitest/browser';
import { afterAll, describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../src/contracts/ambient';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { FLOW_SOLVER_LIMITS } from '../../src/gpu/device';
import { mockSteadyState } from '../../src/mocks/mockCycle';
import { createMockFlowField } from '../../src/mocks/mockFlowField';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import { BACKGROUND_ORDER, BOOT_CONFIGS, WARM_CONFIGS } from '../../src/shell/warmUp';

const W = 1366;
const H = 768;
/** The worker's warm budget (src/app/simWorker.ts WARM_BUDGET_MS). */
const WARM_BUDGET_MS = 4;
/** Warm frames one configuration may take here before the test says it never finished. */
const MAX_WARM = 300;

const nextFrame = () =>
  new Promise<number>((resolve) => {
    requestAnimationFrame((t) => {
      resolve(t);
    });
  });

interface Pipe {
  readonly in: string;
  readonly object: string;
  readonly material: string;
  readonly context: number;
}

describe('the background warm frames (D4-95 item 2)', () => {
  const views: EngineView[] = [];
  afterAll(async () => {
    for (const v of views) await v.dispose();
  });

  it('compile only what is new, budgeted, and recompile nothing the boot drew', async () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.style.width = `${String(W / 2)}px`;
    c.style.height = `${String(H / 2)}px`;
    document.body.appendChild(c);
    const errors: string[] = [];
    const view = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
      preferredLimits: FLOW_SOLVER_LIMITS,
      onError: (r) => errors.push(`${r.kind}: ${r.message}`),
    });
    views.push(view);
    view.setPreset('threeQuarterFront');
    view.setThrottle(0, true);
    view.setFlowField(
      createMockFlowField(ENGINE_DEFINITION, mockSteadyState(ENGINE_DEFINITION, 0), ISA_SLS),
    );
    view.setFlowMode('realistic');
    view.setFlowTracers(null);
    let where = 'boot';
    // every render pipeline three creates, with what it draws and in which render context
    const pipes: Pipe[] = [];
    const be = view.renderer.backend as unknown as {
      createRenderPipeline(ro: unknown, promises: unknown): void;
    };
    const baseCreate = be.createRenderPipeline.bind(be);
    be.createRenderPipeline = (ro, promises) => {
      const r = ro as {
        object: { name: string; id: number };
        material: { name: string; type: string; id: number };
        context: { id: number };
      };
      pipes.push({
        in: where,
        object: `${r.object.name}#${String(r.object.id)}`,
        material: `${r.material.name || r.material.type}#${String(r.material.id)}`,
        context: r.context.id,
      });
      baseCreate(ro, promises);
    };
    const device = view.device.device;
    const b0 = performance.now();
    const boot = await view.warmUp(BOOT_CONFIGS.map((id) => WARM_CONFIGS[id]));
    const bootMs = performance.now() - b0;
    where = 'settle';
    for (let k = 0; k < 60; k++) {
      await nextFrame();
      view.frame(1 / 60);
    }
    const configs: Record<string, unknown>[] = [];
    const overBudget: string[] = [];
    for (const id of BACKGROUND_ORDER) {
      let done = false;
      let n = 0;
      let maxCpu = 0;
      let maxGap = 0;
      let maxPing = 0;
      let created = 0;
      const pings: Promise<void>[] = [];
      let last = await nextFrame();
      const w0 = performance.now();
      for (let f = 0; !done && n < MAX_WARM; f++) {
        const t = await nextFrame();
        maxGap = Math.max(maxGap, t - last);
        last = t;
        if (f % 2 === 0) {
          where = `${id} warm ${String(n)}`;
          const r = view.warmFrame(WARM_CONFIGS[id], { cpuMs: WARM_BUDGET_MS });
          n++;
          maxCpu = Math.max(maxCpu, r.cpuMs);
          created += r.created;
          // a pipeline is created only while drawing an object the budget let through as new
          // (one new object may build two: a double-sided transparent plane draws both faces)
          if (r.unbudgeted > 0)
            overBudget.push(
              `${id} warm ${String(n - 1)}: ${String(r.unbudgeted)} of ${String(r.created)} pipelines outside the ${String(r.newObjects)} new objects (${r.cpuMs.toFixed(0)} ms)`,
            );
          done = r.done;
        }
        where = `${id} frame`;
        view.frame(1 / 60);
        const p0 = performance.now();
        pings.push(
          device.queue.onSubmittedWorkDone().then(() => {
            maxPing = Math.max(maxPing, performance.now() - p0);
          }),
        );
      }
      await Promise.all(pings);
      configs.push({
        id,
        done,
        warmFrames: n,
        wallMs: Math.round(performance.now() - w0),
        pipelines: created,
        maxWarmCpuMs: Math.round(maxCpu),
        maxFrameGapMs: Math.round(maxGap),
        maxGpuPingMs: Math.round(maxPing),
      });
    }
    // the objects the boot drew, by object and material: a background configuration that
    // creates a pipeline for one of them drew it in another render context (a rebuild)
    const drawnAtBoot = new Set(
      pipes.filter((p) => p.in === 'boot').map((p) => `${p.object} ${p.material}`),
    );
    const recompiled = pipes
      .filter((p) => p.in !== 'boot' && drawnAtBoot.has(`${p.object} ${p.material}`))
      .map((p) => `${p.in}: ${p.object} ${p.material} (context ${String(p.context)})`);
    const out = {
      viewport: `${String(W)}x${String(H)} (main thread)`,
      bootMs: Math.round(bootMs),
      bootSteps: boot.configurations.map(
        (s) => `${s.name} ${s.ms.toFixed(0)} ms (CPU ${s.cpuMs.toFixed(0)} ms)`,
      ),
      configs,
      overBudget,
      recompiledCount: recompiled.length,
      recompiled: recompiled.slice(0, 40),
      errors,
    };
    await commands.writeFile('reports/ui/warm-stall.json', `${JSON.stringify(out, null, 2)}\n`);
    expect(errors).toEqual([]);
    expect(configs.filter((x) => x.done !== true).map((x) => x.id)).toEqual([]);
    expect(overBudget).toEqual([]);
    expect(recompiled).toEqual([]);
  });
});
