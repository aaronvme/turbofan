// The engine's solid parts as closed meridional loops (counter-clockwise in x right, r up),
// each later revolved (./revolve) and capped (./cap).
//
// The definition gives only the flowpath walls; everything behind them is synthesized so the
// cutaway reads like a real engine section instead of solid billets (all of it is visual
// placeholder, listed in docs/LOOKDEV.md):
// - nacelle: a solid inlet lip ahead of a forward bulkhead, a thin outer skin, the inlet
//   acoustic barrel, a thick fan containment case, the bypass-duct liner and a solid
//   trailing edge, with the hollow nacelle cavity between them;
// - core: a solid splitter nose, a thin core-cowl skin, a case band on the flowpath casing per
//   component (thicker in the hot section) and a solid core-nozzle lip;
// - inner body: the spinner shell, hub drums, one disk (rim, web, bore) under every rotor,
//   static inner walls, the plug shell and the LP and HP shafts.
// Thicknesses are plausible proportions, not engine data.

import type { ComponentId, EngineDefinition, Spool } from '../contracts/engine';
import type { P2 } from './profile';
import type { EngineWall, EngineWalls } from './walls';

export const PART_MATERIALS = [
  'inletLip',
  'nacellePaint',
  'acousticLiner',
  'fanCase',
  'splitter',
  'cowlPaint',
  'compressorCase',
  'combustorCase',
  'turbineCase',
  'exhaust',
  'plug',
  'spinner',
  'drum',
  'disk',
  'innerCase',
  'shaft',
] as const;
export type PartMaterial = (typeof PART_MATERIALS)[number];

export interface PartSpec {
  readonly id: string;
  /** The module it moves with in the exploded view (null: stays, e.g. the shafts). */
  readonly module: ComponentId | null;
  readonly material: PartMaterial;
  /** The spool it turns with (only the spinner's paint makes that visible). */
  readonly spool: Spool | null;
  /** Skins hidden in the exploded view (cowls come off before an engine is split). */
  readonly skin: boolean;
  readonly loop: readonly P2[];
}

/** Station x of the synthesized structure, m. */
const X = {
  lipBulkhead: -0.55,
  fanCaseStart: -0.05,
  fanCaseEnd: 0.35,
  nacelleTe: 1.45,
  splitterBulkhead: 0.32,
  coreLipStart: 2.6,
} as const;

/** Wall thicknesses, m. */
const T = {
  nacelleSkin: 0.006,
  inletBarrel: 0.02,
  fanCase: 0.05,
  bypassLiner: 0.015,
  cowlSkin: 0.006,
  spinner: 0.006,
  plug: 0.006,
} as const;

const SHAFTS = {
  lp: { rIn: 0.035, rOut: 0.05, x0: 0.04, x1: 2.36, boreR: 0.065 },
  hp: { rIn: 0.075, rOut: 0.09, x0: 0.88, x1: 1.84, boreR: 0.1 },
} as const;

/** x of the wall samples strictly inside (x0, x1), plus both ends and a 50 mm minimum grid. */
function xsBetween(x0: number, x1: number, walls: readonly EngineWall[]): number[] {
  const xs = new Set<number>([x0, x1]);
  for (const w of walls) for (const p of w.samples) if (p.x > x0 && p.x < x1) xs.add(p.x);
  const n = Math.ceil((x1 - x0) / 0.05);
  for (let k = 1; k < n; k++) xs.add(x0 + ((x1 - x0) * k) / n);
  return [...xs].sort((a, b) => a - b);
}

/** The loop between lower(x) and upper(x) over the x samples: lower forward, upper back. */
function bandLoop(
  id: string,
  lower: (x: number) => number,
  upper: (x: number) => number,
  xs: readonly number[],
): P2[] {
  const lo = xs.map((x) => ({ x, r: Math.max(0, lower(x)) }));
  const hi = xs.map((x) => ({ x, r: upper(x) })).reverse();
  for (let i = 0; i < xs.length; i++) {
    const a = lo[i];
    const b = hi[xs.length - 1 - i];
    if (a === undefined || b === undefined || !(b.r >= a.r))
      throw new Error(`parts: ${id} has negative thickness at x=${String(a?.x)}`);
  }
  const loop = [...lo, ...hi];
  return dedupe(loop);
}

/** Drops consecutive repeats and a closing repeat; zero-thickness ends collapse to a point. */
function dedupe(loop: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (const p of loop) {
    const q = out[out.length - 1];
    if (q === undefined || q.x !== p.x || q.r !== p.r) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    out.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.r === last.r
  )
    out.pop();
  return out;
}

/** A path from its start (a lip apex) to the first crossing of x = xEnd, interpolated. */
function pathUntil(path: readonly P2[], xEnd: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (p === undefined) continue;
    if (p.x >= xEnd) {
      const q = path[i - 1];
      if (q !== undefined && p.x > xEnd) {
        const t = (xEnd - q.x) / (p.x - q.x);
        out.push({ x: xEnd, r: q.r + t * (p.r - q.r) });
      } else out.push(p);
      return out;
    }
    out.push(p);
  }
  return out;
}

