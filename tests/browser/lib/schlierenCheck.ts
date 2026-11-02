// W2A-I6 (D4-91 item 2): what makes a frame the knife-edge Schlieren view, in place of the lit
// centre the true view does not have (src/render/post.ts: the grey 0.5 + eps / (2 a/f), clamped;
// the engine box drawn as the beauty x 0.22):
// - the field round the engine is the neutral grey: a large share of the free area's pixels
//   outside the engine lies near 0.5;
// - the engine is a dim silhouette: the middle of its screen box is under half the field's grey;
// - the jet behind the nozzle is in light and dark bands: its luminance spread is large.
// A Realistic or an Exploded frame (a lit engine), a Schlieren whose knife edge composites
// nothing (a bandless jet) or a studio background fails it. Pure, on a luminance image.
// W2A-I10 (D4-97 item 3): computed on the canvas alone (a label over the jet passes for bands),
// and each bar has its own failing control: S1 (the knife edge off) the jet bar, the cut views
// (the studio round a near-field plane) the grey share, a lit engine the silhouette.

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The bars, stated before the run (W2A-I6; display-space luminance 0..1). */
export const SCHLIEREN_BARS = {
  /**
   * The knife-edge grey band: 0.5 at zero deflection. W2A-N30 (critic pass 18): it was +-0.1 (for
   * the JPEG and the faint far field), which held the studio's own grey (about 0.47), so the grey
   * share measured how much studio showed. Since W2A-I10 the signature is on the canvas PNG, and on
   * HEAD (310c301, the polish round's TDD run on AC, 2026-11-01, both sizes) Schlieren had 0.914-0.917 of
   * its field within +-0.01 and 0.904-0.907 within +-0.005 (the 8-bit neutral, 127-128 of 255),
   * the studio-backed controls 0.01-0.29 within +-0.01 (0.08-0.11 the cut views). Stated before the
   * run that gates it: +-0.01, two 8-bit levels either side of the neutral.
   */
  greyMin: 0.49,
  greyMax: 0.51,
  /**
   * At least this share of the free area outside the engine is that grey. W2A-I10: midway
   * between Schlieren on the canvas (0.84-0.90) and its controls (<= 0.55, the studio's grey then
   * in the band). Unchanged by W2A-N30's band: Schlieren 0.91-0.92, the controls <= 0.29.
   */
  greyShareMin: 0.7,
  /** The silhouette's mean over the field's grey mean (0.22 x the beauty by design). */
  silhouetteRatioMax: 0.5,
  /** The jet's luminance spread (bands of +-1000 urad span most of 0..1). */
  jetStdMin: 0.08,
} as const;

export interface SchlierenSignature {
  readonly greyShare: number;
  readonly greyMean: number;
  readonly silhouetteRatio: number;
  readonly jetStd: number;
  readonly pass: boolean;
}

/** W2A-I10: the bars a signature fails ('grey' share, 'silhouette', 'jet'), in that order. */
export function failedBars(s: SchlierenSignature): ('grey' | 'silhouette' | 'jet')[] {
  const B = SCHLIEREN_BARS;
  const out: ('grey' | 'silhouette' | 'jet')[] = [];
  if (!(s.greyShare >= B.greyShareMin)) out.push('grey');
  if (!(s.silhouetteRatio <= B.silhouetteRatioMax)) out.push('silhouette');
  if (!(s.jetStd >= B.jetStdMin)) out.push('jet');
  return out;
}

/**
 * W2A-N30: the share of the free area outside the engine's box whose luminance lies in [lo, hi]
 * (the signature's grey share, with its own band).
 */
export function greyShare(
  lum: Float32Array,
  w: number,
  h: number,
  engine: Box,
  free: Box,
  lo: number,
  hi: number,
): number {
  const x0 = Math.max(0, Math.floor(free.x));
  const y0 = Math.max(0, Math.floor(free.y));
  const x1 = Math.min(w, free.x + free.w);
  const y1 = Math.min(h, free.y + free.h);
  let n = 0;
  let k = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (x >= engine.x && x < engine.x + engine.w && y >= engine.y && y < engine.y + engine.h)
        continue;
      n++;
      const l = lum[y * w + x] ?? 0;
      if (l >= lo && l <= hi) k++;
    }
  return n === 0 ? 0 : k / n;
}

/**
 * `lum` is the frame's luminance, row-major, w x h (CSS px); `engine` the engine's screen box
 * (the snapshot's engineBox), `free` the view between the panels (the overlay's centre column).
 */
export function schlierenSignature(
  lum: Float32Array,
  w: number,
  h: number,
  engine: Box,
  free: Box,
): SchlierenSignature {
  const B = SCHLIEREN_BARS;
  const at = (x: number, y: number) => lum[Math.floor(y) * w + Math.floor(x)] ?? 0;
  const clampBox = (b: Box): Box => {
    const x0 = Math.max(0, b.x);
    const y0 = Math.max(0, b.y);
    const x1 = Math.min(w, b.x + b.w);
    const y1 = Math.min(h, b.y + b.h);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  const inside = (b: Box, x: number, y: number) =>
    x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  // the field: the free area outside the engine's box
  const f = clampBox(free);
  let n = 0;
  let grey = 0;
  let greySum = 0;
  for (let y = f.y; y < f.y + f.h; y++)
    for (let x = f.x; x < f.x + f.w; x++) {
      if (inside(engine, x, y)) continue;
      n++;
      const l = at(x, y);
      if (l >= B.greyMin && l <= B.greyMax) {
        grey++;
        greySum += l;
      }
    }
  const greyShare = n === 0 ? 0 : grey / n;
  const greyMean = grey === 0 ? 0 : greySum / grey;
  // the silhouette: the middle half of the engine's box
  const s = clampBox({
    x: engine.x + engine.w / 4,
    y: engine.y + engine.h / 4,
    w: engine.w / 2,
    h: engine.h / 2,
  });
  let sn = 0;
  let ss = 0;
  for (let y = s.y; y < s.y + s.h; y++)
    for (let x = s.x; x < s.x + s.w; x++) {
      sn++;
      ss += at(x, y);
    }
  const silhouetteRatio = sn === 0 || greyMean === 0 ? Infinity : ss / sn / greyMean;
  // the jet: behind the box (the nozzle at its right), the middle 40 % of its height
  const j = clampBox({
    x: engine.x + engine.w,
    y: engine.y + 0.3 * engine.h,
    w: Math.min(0.25 * free.w, free.x + free.w - (engine.x + engine.w)),
    h: 0.4 * engine.h,
  });
  let jn = 0;
  let js = 0;
  let js2 = 0;
  for (let y = j.y; y < j.y + j.h; y++)
    for (let x = j.x; x < j.x + j.w; x++) {
      const l = at(x, y);
      jn++;
      js += l;
      js2 += l * l;
    }
  const jm = jn === 0 ? 0 : js / jn;
  const jetStd = jn === 0 ? 0 : Math.sqrt(Math.max(0, js2 / jn - jm * jm));
  return {
    greyShare,
    greyMean,
    silhouetteRatio,
    jetStd,
    pass: failedBars({ greyShare, greyMean, silhouetteRatio, jetStd, pass: false }).length === 0,
  };
}
