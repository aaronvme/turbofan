// The live charts: the fan and HPC maps (the model's own scaled maps, the surge line, the
// operating point and its trail), the T-s diagram and the station strip. SVG, sized by the
// panel; text in the text tokens; the trail fades along viridis (perceptually uniform).

import { useMemo } from 'react';
import { referenceEngine } from '../cycle/engine';
import {
  chartSpeedPercents,
  FAN_LINES,
  HPC_LINES,
  mapGeometry,
  niceTicks,
  placeSpeedLabels,
  plotPoint,
  scaleOf,
  surgeMarginView,
  type MapGeometry,
  type MapPoint,
} from '../hud/compressorMap';
import { placePointLabels } from '../hud/labels';
import { tsDiagram, type TsPoint } from '../hud/tsDiagram';
import * as fmt from '../hud/format';
import type { SimSnapshot } from '../contracts/sim';
import type { MapOperatingPoint } from '../contracts/cycle';
import { STATIONS, STREAM_ORDER, type PlaneStationId } from '../contracts/stations';
import { useApp } from './store';

// viridis at 5 stops (matplotlib's): the trail's age, old (dark) to new (bright)
const VIRIDIS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] as const;
const viridis = (t: number): string =>
  VIRIDIS[Math.max(0, Math.min(VIRIDIS.length - 1, Math.round(t * (VIRIDIS.length - 1))))] ??
  '#fde725';

let maps: { fan: MapGeometry; hpc: MapGeometry } | null = null;
/** The maps' geometry, computed once from the reference engine the worker's model sizes. */
export function mapGeometries(): { fan: MapGeometry; hpc: MapGeometry } {
  if (maps === null) {
    const e = referenceEngine();
    const frame = (w: 'fan' | 'hpc', ref: number) => ({
      map: e.maps[w],
      designCorrectedRpm: e.design.corrSpeed[w],
      referenceRpm: ref,
    });
    // W2A-I2: each map from its own lowest speed line up, so ground idle's fan point (just
    // below the fan map's 30.6 % line) is inside the chart
    const fan = frame('fan', e.calibration.n1ReferenceRpm);
    const hpc = frame('hpc', e.calibration.n2ReferenceRpm);
    maps = {
      fan: mapGeometry(fan, chartSpeedPercents(fan, FAN_LINES)),
      hpc: mapGeometry(hpc, chartSpeedPercents(hpc, HPC_LINES)),
    };
  }
  return maps;
}

// the plot: the y title runs up the left edge, the x ticks sit above the x title, so no axis text
// shares a line with another (the browser suite checks every chart label for overlap)
const W = 300;
const H = 168;
const M = { l: 40, r: 8, t: 10, b: 30 };
const X_TICK_Y = H - M.b + 12;

function AxisTitles({ x, y }: { readonly x: string; readonly y: string }) {
  return (
    <>
      <text className="axis" x={W - M.r} y={H - 3} textAnchor="end">
        {x}
      </text>
      <text
        className="axis"
        transform={`translate(9 ${String((M.t + H - M.b) / 2)}) rotate(-90)`}
        textAnchor="middle"
      >
        {y}
      </text>
    </>
  );
}

/** A small chevron at (x, y) pointing along (dx, dy): the point is beyond the plot's edge. */
function offMarker(x: number, y: number, dx: number, dy: number): string {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const tip = [x + 9 * ux, y + 9 * uy];
  const back = [x + 4 * ux, y + 4 * uy];
  const px = -uy * 4;
  const py = ux * 4;
  return `M${(back[0] ?? 0) + px} ${(back[1] ?? 0) + py}L${tip[0] ?? 0} ${tip[1] ?? 0}L${(back[0] ?? 0) - px} ${(back[1] ?? 0) - py}`;
}

const path = (pts: readonly MapPoint[], x: (v: number) => number, y: (v: number) => number) =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('');