/** The solid ahead of a bulkhead at xEnd between two paths that start at one lip apex. */
function lipLoop(lower: readonly P2[], upper: readonly P2[], xEnd: number): P2[] {
  const lo = pathUntil(lower, xEnd);
  const hi = pathUntil(upper, xEnd).slice(1).reverse();
  return dedupe([...lo, ...hi]);
}

interface DrumSpec {
  readonly id: string;
  readonly x0: number;
  readonly x1: number;
  readonly t: number;
  readonly module: ComponentId;
  readonly spool: Spool | null;
  readonly material: PartMaterial;
}

/** One disk under a rotor row: rim on the drum, a web, a bore ring. */
function diskLoop(
  hub: EngineWall,
  drumT: number,
  xa: number,
  xb: number,
  boreR: number,
  webFraction: number,
): P2[] {
  const xs = xsBetween(xa, xb, [hub]);
  const top = xs.map((x) => ({ x, r: hub.radiusAt(x) - drumT }));
  const rTop = Math.min(...top.map((p) => p.r));
  const rh = hub.radiusAt((xa + xb) / 2);
  const rimLow = rTop - 0.12 * rh;
  const boreTop = boreR + 0.3 * (rimLow - boreR);
  const w = xb - xa;
  const xm = (xa + xb) / 2;
  const web = (webFraction * w) / 2;
  const bore = 0.4 * w;
  const loop: P2[] = [
    { x: xm - bore, r: boreR },
    { x: xm + bore, r: boreR },
    { x: xm + bore, r: boreTop },
    { x: xm + web, r: boreTop },
    { x: xm + web, r: rimLow },
    { x: xb, r: rimLow },
    ...top.slice().reverse(),
    { x: xa, r: rimLow },
    { x: xm - web, r: rimLow },
    { x: xm - web, r: boreTop },
    { x: xm - bore, r: boreTop },
  ];
  return dedupe(loop);
}

const tube = (rIn: number, rOut: number, x0: number, x1: number): P2[] => [
  { x: x0, r: rIn },
  { x: x1, r: rIn },
  { x: x1, r: rOut },
  { x: x0, r: rOut },
];

