// Exploded view: the engine's modules slide apart along the shaft, in flow order. A module's
// rank is the number of distinct component start positions between it and the fan (the fan
// stays put, the intake moves forward); parallel components (booster and bypass duct, both
// from the splitter) share a rank.

import { COMPONENT_IDS, type ComponentId, type EngineDefinition } from '../contracts/engine';

export function moduleRank(def: EngineDefinition, module: ComponentId | null): number {
  if (module === null) return 0;
  const starts = [...new Set(def.flowpath.components.map((c) => c.xStart))].sort((a, b) => a - b);
  const x = (id: ComponentId) => def.flowpath.components.find((c) => c.id === id)?.xStart ?? 0;
  return starts.indexOf(x(module)) - starts.indexOf(x('fan'));
}

/** Smoothstep easing, clamped to [0, 1]. */
export function easeInOut(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** Axial offset per module, m, at explode amount t in [0, 1] (eased) and `gap` per rank. */
export function explodeOffsets(
  def: EngineDefinition,
  t: number,
  gap: number,
): Readonly<Record<ComponentId, number>> {
  const e = easeInOut(t);
  const out = {} as Record<ComponentId, number>;
  for (const id of COMPONENT_IDS) out[id] = e === 0 ? 0 : e * gap * moduleRank(def, id);
  return out;
}
