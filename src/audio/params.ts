// The engine sound's parameter frame: what the main thread posts to the AudioWorklet at the
// snapshot rate (plain, structured-clone-safe data), and the voice table it indexes. The table
// comes from the EngineDefinition's blade rows (D5-4: counts and their confidence from the
// definition), so the synth itself knows nothing about the engine.

import type { Confidence, EngineDefinition, Spool } from '../contracts/engine';
import { factValue } from '../engine/facts';

export const VOICE_GROUPS = [
  'fan',
  'buzzSaw',
  'booster',
  'hpc',
  'lpt',
  'starter',
  'jet',
  'fanBroadband',
  'rumble',
  'igniter',
  'surge',
] as const;
export type VoiceGroup = (typeof VOICE_GROUPS)[number];

/** A tone voice: order x its spool's shaft frequency N / 60. */
export interface ToneVoice {
  readonly id: string;
  readonly group: VoiceGroup;
  readonly spool: Spool;
  /** Blade count x harmonic (blade-pass tones), the engine order (buzz-saw), or the starter's. */
  readonly order: number;
  readonly harmonic: number;
  /** The blade row a blade-pass tone comes from, with its count's confidence; null otherwise. */
  readonly row: {
    readonly id: string;
    readonly count: number;
    readonly confidence: Confidence;
  } | null;
}

export interface NoiseVoice {
  readonly id: string;
  readonly group: VoiceGroup;
}

/** The broadband voices, in frame order: each jet stream's large- and fine-scale mixing noise. */
export const NOISE_VOICES: readonly NoiseVoice[] = [
  { id: 'jet-core-large', group: 'jet' },
  { id: 'jet-core-fine', group: 'jet' },
  { id: 'jet-bypass-large', group: 'jet' },
  { id: 'jet-bypass-fine', group: 'jet' },
  { id: 'fan-broadband', group: 'fanBroadband' },
  { id: 'rumble', group: 'rumble' },
];

/** The fan's blade-pass tone and harmonics voiced (BPF x 1 .. 4). */
export const FAN_HARMONICS = 4;
/** The starter whine's harmonics of its turbine's shaft frequency. */
export const STARTER_HARMONICS = 4;

function row(def: EngineDefinition, id: string) {
  const r = def.bladeRows.find((b) => b.id === id);
  if (r === undefined) throw new Error(`the definition has no blade row ${id}`);
  return r;
}

const blade = (def: EngineDefinition, id: string, group: VoiceGroup, harmonic = 1): ToneVoice => {
  const r = row(def, id);
  if (r.spool === 'none') throw new Error(`blade row ${id} does not rotate`);
  return {
    id: group === 'fan' ? `fan-h${harmonic}` : id,
    group,
    spool: r.spool,
    order: r.count * harmonic,
    harmonic,
    row: { id: r.id, count: r.count, confidence: r.countConfidence },
  };
};

/**
 * The tone voices, in frame order: the fan's blade-pass tone and its harmonics, the buzz-saw
 * engine orders 1 .. B_fan - 1 (A2), the booster's first rotor, the HPC's first three rotors
 * (the whine the inlet radiates), the LPT's last rotor (aft), and the starter (A5).
 */
export function toneVoices(def: EngineDefinition): readonly ToneVoice[] {
  const fan = row(def, 'fan');
  const out: ToneVoice[] = [];
  for (let h = 1; h <= FAN_HARMONICS; h++) out.push(blade(def, 'fan', 'fan', h));
  for (let k = 1; k < fan.count; k++)
    out.push({ id: `eo-${k}`, group: 'buzzSaw', spool: 'lp', order: k, harmonic: 1, row: null });
  out.push(blade(def, 'booster-r1', 'booster'));
  for (const id of ['hpc-r1', 'hpc-r2', 'hpc-r3']) out.push(blade(def, id, 'hpc'));
  const lpt = def.bladeRows.filter((r) => r.component === 'lpt' && r.kind === 'rotor');
  const last = lpt[lpt.length - 1];
  if (last === undefined) throw new Error('the definition has no LPT rotor');
  out.push(blade(def, last.id, 'lpt'));
  const ratio = factValue('starterSpeedRatio');
  for (let h = 1; h <= STARTER_HARMONICS; h++)
    out.push({
      id: `starter-h${h}`,
      group: 'starter',
      spool: 'hp',
      order: ratio * h,
      harmonic: h,
      row: null,
    });
  return out;
}