export function CompressorMapChart({
  title,
  geometry,
  point,
  trail,
}: {
  readonly title: string;
  readonly geometry: MapGeometry;
  readonly point: MapOperatingPoint;
  readonly trail: readonly MapPoint[];
}) {
  const g = geometry;
  const x0 = scaleOf(g.bounds.wc, W - M.l - M.r, 0.04);
  const y0 = scaleOf(g.bounds.pr, H - M.t - M.b, 0.04);
  const x = (v: number) => M.l + x0(v);
  const y = (v: number) => H - M.b - y0(v);
  const xt = niceTicks(g.bounds.wc[0], g.bounds.wc[1], 4);
  const yt = niceTicks(g.bounds.pr[0], g.bounds.pr[1], 4);
  const margin = point.surgeMarginFraction;
  // D4-87: below the map's lowest speed line the margin is extrapolated: dimmed, tagged, no amber
  const sm = surgeMarginView(g, point);
  // the speed lines' stall ends crowd near design speed: only the labels that fit are drawn (the
  // map's own lowest line is labelled by its rounded percent)
  const labels = placeSpeedLabels(
    g.speedLines.map((s) => ({
      percent: Math.round(s.percent),
      x: x(s.points[0]?.[0] ?? 0),
      y: y(s.points[0]?.[1] ?? 0),
    })),
  );
  // the point where it is on the plot, or on the plot's edge with a marker (W2A-I2)
  const op = plotPoint(
    x(point.correctedFlowKgPerS),
    y(point.pressureRatio),
    { x: M.l, y: M.t, w: W - M.l - M.r, h: H - M.t - M.b },
    3,
  );
  const label = `${title} map: corrected flow ${fmt.fixed(point.correctedFlowKgPerS, 1)} kg/s, pressure ratio ${fmt.fixed(point.pressureRatio, 2)}, surge margin ${fmt.fixed(100 * margin, 1)} %${sm.tag === null ? '' : `, ${sm.tag} (extrapolated)`}`;
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="value-group">
          {sm.tag !== null && (
            <span className="tag" title="below the map's lowest speed line: extrapolated (D4-87)">
              {sm.tag}
            </span>
          )}
          <span
            className={
              sm.level === 'caution' || sm.level === 'warning' ? `value ${sm.level}` : 'value'
            }
            data-level={sm.level}
          >
            SM {fmt.fixed(100 * margin, 1)}
            <small>%</small> · η {fmt.fixed(100 * point.isentropicEfficiency, 1)}
            <small>%</small>
          </span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {xt.map((t) => (
          <g key={`x${t}`} className="tick">
            <line x1={x(t)} x2={x(t)} y1={M.t} y2={H - M.b} />
            <text x={x(t)} y={X_TICK_Y} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {yt.map((t) => (
          <g key={`y${t}`} className="tick">
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
            <text x={M.l - 5} y={y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {g.speedLines.map((s) => (
          <g key={s.percent} className="speed-line">
            <path d={path(s.points, x, y)} />
          </g>
        ))}
        <g className="speed-labels">
          {labels.map((l) => (
            <text key={l.percent} x={l.x - 2} y={l.y - 3} textAnchor="end">
              {l.percent}
            </text>
          ))}
        </g>
        <path className="surge-line" d={path(g.surgeLine, x, y)} />
        {trail.slice(1).map((p, i) => {
          const a = trail[i];
          if (a === undefined) return null;
          return (
            <line
              key={i}
              className="trail"
              x1={x(a[0])}
              y1={y(a[1])}
              x2={x(p[0])}
              y2={y(p[1])}
              stroke={viridis(i / Math.max(1, trail.length - 2))}
            />
          );
        })}
        {op.off !== null && (
          // off the plot: a chevron on the edge, pointing the way the point left
          <path
            className="op-off"
            d={offMarker(op.x, op.y, op.off.dx, op.off.dy)}
            aria-hidden="true"
          />
        )}
        <circle className="op-ring" cx={op.x} cy={op.y} r={6} data-below-map={sm.tag !== null} />
        <circle className="op" cx={op.x} cy={op.y} r={2.6} data-below-map={sm.tag !== null} />
        <AxisTitles x="W√θ/δ kg/s" y="PR" />
      </svg>
    </figure>
  );
}

export function MapsPanel({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const trails = useApp((s) => s.trails);
  const g = useMemo(mapGeometries, []);
  return (
    <section className="panel maps" aria-label="Compressor maps" data-reserve>
      <header className="panel-head">
        <h2>Compressor maps</h2>
        <span className="tag">surge line · trail {trails.hpc.length}</span>
      </header>
      <CompressorMapChart
        title="Fan"
        geometry={g.fan}
        point={snapshot.cycle.fan}
        trail={trails.fan}
      />
      <CompressorMapChart
        title="HPC"
        geometry={g.hpc}
        point={snapshot.cycle.hpc}
        trail={trails.hpc}
      />
    </section>
  );
}

export function TsPanel({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const d = useMemo(() => tsDiagram(snapshot.cycle.stations), [snapshot.cycle.stations]);
  const all: TsPoint[] = [...d.core, ...d.bypass];
  const s0 = Math.min(...all.map((p) => p.sJPerKgK));
  const s1 = Math.max(...all.map((p) => p.sJPerKgK));
  const t1 = Math.max(...all.map((p) => p.ttK));
  const x0 = scaleOf([s0, s1], W - M.l - M.r, 0.06);
  const y0 = scaleOf([200, t1], H - M.t - M.b, 0.04);
  const x = (v: number) => M.l + x0(v);
  const y = (v: number) => H - M.b - y0(v);
  const line = (pts: readonly TsPoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.sJPerKgK).toFixed(1)} ${y(p.ttK).toFixed(1)}`)
      .join('');
  const stationLabels = placePointLabels(
    d.core
      .filter((p) => ['2', '3', '4', '45', '5'].includes(p.id))
      .map((p) => ({ id: p.id, text: p.id, x: x(p.sJPerKgK), y: y(p.ttK) })),
    { bounds: { x: M.l, y: 0, w: W - M.l, h: H - M.b } },
  );
  const label = `T-s diagram: T3 ${fmt.fixed(snapshot.cycle.stations['3'].ttK, 0)} K, T4 ${fmt.fixed(snapshot.cycle.stations['4'].ttK, 0)} K`;
  return (
    <section className="panel ts" aria-label="T-s diagram" data-reserve>
      <header className="panel-head">
        <h2>T–s</h2>
        <span className="tag">Tt vs s − s₀</span>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {niceTicks(200, t1, 4).map((t) => (
          <g key={t} className="tick">
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
            <text x={M.l - 5} y={y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {niceTicks(s0, s1, 4).map((t) => (
          <g key={`s${t}`} className="tick">
            <line x1={x(t)} x2={x(t)} y1={M.t} y2={H - M.b} />
            <text x={x(t)} y={X_TICK_Y} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {d.isobars.map((iso) => (
          <g key={iso.label} className="isobar">
            <path d={line(iso.points.filter((p) => p.ttK <= t1 * 1.05))} />
          </g>
        ))}
        <path className="ts-bypass" d={line(d.bypass)} />
        <path className="ts-core" d={line(d.core)} />
        {d.core.map((p) => (
          <circle key={p.id} className="ts-station" cx={x(p.sJPerKgK)} cy={y(p.ttK)} r={2.2} />
        ))}
        <g className="ts-labels">
          {stationLabels.map((l) => (
            <text key={l.id} x={l.x} y={l.y} textAnchor={l.anchor}>
              {l.text}
            </text>
          ))}
        </g>
        <AxisTitles x="s − s₀ J/(kg·K)" y="Tt K" />
      </svg>
    </section>
  );
}

const STRIP: readonly PlaneStationId[] = [
  '2',
  '13',
  '25',
  '3',
  '4',
  '45',
  '49.5',
  '5',
  ...([] as PlaneStationId[]),
];

export function StationStrip({ snapshot }: { readonly snapshot: SimSnapshot }) {
  const units = useApp((s) => s.units);
  const st = snapshot.cycle.stations;
  const ids = STRIP.filter(
    (id) => STREAM_ORDER.core.includes(id) || STREAM_ORDER.bypass.includes(id),
  );
  const p = fmt.pressure(st['2'].ptPa, units).unit;
  const t = fmt.temperature(st['2'].ttK, units).unit;
  const w = fmt.massFlow(st['2'].wKgPerS, units).unit;
  return (
    <section className="panel strip" aria-label="Station strip" data-reserve>
      <table>
        <caption className="sr-only">Station total conditions</caption>
        <thead>
          <tr>
            <th scope="col">Stn</th>
            {ids.map((id) => (
              <th key={id} scope="col" title={STATIONS[id].description}>
                {id}
                <small>{STATIONS[id].name}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Pt {p}</th>
            {ids.map((id) => (
              <td key={id}>{fmt.pressure(st[id].ptPa, units).value}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">Tt {t}</th>
            {ids.map((id) => (
              <td key={id}>{fmt.temperature(st[id].ttK, units).value}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">W {w}</th>
            {ids.map((id) => (
              <td key={id}>{fmt.massFlow(st[id].wKgPerS, units).value}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
