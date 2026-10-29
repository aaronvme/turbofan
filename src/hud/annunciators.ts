// What the overlay annunciates, from the snapshot alone: the gas-path solve (D4-13/D4-17: a held
// solve is a fault indication, with its count and, W2F-I1, its cause), the cycle flags, the flow
// solver's run status and the data provenance. Pure, so the tests pin every message.

import type { CycleState } from '../contracts/cycle';
import type { FlowStatus, SnapshotSources } from '../contracts/sim';

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

export function flowAnnunciation(flow: FlowStatus): Annunciation {
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

/** The provenance badges: every mock part is named (W0C-I3). */
export function provenanceBadges(s: SnapshotSources): Annunciation[] {
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
  const flow: Annunciation =
    s.flow === 'solver'
      ? { id: 'field', level: 'normal', text: 'FIELD: SOLVER', detail: 'the live GPU solver' }
      : s.flow === 'mock'
        ? {
            id: 'field',
            level: 'caution',
            text: 'FIELD: MOCK',
            detail: 'a synthetic field scaled by the cycle state, not the solver',
          }
        : { id: 'field', level: 'advisory', text: 'FIELD: NONE', detail: 'no flow field bound' };
  return [cycle, flow];
}
