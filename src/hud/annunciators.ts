// What the overlay annunciates, from the snapshot alone: the gas-path solve (D4-13/D4-17: a held
// solve is a fault indication, with its count and, W2F-I1, its cause), the cycle flags, the flow
// solver's run status and the data provenance. Pure, so the tests pin every message.

import type { CycleState } from '../contracts/cycle';
import type { FlowStatus, SnapshotSources } from '../contracts/sim';
import type { FlowLinkState } from '../flow/viz/fieldLink';
import { provenanceLabel } from '../flow/viz/legend';
import type { RasterHealth } from '../shell/protocol';

export type Level = 'normal' | 'advisory' | 'caution' | 'warning';

export interface Annunciation {
  readonly id: string;
  readonly level: Level;
  readonly text: string;
  readonly detail?: string;
}

export function gasPathAnnunciation(
  cycle: Pick<CycleState, 'gasPathSolve'>,
  cause: string | null,
): Annunciation {
  const { status, lostSolves } = cycle.gasPathSolve;
  const lost = `${lostSolves} lost since reset`;
  if (status === 'held')
    return {
      id: 'gasPath',
      level: 'warning',
      text: 'GAS PATH HELD',
      detail: `matched solve lost; holding the last converged gas path (${lost})${cause === null ? '' : `: ${cause}`}`,
    };
  if (lostSolves > 0)
    return {
      id: 'gasPath',
      level: 'caution',
      text: status === 'subIdle' ? 'SUB-IDLE MODEL' : 'MATCHED',
      detail: `${lost}${cause === null ? '' : `; last: ${cause}`}`,
    };
  return status === 'subIdle'
    ? {
        id: 'gasPath',
        level: 'advisory',
        text: 'SUB-IDLE MODEL',
        detail: 'start, windmill or shutdown: the similarity model',
      }
    : { id: 'gasPath', level: 'normal', text: 'MATCHED', detail: 'matched map model converged' };
}

const FLAG_TEXT: Readonly<Record<keyof CycleState['flags'], [Level, string]>> = {
  surge: ['warning', 'SURGE'],
  flameout: ['warning', 'FLAMEOUT'],
  hungStart: ['caution', 'HUNG START'],
  hotStart: ['warning', 'HOT START'],
  noLightOff: ['caution', 'NO LIGHT-OFF'],
  n1Overspeed: ['warning', 'N1 OVERSPEED'],
  n2Overspeed: ['warning', 'N2 OVERSPEED'],
  egtExceedance: ['warning', 'EGT EXCEEDANCE'],
};

export function flagAnnunciations(cycle: Pick<CycleState, 'flags'>): Annunciation[] {
  return (Object.keys(FLAG_TEXT) as (keyof CycleState['flags'])[])
    .filter((k) => cycle.flags[k])
    .map((k) => ({ id: k, level: FLAG_TEXT[k][0], text: FLAG_TEXT[k][1] }));
}

/**
 * The flow solver's status; `drawn` false: a running solver that is not drawn is idle (it is not
 * stepped, W2A-N8), not "running" at 0 iterations.
 */
export function flowAnnunciation(flow: FlowStatus, drawn = true): Annunciation {
  if (flow.status === 'running' && !drawn)
    return {
      id: 'flow',
      level: 'normal',
      text: 'SOLVER IDLE',
      detail: 'started, not drawn: not stepped',
    };
  switch (flow.status) {
    case 'unavailable':
      return {
        id: 'flow',
        level: 'advisory',
        text: 'SOLVER OFF',
        detail: flow.error ?? 'no WebGPU solver',
      };
    case 'initialising':
      return {
        id: 'flow',
        level: 'advisory',
        text: 'SOLVER INIT',
        detail: 'compiling, uploading the mesh',
      };
    case 'running':
      return { id: 'flow', level: 'normal', text: 'SOLVER RUNNING', detail: `${flow.mode} mode` };
    case 'diverged':
    case 'lost':
      return {
        id: 'flow',
        level: 'warning',
        text: flow.status === 'lost' ? 'SOLVER LOST' : 'SOLVER DIVERGED',
        detail: flow.error ?? '',
      };
  }
}

/** What the badges read of the drawn field's link (D4-82): its coupling and any fallback. */
export type FieldLinkView = FlowLinkState;

