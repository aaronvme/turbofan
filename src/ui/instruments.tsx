// The engine display (N1 and EGT dials above, the N2 dial beside the fuel flow, thrust and TSFC
// readouts, as the CFM56-7B's upper and lower displays split them) and the throttle quadrant
// (the thrust lever beside the fuel lever, start switch and ignition; reset and fault rows under
// them), on the real cycle model's snapshot. Limits are the definition's (EASA TCDS figures in
// src/engine/facts.ts).

import { useId, useState } from 'react';
import { ENGINE_DEFINITION } from '../engine/definition';
import { kelvinToCelsius } from '../engine/units';
import * as fmt from '../hud/format';
import type { SimSnapshot } from '../contracts/sim';
import { IGNITION_MODES, type IgnitionMode } from '../contracts/cycle';
import { useApp } from './store';

const DEF = ENGINE_DEFINITION;
const N1_RED = (100 * DEF.limits.n1MaxRpm) / DEF.designPoint.n1Rpm;
const N2_RED = (100 * DEF.limits.n2MaxRpm) / DEF.designPoint.n2Rpm;
const EGT_RED_C = kelvinToCelsius(DEF.limits.egtTakeoffRedlineK);
const EGT_AMBER_C = kelvinToCelsius(DEF.limits.egtMaxContinuousK);

/** The dial sweeps 210 degrees clockwise from the lower left; its gap is at the bottom, where the
 * readout sits (SVG angles: 0 is +x, 90 is down). */
const SWEEP = 210;
const START = 90 + (360 - SWEEP) / 2;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

interface DialProps {
  readonly label: string;
  readonly value: number;
  readonly digits: number;
  readonly unit: string;
  readonly max: number;
  readonly red: number;
  readonly amber?: number;
  /** The commanded value (N1 target), drawn as a bug on the scale. */
  readonly target?: number | null;
  /** The secondary dial (N2): drawn smaller, beside the readouts. */
  readonly small?: boolean;
}

/** The dial's drawing units (the SVG scales to its column). */
const SIZE = 132;
/** The drawn rows: the target bug's top (cy - r - 7 - 2.8 = 6.2) to the readout under the hub. */
const VIEW_TOP = 2;
const VIEW_H = 98;