/** Every solid part of the rendered engine (see the header). */
export function engineParts(def: EngineDefinition, walls: EngineWalls): PartSpec[] {
  const parts: PartSpec[] = [];
  const add = (
    id: string,
    module: ComponentId | null,
    material: PartMaterial,
    loop: P2[],
    spool: Spool | null = null,
    skin = false,
  ) => {
    parts.push({ id, module, material, spool, skin, loop });
  };
  const { hub, coreOuter, coreCowl, nacelleInner: nIn, nacelleOuter: nOut } = walls;
  const r =
    (w: EngineWall, dr = 0) =>
    (x: number) =>
      w.radiusAt(x) + dr;

  // nacelle
  add('inlet-lip', 'inlet', 'inletLip', lipLoop(nIn.path, nOut.path, X.lipBulkhead), null, true);
  add(
    'nacelle-skin',
    'inlet',
    'nacellePaint',
    bandLoop(
      'nacelle-skin',
      r(nOut, -T.nacelleSkin),
      r(nOut),
      xsBetween(X.lipBulkhead, X.nacelleTe, [nOut]),
    ),
    null,
    true,
  );
  add(
    'inlet-barrel',
    'inlet',
    'acousticLiner',
    bandLoop(
      'inlet-barrel',
      r(nIn),
      r(nIn, T.inletBarrel),
      xsBetween(X.lipBulkhead, X.fanCaseStart, [nIn]),
    ),
    null,
    true,
  );
  add(
    'fan-case',
    'fan',
    'fanCase',
    bandLoop('fan-case', r(nIn), r(nIn, T.fanCase), xsBetween(X.fanCaseStart, X.fanCaseEnd, [nIn])),
  );
  add(
    'bypass-liner',
    'bypassDuct',
    'acousticLiner',
    bandLoop(
      'bypass-liner',
      r(nIn),
      r(nIn, T.bypassLiner),
      xsBetween(X.fanCaseEnd, X.nacelleTe, [nIn]),
    ),
    null,
    true,
  );
  const nacEnd = nIn.xMax;
  add(
    'nacelle-te',
    'bypassDuct',
    'nacellePaint',
    bandLoop('nacelle-te', r(nIn), r(nOut), xsBetween(X.nacelleTe, nacEnd, [nIn, nOut])),
    null,
    true,
  );

  // core cowl and cases
  add(
    'splitter',
    'booster',
    'splitter',
    lipLoop(coreOuter.path, coreCowl.path, X.splitterBulkhead),
  );
  add(
    'core-cowl-skin',
    'bypassDuct',
    'cowlPaint',
    bandLoop(
      'core-cowl-skin',
      r(coreCowl, -T.cowlSkin),
      r(coreCowl),
      xsBetween(X.splitterBulkhead, X.coreLipStart, [coreCowl]),
    ),
    null,
    true,
  );
  const comp = (id: ComponentId) => {
    const c = def.flowpath.components.find((k) => k.id === id);
    if (c === undefined) throw new Error(`parts: no component ${id}`);
    return c;
  };
  const cases: readonly [ComponentId, number, PartMaterial][] = [
    ['booster', 0.008, 'compressorCase'],
    ['transitionDuct', 0.008, 'compressorCase'],
    ['hpc', 0.01, 'compressorCase'],
    ['combustor', 0.012, 'combustorCase'],
    ['hpt', 0.015, 'turbineCase'],
    ['interTurbineDuct', 0.012, 'turbineCase'],
    ['lpt', 0.012, 'turbineCase'],
    ['exhaust', 0.008, 'exhaust'],
  ];
  for (const [id, t, material] of cases) {
    const c = comp(id);
    const x0 = id === 'booster' ? X.splitterBulkhead : c.xStart;
    const x1 = id === 'exhaust' ? X.coreLipStart : c.xEnd;
    const key = `case-${id === 'interTurbineDuct' ? 'itd' : id === 'transitionDuct' ? 'transition' : id}`;
    add(
      key,
      id,
      material,
      bandLoop(key, r(coreOuter), r(coreOuter, t), xsBetween(x0, x1, [coreOuter])),
    );
  }
  add(
    'core-lip',
    'exhaust',
    'exhaust',
    bandLoop(
      'core-lip',
      r(coreOuter),
      r(coreCowl),
      xsBetween(X.coreLipStart, coreOuter.xMax, [coreOuter, coreCowl]),
    ),
  );

  // inner body
  const fanStart = comp('fan').xStart;
  add(
    'spinner',
    'fan',
    'spinner',
    bandLoop('spinner', r(hub, -T.spinner), r(hub), xsBetween(hub.xMin, fanStart, [hub])),
    'lp',
  );
  const drums: DrumSpec[] = [
    {
      id: 'fan-hub',
      x0: fanStart,
      x1: 0.2,
      t: 0.012,
      module: 'fan',
      spool: 'lp',
      material: 'drum',
    },
    {
      id: 'booster-drum',
      x0: 0.2,
      x1: comp('booster').xEnd,
      t: 0.008,
      module: 'booster',
      spool: 'lp',
      material: 'drum',
    },
    {
      id: 'transition-inner',
      x0: comp('transitionDuct').xStart,
      x1: comp('transitionDuct').xEnd,
      t: 0.008,
      module: 'transitionDuct',
      spool: null,
      material: 'innerCase',
    },
    {
      id: 'hpc-drum',
      x0: comp('hpc').xStart,
      x1: comp('hpc').xEnd,
      t: 0.008,
      module: 'hpc',
      spool: 'hp',
      material: 'drum',
    },
    {
      id: 'combustor-inner',
      x0: comp('combustor').xStart,
      x1: comp('combustor').xEnd,
      t: 0.01,
      module: 'combustor',
      spool: null,
      material: 'combustorCase',
    },
    {
      id: 'hpt-hub',
      x0: comp('hpt').xStart,
      x1: comp('hpt').xEnd,
      t: 0.012,
      module: 'hpt',
      spool: 'hp',
      material: 'drum',
    },
    {
      id: 'itd-inner',
      x0: comp('interTurbineDuct').xStart,
      x1: comp('interTurbineDuct').xEnd,
      t: 0.01,
      module: 'interTurbineDuct',
      spool: null,
      material: 'innerCase',
    },
    {
      id: 'lpt-drum',
      x0: comp('lpt').xStart,
      x1: comp('lpt').xEnd,
      t: 0.01,
      module: 'lpt',
      spool: 'lp',
      material: 'drum',
    },
  ];
  for (const d of drums) {
    add(
      d.id,
      d.module,
      d.material,
      bandLoop(d.id, r(hub, -d.t), r(hub), xsBetween(d.x0, d.x1, [hub])),
      d.spool,
    );
  }
  add(
    'plug',
    'exhaust',
    'plug',
    bandLoop('plug', r(hub, -T.plug), r(hub), xsBetween(comp('exhaust').xStart, hub.xMax, [hub])),
  );

  for (const row of def.bladeRows) {
    if (row.kind !== 'rotor' || row.spool === 'none') continue;
    const xa = row.leadingEdge.hub.x;
    const xb = row.trailingEdge.hub.x;
    const drum = drums.find((d) => d.x0 <= xa && d.x1 >= xb);
    if (drum === undefined) throw new Error(`parts: no drum under ${row.id}`);
    const turbine = row.component === 'hpt' || row.component === 'lpt';
    add(
      `disk-${row.id}`,
      row.component,
      'disk',
      diskLoop(hub, drum.t, xa, xb, SHAFTS[row.spool].boreR, turbine ? 0.5 : 0.3),
      row.spool,
    );
  }
  add(
    'lp-shaft',
    null,
    'shaft',
    tube(SHAFTS.lp.rIn, SHAFTS.lp.rOut, SHAFTS.lp.x0, SHAFTS.lp.x1),
    'lp',
  );
  add(
    'hp-shaft',
    null,
    'shaft',
    tube(SHAFTS.hp.rIn, SHAFTS.hp.rOut, SHAFTS.hp.x0, SHAFTS.hp.x1),
    'hp',
  );
  return parts;
}
