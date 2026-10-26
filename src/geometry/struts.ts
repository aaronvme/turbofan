// Frame struts (visual only): the fan frame's hub struts in the transition duct behind the
// booster, and the turbine rear frame (TRF) struts in the exhaust behind the last LPT rotor.
// The definition has no frames (the flow solver sees open annuli there), so these rows are
// synthesized here as uncambered, axial NACA 65-series sections spanning hub to casing, and
// lofted like any stator (./blade). Counts and chords are plausible placeholders, not engine
// data (docs/LOOKDEV.md).

import type { BladeRow, ComponentId, EngineDefinition } from '../contracts/engine';

interface StrutSpec {
  readonly id: string;
  readonly name: string;
  readonly component: ComponentId;
  readonly count: number;
  /** Leading edge, as a fraction of the gap from the last row ahead to the component end. */
  readonly start: number;
  readonly axialChord: number;
  readonly thickness: number;
}

const STRUTS: readonly StrutSpec[] = [
  {
    id: 'fan-frame-strut',
    name: 'Fan frame hub strut',
    component: 'transitionDuct',
    count: 12,
    start: 0.15,
    axialChord: 0.11,
    thickness: 0.14,
  },
  {
    id: 'trf-strut',
    name: 'Turbine rear frame strut',
    component: 'exhaust',
    count: 16,
    start: 0.1,
    axialChord: 0.1,
    thickness: 0.12,
  },
];

const span = (v: number) => ({ hub: v, mid: v, tip: v });

/** The strut rows as BladeRows on the rendered walls (`radiusAt`). */
export function frameStrutRows(
  def: EngineDefinition,
  radiusAt: (component: ComponentId, side: 'hub' | 'casing', x: number) => number,
): BladeRow[] {
  return STRUTS.map((s): BladeRow => {
    const c = def.flowpath.components.find((k) => k.id === s.component);
    if (c === undefined) throw new Error(`struts: no component ${s.component}`);
    // behind every row that ends before this component does
    const ahead = def.bladeRows
      .map((r) => Math.max(r.trailingEdge.hub.x, r.trailingEdge.tip.x))
      .filter((x) => x <= c.xEnd)
      .reduce((a, b) => Math.max(a, b), c.xStart);
    const from = Math.max(c.xStart, ahead);
    const x0 = from + s.start * (c.xEnd - from);
    const x1 = x0 + s.axialChord;
    if (x1 >= c.xEnd) throw new Error(`struts: ${s.id} runs past ${s.component}`);
    const edge = (x: number) => ({
      hub: { x, r: radiusAt(s.component, 'hub', x) },
      tip: { x, r: radiusAt(s.component, 'casing', x) },
    });
    return {
      id: s.id,
      name: s.name,
      component: s.component,
      kind: 'stator',
      spool: 'none',
      count: s.count,
      countConfidence: 'estimate',
      leadingEdge: edge(x0),
      trailingEdge: edge(x1),
      chord: span(s.axialChord),
      inletMetalAngle: span(0),
      exitMetalAngle: span(0),
      stagger: span(0),
      maxThicknessRatio: span(s.thickness),
      sweep: 0,
      lean: 0,
      tipClearance: 0,
      vsv: null,
    };
  });
}