export function Dial({ label, value, digits, unit, max, red, amber, target, small }: DialProps) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 4;
  const r = SIZE / 2 - 12;
  const angle = (v: number) => START + (SWEEP * Math.max(0, Math.min(max, v))) / max;
  const level =
    value >= red ? 'warning' : amber !== undefined && value >= amber ? 'caution' : 'normal';
  const shown = fmt.fixed(value, digits);
  const [nx, ny] = polar(cx, cy, r - 6, angle(value));
  return (
    <figure className={small === true ? 'dial small' : 'dial'} data-level={level}>
      <svg
        viewBox={`0 ${VIEW_TOP} ${SIZE} ${VIEW_H}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? Number(value.toFixed(digits)) : 0}
        aria-valuetext={`${shown} ${unit}`}
      >
        <path className="dial-track" d={arc(cx, cy, r, START, START + SWEEP)} />
        {amber !== undefined && (
          <path className="dial-amber" d={arc(cx, cy, r, angle(amber), angle(red))} />
        )}
        <path className="dial-red" d={arc(cx, cy, r, angle(red), angle(max))} />
        <path
          className="dial-value"
          d={arc(cx, cy, r, START, Math.max(START + 0.01, angle(value)))}
        />
        {target !== undefined && target !== null && (
          <circle
            className="dial-bug"
            cx={polar(cx, cy, r + 7, angle(target))[0]}
            cy={polar(cx, cy, r + 7, angle(target))[1]}
            r={2.8}
          />
        )}
        <line className="dial-needle" x1={cx} y1={cy} x2={nx} y2={ny} />
        <circle className="dial-hub" cx={cx} cy={cy} r={3} />
      </svg>
      <figcaption>
        <span className="dial-label">{label}</span>
        <span className="dial-readout">
          {shown}
          <small>{unit}</small>
        </span>
      </figcaption>
    </figure>
  );
}

export function EngineDisplay({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const units = useApp((s) => s.units);
  const c = snapshot.cycle;
  const egtC = kelvinToCelsius(c.egtDisplayedK);
  const ff = fmt.fuelFlow(c.fuelFlowKgPerS, units);
  const fn = fmt.thrust(c.netThrustN, units);
  const sfc = fmt.tsfc(c.tsfcKgPerNs, units);
  return (
    <section className="panel engine-display" aria-label="Engine display" data-reserve>
      <header className="panel-head">
        <h2>Engine</h2>
        <span className="tag" title="The FADEC mode and the control loop that sets fuel flow">
          {c.fadec.mode.toUpperCase()} · {c.fadec.limiter}
        </span>
      </header>
      <div className="dials">
        <Dial
          label="N1"
          value={c.n1Percent}
          digits={1}
          unit="%"
          max={110}
          red={N1_RED}
          target={c.fadec.mode === 'run' ? c.fadec.n1TargetPercent : null}
        />
        <Dial
          label="EGT"
          value={egtC}
          digits={0}
          unit="°C"
          max={1100}
          red={EGT_RED_C}
          amber={EGT_AMBER_C}
        />
      </div>
      <div className="engine-lower">
        <Dial label="N2" value={c.n2Percent} digits={1} unit="%" max={110} red={N2_RED} small />
        <dl className="readouts">
          <div>
            <dt>FF</dt>
            <dd>
              {ff.value}
              <small>{ff.unit}</small>
            </dd>
          </div>
          <div>
            <dt>Net thrust</dt>
            <dd>
              {fn.value}
              <small>{fn.unit}</small>
            </dd>
          </div>
          <div>
            <dt>TSFC</dt>
            <dd>
              {sfc.value}
              <small>{sfc.unit}</small>
            </dd>
          </div>
          <div>
            <dt>Start</dt>
            <dd className="word">
              {c.startPhase === 'none' ? (c.combustorLit ? 'lit' : 'off') : c.startPhase}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const DETENTS = [
  { at: 0, label: 'IDLE' },
  { at: 0.6, label: 'CL' },
  { at: 1, label: 'TO' },
] as const;

/**
 * W2A-I5: the lever the viewer moved, shown until the sim has applied it. The snapshot comes at
 * 20 Hz, so a lever controlled by it alone snapped back to the last echo between presses (five
 * quick ArrowUps ended at 0.01). The local value holds until the snapshot's lastCommandSeq
 * reaches the seq it was sent with; from then on the sim's own value shows (a reset moves it).
 */
export function leverShown(
  sim: { readonly lastCommandSeq: number; readonly throttleLever: number },
  pending: { readonly value: number; readonly seq: number } | null,
): number {
  return pending !== null && sim.lastCommandSeq < pending.seq ? pending.value : sim.throttleLever;
}

export function ThrottleQuadrant({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const send = useApp((s) => s.send);
  const id = useId();
  const [pending, setPending] = useState<{ value: number; seq: number } | null>(null);
  const inp = snapshot.inputs;
  const c = snapshot.cycle;
  const lever = leverShown(
    { lastCommandSeq: snapshot.lastCommandSeq, throttleLever: inp.throttleLever },
    pending,
  );
  const setLever = (value: number) => {
    setPending({ value, seq: send({ type: 'setThrottle', lever: value }) });
  };
  return (
    <section className="panel quadrant" aria-label="Throttle quadrant" data-reserve>
      <header className="panel-head">
        <h2>Controls</h2>
        <span className="tag">lever {Math.round(lever * 100)} %</span>
      </header>
      <div className="quadrant-top">
        <div className="lever">
          <label htmlFor={`${id}-lever`}>Thrust lever</label>
          <div className="lever-track">
            <input
              id={`${id}-lever`}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={lever}
              aria-valuetext={`${Math.round(lever * 100)} % of travel`}
              onChange={(e) => {
                setLever(Number(e.currentTarget.value));
              }}
            />
            <div className="detents" aria-hidden="true">
              {DETENTS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  tabIndex={-1}
                  style={{ bottom: `${d.at * 100}%` }}
                  onClick={() => {
                    setLever(d.at);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="switches">
          <fieldset>
            <legend>Fuel lever</legend>
            <div className="seg" role="group" aria-label="Fuel lever">
              {(['cutoff', 'run'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={inp.fuelLever === p}
                  onClick={() => {
                    send({ type: 'cutoff', cutoff: p === 'cutoff' });
                  }}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Start</legend>
            <button
              type="button"
              className="toggle"
              aria-pressed={inp.starter}
              onClick={() => {
                send({ type: 'start', engage: !inp.starter });
              }}
            >
              {inp.starter ? 'GRD' : 'OFF'}
            </button>
            <span className={`lamp${c.starterEngaged ? ' on' : ''}`}>START VALVE</span>
          </fieldset>
          <fieldset>
            <legend>
              <label htmlFor={`${id}-ign`}>Ignition</label>
            </legend>
            <select
              id={`${id}-ign`}
              value={inp.ignition}
              onChange={(e) => {
                send({ type: 'ignition', mode: e.currentTarget.value as IgnitionMode });
              }}
            >
              {IGNITION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className={`lamp${c.ignitersOn ? ' on' : ''}`}>IGN</span>
          </fieldset>
        </div>
      </div>
      <div className="quadrant-rows">
        <div className="row">
          <span className="row-label" id={`${id}-reset`}>
            Reset
          </span>
          <div className="seg" role="group" aria-labelledby={`${id}-reset`}>
            <button
              type="button"
              onClick={() => {
                send({ type: 'reset', initial: 'shutdown' });
              }}
            >
              Shutdown
            </button>
            <button
              type="button"
              onClick={() => {
                send({ type: 'reset', initial: 'groundIdle' });
              }}
            >
              Ground idle
            </button>
          </div>
        </div>
        <div className="row">
          <span className="row-label" id={`${id}-fault`}>
            Fault
          </span>
          <div className="seg" role="group" aria-labelledby={`${id}-fault`}>
            <button
              type="button"
              onClick={() => {
                send({ type: 'injectFault', fault: 'surge' });
              }}
            >
              Surge
            </button>
            <button
              type="button"
              onClick={() => {
                send({ type: 'injectFault', fault: 'flameout' });
              }}
            >
              Flameout
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
