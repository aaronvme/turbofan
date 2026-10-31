// W2A-I6 (D4-91 item 2): the Schlieren view's own content check, on synthetic frames. The knife-
// edge view is a neutral grey field, the engine a dim silhouette, and the jet behind the nozzle in
// light and dark bands; a lit engine (Realistic, Exploded) or a jet without bands (the knife edge
// off, a zero gradient) fails it.
import { describe, expect, it } from 'vitest';
import { schlierenSignature, SCHLIEREN_BARS } from '../../browser/lib/schlierenCheck';

const W = 400;
const H = 200;
const engine = { x: 60, y: 50, w: 180, h: 100 };
const free = { x: 20, y: 10, w: 360, h: 180 };

function frame(f: (x: number, y: number) => number): Float32Array {
  const l = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) l[y * W + x] = f(x, y);
  return l;
}
const inEngine = (x: number, y: number) =>
  x >= engine.x && x < engine.x + engine.w && y >= engine.y && y < engine.y + engine.h;
const inJet = (x: number, y: number) => x >= 240 && x < 330 && y >= 80 && y < 120;
const bands = (x: number) => (Math.floor(x / 6) % 2 === 0 ? 0.9 : 0.1);

describe('the Schlieren signature (W2A-I6)', () => {
  it('passes the knife-edge view: grey field, dim silhouette, banded jet', () => {
    const l = frame((x, y) => (inEngine(x, y) ? 0.08 : inJet(x, y) ? bands(x) : 0.5));
    const s = schlierenSignature(l, W, H, engine, free);
    expect(s.pass, JSON.stringify(s)).toBe(true);
  });

  it('fails a lit engine (Realistic, Exploded) on the same grey', () => {
    const l = frame((x, y) => (inEngine(x, y) ? 0.6 : inJet(x, y) ? bands(x) : 0.5));
    expect(schlierenSignature(l, W, H, engine, free).pass).toBe(false);
  });

  it('fails a jet without bands (the knife edge off, a zero gradient)', () => {
    const l = frame((x, y) => (inEngine(x, y) ? 0.08 : 0.5));
    expect(schlierenSignature(l, W, H, engine, free).pass).toBe(false);
  });

  it('fails a field that is not the neutral grey (a studio background)', () => {
    const l = frame((x, y) => (inEngine(x, y) ? 0.02 : inJet(x, y) ? bands(x) : 0.12 + y / 2000));
    expect(schlierenSignature(l, W, H, engine, free).pass).toBe(false);
  });

  it('states its bars', () => {
    expect(SCHLIEREN_BARS).toEqual({
      greyMin: 0.4,
      greyMax: 0.6,
      greyShareMin: 0.3,
      silhouetteRatioMax: 0.5,
      jetStdMin: 0.08,
    });
  });
});
