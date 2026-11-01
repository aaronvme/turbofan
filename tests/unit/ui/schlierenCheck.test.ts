// W2A-I6 (D4-91 item 2): the Schlieren view's own content check, on synthetic frames. The knife-
// edge view is a neutral grey field, the engine a dim silhouette, and the jet behind the nozzle in
// light and dark bands; a lit engine (Realistic, Exploded) or a jet without bands (the knife edge
// off, a zero gradient) fails it.
// W2A-I10 (D4-97 item 3): each of the three bars has its own failing control, and the controls
// are drawn at the studio's measured grey (about 0.47, inside the knife-edge band): the knife edge
// off (S1) fails the jet bar, a cut view (Cutaway, Data: the studio round a coloured near-field
// plane) the grey-share bar, a lit engine (Realistic, Exploded) the silhouette bar. A label in the
// jet box gives a bandless jet the spread of a banded one, so the browser computes the signature
// on the canvas alone, never on the page with its overlay.
import { describe, expect, it } from 'vitest';
import { failedBars, schlierenSignature, SCHLIEREN_BARS } from '../../browser/lib/schlierenCheck';

const W = 400;
const H = 200;
const engine = { x: 60, y: 50, w: 180, h: 100 };
const free = { x: 20, y: 10, w: 360, h: 180 };
/** The studio's cyclorama in the app's frames (display luminance, the 1920 Realistic shot). */
const STUDIO = 0.47;

function frame(f: (x: number, y: number) => number): Float32Array {
  const l = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) l[y * W + x] = f(x, y);
  return l;
}
const inEngine = (x: number, y: number) =>
  x >= engine.x && x < engine.x + engine.w && y >= engine.y && y < engine.y + engine.h;
const inJet = (x: number, y: number) => x >= 240 && x < 330 && y >= 80 && y < 120;
const bands = (x: number) => (Math.floor(x / 6) % 2 === 0 ? 0.9 : 0.1);
/** The field outside the engine: the studio's grey on a third of it, the rest off the band. */
const studioField = (x: number, y: number) => ((x + 2 * y) % 30 < 10 ? STUDIO : 0.22 + y / 1000);
/** A near-field plane's colours (a cut view): off the grey band, varying across the jet. */
const plane = (x: number, y: number) => 0.15 + 0.7 * (((x * 7 + y * 3) % 50) / 50 > 0.5 ? 1 : 0);
const sig = (f: (x: number, y: number) => number) =>
  schlierenSignature(frame(f), W, H, engine, free);

describe('the Schlieren signature (W2A-I6, W2A-I10)', () => {
  it('passes the knife-edge view: grey field, dim silhouette, banded jet', () => {
    const s = sig((x, y) => (inEngine(x, y) ? 0.08 : inJet(x, y) ? bands(x) : 0.5));
    expect(s.pass, JSON.stringify(s)).toBe(true);
    expect(failedBars(s)).toEqual([]);
  });

  it('S1, the knife edge off (a bandless jet): fails the jet bar, and only it', () => {
    const s = sig((x, y) => (inEngine(x, y) ? 0.08 : 0.5));
    expect(s.pass).toBe(false);
    expect(failedBars(s)).toEqual(['jet']);
  });

  it('a cut view (the studio round a coloured plane, a lit cut face): fails the grey-share bar', () => {
    // a third of the field at the studio's grey: round 5's old bar (0.3) passed it
    const s = sig((x, y) =>
      inEngine(x, y) ? 0.2 : inJet(x, y) || (x + y) % 3 !== 0 ? plane(x, y) : STUDIO,
    );
    expect(s.greyShare).toBeGreaterThan(0.3);
    expect(s.pass, JSON.stringify(s)).toBe(false);
    expect(failedBars(s)).toEqual(['grey']);
  });

  it('a lit engine (Realistic, Exploded) on the studio: fails the silhouette bar', () => {
    const s = sig((x, y) => (inEngine(x, y) ? 0.6 : inJet(x, y) ? bands(x) : studioField(x, y)));
    expect(s.pass).toBe(false);
    expect(failedBars(s)).toContain('silhouette');
    // and a lit engine on the knife-edge grey: the silhouette bar alone
    const g = sig((x, y) => (inEngine(x, y) ? 0.6 : inJet(x, y) ? bands(x) : 0.5));
    expect(failedBars(g)).toEqual(['silhouette']);
  });

  it('a field that is not the neutral grey (a dark studio background) fails the grey-share bar', () => {
    const s = sig((x, y) => (inEngine(x, y) ? 0.02 : inJet(x, y) ? bands(x) : 0.12 + y / 2000));
    // (with no grey pixel there is no grey to measure the silhouette against either)
    expect(failedBars(s)).toEqual(['grey', 'silhouette']);
  });

  it('a label in the jet box (a dark box with light text) gives S1 a banded jet: so the signature is computed on the canvas alone', () => {
    const label = (x: number, y: number) =>
      x >= 250 && x < 320 && y >= 84 && y < 116 ? ((x + y) % 4 < 1 ? 0.95 : 0.08) : null;
    const s = sig((x, y) => (inEngine(x, y) ? 0.08 : (label(x, y) ?? 0.5)));
    expect(s.jetStd).toBeGreaterThanOrEqual(SCHLIEREN_BARS.jetStdMin);
    expect(s.pass).toBe(true);
  });

  it('states its bars: the grey share midway between Schlieren on the canvas (0.84-0.90 in Chrome) and the controls (<= 0.55)', () => {
    expect(SCHLIEREN_BARS).toEqual({
      greyMin: 0.4,
      greyMax: 0.6,
      greyShareMin: 0.7,
      silhouetteRatioMax: 0.5,
      jetStdMin: 0.08,
    });
  });
});