function fieldBadge(flow: SnapshotSources['flow'], link: FieldLinkView | null): Annunciation {
  if (flow === 'solver') {
    // only a link that says so is coupled: an unknown coupling reads the conservative way
    // (W2A-N3), as the dock's legend does
    if (link?.coupling === 'coupled')
      return {
        id: 'field',
        level: 'normal',
        text: 'FIELD: SOLVER (coupled)',
        detail: provenanceLabel('coupled'),
      };
    if (link?.coupling === 'calibrating')
      return {
        id: 'field',
        level: 'advisory',
        text: 'FIELD: solver (calibrating)',
        detail: provenanceLabel('calibrating'),
      };
    return {
      id: 'field',
      level: 'advisory',
      text: 'FIELD: solver (uncoupled until W3)',
      detail: provenanceLabel('uncoupled'),
    };
  }
  if (flow === 'mock') {
    if (link !== null && link.fallback !== null)
      return {
        id: 'field',
        level: 'caution',
        text: 'FIELD: MOCK fallback',
        detail: provenanceLabel('mock', link.fallback),
      };
    return {
      id: 'field',
      level: 'caution',
      text: 'FIELD: MOCK',
      detail: 'a synthetic field scaled by the cycle state, not the solver',
    };
  }
  return { id: 'field', level: 'advisory', text: 'FIELD: NONE', detail: 'no flow field bound' };
}

/**
 * The provenance badges: every mock part is named (W0C-I3), the solver's field says it is
 * uncoupled until W3, and a MOCK drawn in place of the solver says it is a fallback (D4-82).
 */
export function provenanceBadges(
  s: SnapshotSources,
  link: FieldLinkView | null = null,
): Annunciation[] {
  const cycle: Annunciation =
    s.cycle === 'model'
      ? {
          id: 'cycle',
          level: 'normal',
          text: 'CYCLE: MODEL',
          detail: 'the transient cycle model (src/cycle)',
        }
      : {
          id: 'cycle',
          level: 'caution',
          text: 'CYCLE: MOCK',
          detail: 'a labelled stand-in, not the model',
        };
  return [cycle, fieldBadge(s.flow, link)];
}

/** What the overlay knows of the worker's faults outside the field switch (W2A-I1). */
export interface FaultInputs {
  /** Why the sim stopped (a thrown cycle step); null while it runs. */
  readonly simStopped: string | null;
  /** GPU errors posted so far (validation, out-of-memory, internal). */
  readonly gpuErrors: number;
  readonly raster: RasterHealth | null;
  /** Commands the worker refused, recently. */
  readonly refused: number;
}

/**
 * W2A-I1: the worker's faults on screen, not only in the closed Diagnostics drawer. A stopped sim
 * is a warning (the clock and the gas path are frozen); GPU errors and a failing MOCK raster are
 * cautions; refused commands an advisory. The counts open the drawer, which lists the messages.
 */
export function faultAnnunciations(f: FaultInputs): Annunciation[] {
  const out: Annunciation[] = [];
  if (f.simStopped !== null)
    out.push({
      id: 'simStopped',
      level: 'warning',
      text: 'SIM STOPPED',
      detail: `${f.simStopped}: the clock and the gas path are frozen until a reload`,
    });
  if (f.gpuErrors > 0)
    out.push({
      id: 'gpuErrors',
      level: 'caution',
      text: `GPU ERRORS (${f.gpuErrors})`,
      detail: 'the messages are in Diagnostics',
    });
  if (f.raster?.onFrame === true)
    out.push({
      id: 'raster',
      level: 'caution',
      text: 'MOCK RASTER ON FRAME',
      detail: f.raster.lastError ?? 'the MOCK raster worker failed: rasterizing on the frame',
    });
  else if (f.raster != null && f.raster.lastError !== null)
    out.push({
      id: 'raster',
      level: 'caution',
      text: 'MOCK RASTER FAILED',
      detail: f.raster.lastError,
    });
  if (f.refused > 0)
    out.push({
      id: 'refused',
      level: 'advisory',
      text: `REFUSED (${f.refused})`,
      detail: 'commands the sim refused: the reasons are in Diagnostics',
    });
  return out;
}

/** W2V-I6 in the shell: a MOCK drawn instead of the solver asked for is annunciated, with why. */
export function fieldFallbackAnnunciation(link: FieldLinkView | null): Annunciation | null {
  if (link === null || link.fallback === null) return null;
  return {
    id: 'fieldFallback',
    level: 'caution',
    text: `MOCK FALLBACK: ${link.fallback}`,
    detail: provenanceLabel('mock', link.fallback),
  };
}
