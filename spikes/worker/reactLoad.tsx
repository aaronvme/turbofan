// Synthetic main-thread UI load for spike (d): a React 19 tree that re-renders at ~15 Hz with
// the kind of DOM work an engine overlay does (numeric readouts with tabular digits, bar
// widths, SVG sparklines, a station table). Commit durations come from <Profiler>; this is the
// development build under the Vite dev server, which is slower than production (stated in
// docs/GPU_FACTS.md).

import { Profiler, useEffect, useState, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';

const GAUGES = 240;
const HISTORY = 60;
const ROWS = 24;
const COLS = 10;
const HZ = 15;

export interface ReactLoadStats {
  updates: number;
  commitMs: number[];
}

function value(tick: number, k: number): number {
  return 50 + 45 * Math.sin(0.07 * tick + 0.37 * k) * Math.cos(0.013 * tick * (1 + (k % 7)));
}

function Gauge({ k, tick }: { k: number; tick: number }) {
  const v = value(tick, k);
  const points: string[] = [];
  for (let i = 0; i < HISTORY; i++) {
    points.push(`${2 * i},${(28 - 0.28 * value(tick - HISTORY + i, k)).toFixed(1)}`);
  }
  return (
    <div className="gauge">
      <span className="label">P{k}</span>
      <span className="value">{v.toFixed(1)}</span>
      <div className="bar" style={{ width: `${v.toFixed(1)}%` }} />
      <svg width={120} height={28}>
        <polyline points={points.join(' ')} fill="none" stroke="currentColor" />
      </svg>
    </div>
  );
}

function Table({ tick }: { tick: number }) {
  return (
    <table>
      <tbody>
        {Array.from({ length: ROWS }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: COLS }, (_, c) => (
              <td key={c}>{(value(tick, r * COLS + c) * 12.3).toFixed(2)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Load() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000 / HZ);
    return () => {
      clearInterval(id);
    };
  }, []);
  return (
    <div className="panel">
      {Array.from({ length: GAUGES }, (_, k) => (
        <Gauge key={k} k={k} tick={tick} />
      ))}
      <Table tick={tick} />
    </div>
  );
}

export function mountReactLoad(root: HTMLElement): ReactLoadStats {
  const stats: ReactLoadStats = { updates: 0, commitMs: [] };
  const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
    if (phase === 'update') {
      stats.updates++;
      stats.commitMs.push(actualDuration);
    }
  };
  createRoot(root).render(
    <Profiler id="load" onRender={onRender}>
      <Load />
    </Profiler>,
  );
  return stats;
}