export function toneFrequencyHz(t: ToneVoice, n1Rpm: number, n2Rpm: number): number {
  return (t.order * (t.spool === 'lp' ? n1Rpm : n2Rpm)) / 60;
}

/** One posting to the synth. Amplitudes are linear (tones: peak; noise: RMS). */
export interface SoundFrame {
  readonly toneHz: readonly number[];
  readonly toneAmp: readonly number[];
  /** Noise voices: band centre, Q and RMS amplitude. */
  readonly noiseHz: readonly number[];
  readonly noiseQ: readonly number[];
  readonly noiseAmp: readonly number[];
  readonly ignitersOn: boolean;
  readonly sparkRateHz: number;
  /** A spark's peak, in output units (not scaled by master). */
  readonly sparkAmp: number;
  /** Modelled surge cycles since the reset (A5: one bang each). */
  readonly surgeCycles: number;
  /** A bang's peak, in output units (not scaled by master). */
  readonly bangAmp: number;
  /** Multiplies the tones and the noise: the listener's level map. */
  readonly master: number;
}

export function silentFrame(toneCount: number, noiseCount: number): SoundFrame {
  return {
    toneHz: new Array<number>(toneCount).fill(0),
    toneAmp: new Array<number>(toneCount).fill(0),
    noiseHz: new Array<number>(noiseCount).fill(100),
    noiseQ: new Array<number>(noiseCount).fill(1),
    noiseAmp: new Array<number>(noiseCount).fill(0),
    ignitersOn: false,
    sparkRateHz: 0,
    sparkAmp: 0,
    surgeCycles: 0,
    bangAmp: 0,
    master: 0,
  };
}

/** The frame with only the given groups sounding (the offline checks render a voice alone). */
export function maskFrame(
  f: SoundFrame,
  tones: readonly ToneVoice[],
  keep: readonly VoiceGroup[],
): SoundFrame {
  const k = new Set(keep);
  return {
    ...f,
    toneAmp: f.toneAmp.map((a, i) => (k.has(tones[i]?.group ?? 'fan') ? a : 0)),
    noiseAmp: f.noiseAmp.map((a, i) => (k.has(NOISE_VOICES[i]?.group ?? 'jet') ? a : 0)),
    sparkAmp: k.has('igniter') ? f.sparkAmp : 0,
    bangAmp: k.has('surge') ? f.bangAmp : 0,
  };
}

/** Problems with a frame (lengths, finite and non-negative numbers); [] when it is fine. */
export function validateFrame(f: SoundFrame, toneCount: number, noiseCount: number): string[] {
  const p: string[] = [];
  const lists = [
    ['toneHz', f.toneHz, toneCount],
    ['toneAmp', f.toneAmp, toneCount],
    ['noiseHz', f.noiseHz, noiseCount],
    ['noiseQ', f.noiseQ, noiseCount],
    ['noiseAmp', f.noiseAmp, noiseCount],
  ] as const;
  for (const [name, xs, n] of lists) {
    if (xs.length !== n) p.push(`${name} has ${xs.length} voices, not ${n} (tone/noise count)`);
    xs.forEach((x, i) => {
      if (!(Number.isFinite(x) && x >= 0)) p.push(`${name}[${i}] ${x} must be finite and >= 0`);
    });
  }
  for (const [name, x] of [
    ['sparkRateHz', f.sparkRateHz],
    ['sparkAmp', f.sparkAmp],
    ['surgeCycles', f.surgeCycles],
    ['bangAmp', f.bangAmp],
    ['master', f.master],
  ] as const)
    if (!(Number.isFinite(x) && x >= 0)) p.push(`${name} ${x} must be finite and >= 0`);
  return p;
}
