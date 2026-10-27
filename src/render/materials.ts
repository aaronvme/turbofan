// Look-dev materials (TSL node materials), worker-safe (no textures, no DOM: every pattern
// is procedural and anti-aliased with fwidth). Colours are linear-sRGB reflectances; metal F0
// values follow published measured reflectances (titanium ~0.54/0.50/0.45, nickel
// ~0.66/0.61/0.53, aluminium ~0.91). The look-dev round (LD-2, LD-5, V2-V4) set them per part
// family instead of "everything polished metal":
//
// - Nacelle: white satin paint under a thin clear coat with a faint orange-peel normal,
//   panel joints and fastener rows; the inlet lip is polished (not mirror) aluminium with
//   circumferential brushing.
// - Fan: satin titanium, brushed along the span, a lighter eroded leading edge, a little
//   per-blade variation so the highlights break up.
// - Cases: matte painted/cast grey (metalness <= 0.3). Hot section: dull superalloy with a
//   low-chroma heat tint graded along x from the combustor exit.
// - Spinner: matte dark paint with the white spiral, in the spinner's own frame.
// - Caps: one distinct section colour (signal red-orange, darker for composites and paint),
//   with an anti-aliased 45-degree hatch.
// Every solid of revolution discards the cutaway wedge (maskNode); blades hide whole
// (positionNode), see src/geometry/cutaway.ts, whose logic the TSL here mirrors.

import {
  Color,
  EqualDepth,
  InstancedMesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  type NodeMaterial,
  type UniformNode,
} from 'three/webgpu';
import {
  abs,
  atan,
  attribute,
  cross,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  hash,
  instanceIndex,
  interleavedGradientNoise,
  length,
  max,
  min,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  normalLocal,
  normalView,
  positionLocal,
  positionView,
  positionWorld,
  screenCoordinate,
  select,
  sign,
  transformNormalToView,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import type { BladeCutRule } from '../geometry/cutaway';
import type { PartMaterial } from '../geometry/parts';
import type { RowMaterial } from '../geometry/engineGeometry';

export interface LookUniforms {
  readonly cutCenter: UniformNode<'float', number>;
  readonly cutHalf: UniformNode<'float', number>;
  readonly lpBlur: UniformNode<'float', number>;
  readonly hpBlur: UniformNode<'float', number>;
  /** 0..1: how hot the hot section is drawn (heat tint only, not emission). */
  readonly heat: UniformNode<'float', number>;
  /** Fan time copies a pixel chooses among this frame (1 when the fan is still). */
  readonly fanCopies: UniformNode<'float', number>;
  /** Per-frame offset in [0, 1) of the fan copy each pixel picks (an R2 sequence, the view). */
  readonly fanSeed: UniformNode<'float', number>;
}

/** Time-offset copies of the fan drawn per frame (stochastic blur, src/render/post.ts). */
export const FAN_TIME_SAMPLES = 8;

export function createLookUniforms(): LookUniforms {
  return {
    cutCenter: uniform(0),
    cutHalf: uniform(0),
    lpBlur: uniform(0),
    hpBlur: uniform(0),
    heat: uniform(1),
    fanCopies: uniform(FAN_TIME_SAMPLES),
    fanSeed: uniform(0),
  };
}

type F = Node<'float'>;
const TWO_PI = 2 * Math.PI;
const wrapPi = (a: F): F => a.sub(floor(a.add(Math.PI).div(TWO_PI)).mul(TWO_PI));

/** False inside the cutaway wedge (the engine axis is world +x). */
function outsideWedge(u: LookUniforms): Node<'bool'> {
  const th = atan(positionWorld.z, positionWorld.y);
  const d = abs(wrapPi(th.sub(u.cutCenter)));
  return d.greaterThanEqual(u.cutHalf);
}

const c3 = (r: number, g: number, b: number) => new Color(r, g, b);

interface PhysParams {
  color: Color;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  anisotropy?: number;
}

function phys(p: PhysParams): MeshPhysicalNodeMaterial {
  const m = new MeshPhysicalNodeMaterial({
    color: p.color,
    metalness: p.metalness,
    roughness: p.roughness,
    clearcoat: p.clearcoat ?? 0,
    clearcoatRoughness: p.clearcoatRoughness ?? 0,
  });
  if (p.anisotropy !== undefined) m.anisotropy = p.anisotropy;
  return m;
}

/**
 * A view-space normal bumped by a procedural height field (metres), from screen-space
 * derivatives (Mikkelsen's surface-gradient bump).
 */
function bumpNormal(height: F, scale: number, base: Node<'vec3'> = normalView): Node<'vec3'> {
  return Fn(() => {
    const dpdx = positionView.dFdx();
    const dpdy = positionView.dFdy();
    const n = base;
    const r1 = cross(dpdy, n);
    const r2 = cross(n, dpdx);
    const det = dot(dpdx, r1);
    const dhdx = height.dFdx();
    const dhdy = height.dFdy();
    const grad = r1.mul(dhdx).add(r2.mul(dhdy)).mul(sign(det));
    return normalize(abs(det).mul(n).sub(grad.mul(scale)));
  })();
}

/** 1 where a pattern of period `period` is resolved, 0 where it is finer than a pixel. */
const fade = (footprint: F, period: number): F =>
  float(1).sub(smoothstep(0.25, 0.7, footprint.div(period)));
const resolved = (coord: Node<'vec2'>, period: number): F => fade(length(fwidth(coord)), period);
const resolved1 = (coord: F, period: number): F => fade(fwidth(coord), period);

/**
 * A smooth, low-frequency pattern evaluated per vertex and interpolated (LOD round, D4-5: the
 * opaque pass is bound by its fragment shading, and procedural noise is most of it). Only for
 * periods well above the mesh's vertex spacing (192 segments: under 4 cm round the nacelle).
 */
const perVertex = <T extends Node>(n: T): T => vertexStage(n) as unknown as T;

/**
 * A view-space normal tilted by the gradient of a smooth height field (metres) evaluated per
 * vertex by central differences in the object frame and interpolated, so the tilt is smooth
 * across triangles (a fragment derivative of an interpolated height would facet).
 */
function perVertexTilt(height: (p: Node<'vec3'>) => F, step: number): Node<'vec3'> {
  const p = positionLocal;
  const d = (axis: Node<'vec3'>): F =>
    height(p.add(axis.mul(step)))
      .sub(height(p.sub(axis.mul(step))))
      .div(2 * step);
  const g = vec3(d(vec3(1, 0, 0)), d(vec3(0, 1, 0)), d(vec3(0, 0, 1)));
  const n = normalLocal;
  const tilted = normalize(n.sub(g.sub(n.mul(dot(n, g)))));
  return normalize(transformNormalToView(perVertex(tilted)));
}

/** An anti-aliased line of half-width w at distance d (fwidth of d sets the filter). */
const aaLine = (d: F, w: number): F => {
  const aa = fwidth(d).max(1e-5);
  return float(1).sub(smoothstep(float(w).sub(aa), float(w).add(aa), d));
};

/**
 * Heat tint of the hot section, graded along the engine (x, m): strongest just aft of the
 * combustor (HPT, x ~ 1.75-1.9), fading through the LPT. Low chroma: straw to a grey bronze
 * to a faint blue, over a broad noise, so it reads as oxidised metal, not wood grain.
 */
function heatTint(base: Node<'vec3'>, u: LookUniforms, amount: number): Node<'vec3'> {
  const x = positionLocal.x;
  const z = x.sub(1.82).div(0.32);
  const zone = exp(z.mul(z).negate());
  const n = perVertex(mx_fractal_noise_float(positionLocal.mul(vec3(1.5, 3, 3)), 2, 2, 0.5))
    .mul(0.5)
    .add(0.5);
  const t = zone.mul(0.75).add(n.mul(0.35)).clamp(0, 1);
  // a little more chroma than pass 4 (W1L-N2: the hot section read neutral grey)
  const straw = vec3(1.07, 0.97, 0.8);
  const bronze = vec3(0.95, 0.79, 0.64);
  const blue = vec3(0.78, 0.83, 0.96);
  const ramp = mix(mix(straw, bronze, smoothstep(0.3, 0.6, t)), blue, smoothstep(0.65, 0.95, t));
  const k = u.heat.mul(amount).mul(zone.mul(0.7).add(0.3));
  return base.mul(mix(vec3(1, 1, 1), ramp, k));
}

/**
 * A seam line of half-width w at distance d: anti-aliased, and below a pixel it widens to the
 * pixel at reduced contrast (energy conserving down to 40 %), so distant seams stay faint
 * lines instead of vanishing.
 */
const seamLine = (d: F, w: number): F => {
  const aa = fwidth(d).max(1e-6);
  const width = max(float(w), aa);
  const k = float(2 * w)
    .div(aa.mul(2).max(2 * w))
    .clamp(0.4, 1);
  return float(1)
    .sub(smoothstep(width.sub(aa.mul(0.5)), width.add(aa.mul(0.5)), d))
    .mul(k);
};

/**
 * The nacelle's painted skin (LD-2, lookdev-3 W1L-N1): a CFM56-7-class cowl set, all
 * procedural in the engine frame (x aft, theta from the top toward +z, arc s = theta r):
 * - panels: inlet cowl (from the bare lip at x -0.55 to the fan-case flange at -0.06), the
 *   fan cowl doors left and right (to 0.45), the thrust-reverser sleeves left and right (to the
 *   nozzle); each panel a slightly different white and gloss, as separately painted panels are;
 * - seams: 3 mm gaps as shallow grooves (a bevel up close, a dark line far away that stays at
 *   least a faint line instead of vanishing), the doors' hinge lines either side of the top
 *   and their latch line at the bottom, three flush latches on the fan cowl and two on the
 *   reverser, an oil-service access door and a pressure-relief door on the camera side,
 *   fastener rows aft of the circumferential joints;
 * - surface: a two-scale orange peel and a faint skin waviness between frames ("oil canning")
 *   so the long strip highlights wobble slightly, wipe streaks and lower-skin handling marks
 *   in the roughness.
 * Feature positions are a plausible layout, not engine data.
 */
function nacellePaint(): MeshPhysicalNodeMaterial {
  const p = positionLocal;
  const x = p.x;
  const th = atan(p.z, p.y);
  const r = length(p.yz);
  const m = phys({ color: c3(0.78, 0.785, 0.79), metalness: 0, roughness: 0.27 });
  const arcTo = (t0: number): F => abs(wrapPi(th.sub(t0))).mul(r);
  const within = (x0: number, x1: number): F =>
    smoothstep(x0 - 0.002, x0, x).mul(smoothstep(x1 + 0.002, x1, x));
  // a rounded rectangle's outline at (x, theta) centre, half sizes in metres
  const rectOutline = (cx: number, ct: number, hx: number, hs: number, rr: number, w: number) => {
    const q = vec2(abs(x.sub(cx)), abs(wrapPi(th.sub(ct))).mul(r));
    const e = q.sub(vec2(hx - rr, hs - rr));
    const d = length(max(e, vec2(0, 0)))
      .add(min(max(e.x, e.y), 0))
      .sub(rr);
    return seamLine(abs(d), w);
  };
  const J = [-0.55, -0.06, 0.45] as const;
  const joints = max(
    max(seamLine(abs(x.sub(J[0])), 0.0012), seamLine(abs(x.sub(J[1])), 0.0016)),
    seamLine(abs(x.sub(J[2])), 0.002),
  );
  const fanCowl = within(J[1], J[2]);
  const reverser = within(J[2], 1.6);
  const longi = max(
    max(seamLine(arcTo(0.16), 0.0014), seamLine(arcTo(-0.16), 0.0014)).mul(fanCowl),
    max(
      max(seamLine(arcTo(0.12), 0.0016), seamLine(arcTo(-0.12), 0.0016)),
      seamLine(arcTo(Math.PI), 0.0016),
    ).mul(max(fanCowl, reverser)),
  );
  const latches = max(
    max(
      max(
        rectOutline(0.04, Math.PI, 0.065, 0.024, 0.006, 0.001),
        rectOutline(0.2, Math.PI, 0.065, 0.024, 0.006, 0.001),
      ),
      rectOutline(0.36, Math.PI, 0.065, 0.024, 0.006, 0.001),
    ),
    max(
      rectOutline(0.75, Math.PI, 0.055, 0.022, 0.006, 0.001),
      rectOutline(1.15, Math.PI, 0.055, 0.022, 0.006, 0.001),
    ),
  );
  const doors = max(
    max(
      rectOutline(0.2, 1.32, 0.12, 0.1, 0.022, 0.0012),
      rectOutline(0.3, 1.32, 0.018, 0.03, 0.004, 0.0008),
    ),
    rectOutline(0.95, 1.92, 0.085, 0.065, 0.012, 0.0012),
  );
  // flush fasteners 15 mm aft of each circumferential joint, 45 mm apart
  const rowX = min(
    min(abs(x.sub(J[0] + 0.015)), abs(x.sub(J[1] + 0.015))),
    abs(x.sub(J[2] + 0.015)),
  );
  const along = fract(th.mul(r).div(0.045)).sub(0.5).abs().mul(0.045);
  const rivet = aaLine(length(vec2(rowX, along)), 0.0017).mul(resolved(vec2(x, th.mul(r)), 0.045));
  const seam = max(max(max(joints, longi), max(latches, doors)), rivet.mul(0.6));
  // panel-to-panel tone and gloss
  const right = smoothstep(-0.02, 0.02, th);
  const tone = select(
    x.lessThan(J[1]),
    float(0),
    select(
      x.lessThan(J[2]),
      mix(float(0.007), float(-0.005), right),
      mix(float(-0.009), float(0.004), right),
    ),
  );
  const gloss = select(
    x.lessThan(J[1]),
    float(0),
    select(
      x.lessThan(J[2]),
      mix(float(-0.015), float(0.012), right),
      mix(float(0.025), float(0.018), right),
    ),
  );
  // surface: oil canning (per vertex: a 0.4 m wobble), seam grooves 0.6 mm deep (up close).
  // The orange peel (1.2e-5 / 2.5e-5 m bumps) is gone: no shot resolved it (pass 6), and its
  // two noise lookups per pixel were a large part of the opaque pass (LOD round, D4-5)
  const canning = perVertexTilt(
    (q) => mx_noise_float(vec3(q.x.mul(2.2), q.y.mul(2.8), q.z.mul(2.8))).mul(6e-4),
    0.02,
  );
  const grooveDepth = seam.mul(-6e-4).mul(resolved1(x, 0.02));
  m.normalNode = bumpNormal(grooveDepth, 1, canning);
  const broad = perVertex(mx_fractal_noise_float(p.mul(2.2), 2, 2, 0.5));
  const wipe = mx_noise_float(vec3(x.mul(1.6), p.y.mul(16), p.z.mul(16)));
  const low = smoothstep(-0.35, -0.85, p.y);
  const white = vec3(0.78, 0.785, 0.79);
  m.colorNode = white
    .mul(float(1).add(tone).add(broad.mul(0.012)).sub(low.mul(0.025)))
    .mul(float(1).sub(seam.mul(0.55)));
  m.roughnessNode = float(0.27)
    .add(gloss)
    .add(broad.mul(0.05))
    .add(wipe.mul(0.035))
    .add(low.mul(0.05))
    .add(seam.mul(0.3));
  return m;
}

function partMaterial(kind: PartMaterial, u: LookUniforms): NodeMaterial {
  let m: MeshPhysicalNodeMaterial;
  const x = positionLocal.x;
  const th = atan(positionLocal.z, positionLocal.y);
  const r = length(positionLocal.yz);
  switch (kind) {
    case 'nacellePaint':
      m = nacellePaint();
      break;
    case 'inletLip': {
      // The bare anti-ice lip is a band about the leading edge only (lookdev-3: the whole
      // solid lip ahead of the bulkhead read as a fat chrome torus); aft of it the inlet cowl
      // is painted outside and the barrel a light grey inside, with a seam at the edge. The
      // metal is satin aluminium, not a mirror: rougher than polished, a fine circumferential
      // buffing grain in the roughness, a light anisotropy along it.
      const pl = positionLocal;
      const lx = pl.x;
      const outer = length(pl.yz).greaterThan(0.8);
      const edge = select(outer, float(-0.695), float(-0.665));
      const metal = smoothstep(edge.add(0.001), edge.sub(0.001), lx);
      const seam = seamLine(abs(lx.sub(edge)), 0.0012);
      const buff = mx_noise_float(vec3(lx.mul(180), pl.y.mul(6), pl.z.mul(6)));
      const broad = perVertex(mx_fractal_noise_float(pl.mul(3), 2, 2, 0.5));
      const al = vec3(0.8, 0.805, 0.81).mul(float(1).add(broad.mul(0.025)));
      const paint = select(outer, vec3(0.78, 0.785, 0.79), vec3(0.6, 0.605, 0.61)).mul(
        float(1).add(broad.mul(0.012)),
      );
      // no anisotropy (LOD round, D4-5): the lip solid includes the whole inner barrel, which
      // fills much of the front view, and the anisotropic lobe was ~1 ms of the opaque pass
      // for a 0.3 stretch the buffing grain in the roughness already carries
      m = phys({ color: c3(0.8, 0.805, 0.81), metalness: 1, roughness: 0.34 });
      m.colorNode = mix(paint, al, metal).mul(float(1).sub(seam.mul(0.5)));
      m.metalnessNode = metal;
      m.roughnessNode = mix(
        float(0.28).add(broad.mul(0.05)),
        float(0.34)
          .add(buff.mul(0.035).mul(resolved1(lx, 1 / 180)))
          .add(broad.mul(0.04)),
        metal,
      ).add(seam.mul(0.3));
      break;
    }
    case 'acousticLiner': {
      // a grey painted face sheet (W1L-N2: at 0.2 the cutaway's shadowed panels read as holes)
      m = phys({ color: c3(0.27, 0.275, 0.28), metalness: 0.15, roughness: 0.72 });
      // perforated face sheet: 1.5 mm holes on a 5 mm grid, faded where sub-pixel (V3)
      const g = vec2(x, th.mul(r)).div(0.005);
      const hole = float(1).sub(smoothstep(0.12, 0.2, length(fract(g).sub(0.5))));
      const k = resolved(g, 1);
      m.colorNode = vec3(0.27, 0.275, 0.28).mul(
        float(1).sub(hole.mul(0.6).mul(k)).sub(float(1).sub(k).mul(0.1)),
      );
      break;
    }
    case 'fanCase':
      // painted aluminium containment case: a dark grey satin
      // (0.2, not 0.11: in the cutaway's shadow the darker case read as a hole, W1L-N2)
      m = phys({ color: c3(0.2, 0.205, 0.2), metalness: 0.2, roughness: 0.55 });
      m.colorNode = vec3(0.2, 0.205, 0.2).add(
        perVertex(mx_fractal_noise_float(positionLocal.mul(3), 2, 2, 0.5)).mul(0.012),
      );
      break;
    case 'splitter':
      m = phys({ color: c3(0.7, 0.7, 0.7), metalness: 1, roughness: 0.3, anisotropy: 0.4 });
      m.anisotropyNode = vec2(0.4, 0);
      break;
    case 'cowlPaint':
      m = phys({ color: c3(0.34, 0.35, 0.36), metalness: 0, roughness: 0.45 });
      {
        // exhaust staining toward the core nozzle
        const stain = smoothstep(1.9, 2.6, x).mul(
          perVertex(mx_fractal_noise_float(positionLocal.mul(vec3(2, 6, 6)), 2, 2, 0.5))
            .mul(0.25)
            .add(0.75),
        );
        m.colorNode = mix(vec3(0.34, 0.35, 0.36), vec3(0.16, 0.15, 0.14), stain.mul(0.55));
        m.roughnessNode = float(0.45).add(stain.mul(0.15));
      }
      break;
    case 'compressorCase':
      m = phys({ color: c3(0.3, 0.3, 0.29), metalness: 0.3, roughness: 0.6 });
      m.roughnessNode = float(0.6).add(mx_noise_float(positionLocal.mul(12)).mul(0.05));
      break;
    case 'combustorCase':
    case 'turbineCase': {
      const base = kind === 'combustorCase' ? vec3(0.46, 0.44, 0.41) : vec3(0.44, 0.42, 0.39);
      m = phys({ color: c3(0.45, 0.43, 0.4), metalness: 0.8, roughness: 0.52 });
      m.colorNode = heatTint(base, u, 0.9);
      m.roughnessNode = float(0.52).add(mx_noise_float(positionLocal.mul(9)).mul(0.06));
      break;
    }
    case 'combustorLiner': {
      // thermal-barrier-coated liner: a pale ceramic, scorched toward the exit
      m = phys({ color: c3(0.62, 0.58, 0.52), metalness: 0, roughness: 0.7 });
      const burn = smoothstep(1.55, 1.74, x).mul(u.heat);
      m.colorNode = mix(vec3(0.62, 0.58, 0.52), vec3(0.36, 0.3, 0.26), burn.mul(0.7));
      break;
    }
    case 'exhaust':
    case 'plug': {
      const base = kind === 'plug' ? vec3(0.4, 0.39, 0.37) : vec3(0.44, 0.43, 0.41);
      m = phys({ color: c3(0.42, 0.41, 0.39), metalness: 0.75, roughness: 0.5 });
      const soot = perVertex(mx_fractal_noise_float(positionLocal.mul(vec3(2.5, 9, 9)), 3, 2, 0.5))
        .mul(0.5)
        .add(0.5);
      m.colorNode = heatTint(base, u, 0.5).mul(float(1).sub(soot.mul(0.12)));
      m.roughnessNode = mix(float(0.42), float(0.62), soot);
      break;
    }
    case 'spinner': {
      // matte enough that it no longer mirrors the softboxes as dark chrome (W1L-N1)
      m = phys({ color: c3(0.04, 0.041, 0.043), metalness: 0, roughness: 0.52 });
      m.colorNode = spinnerSpiral();
      // the spinner turns with the fan and is drawn (and blurred) in the rotor pass
      m.mrtNode = mrt({ blur: vec4(u.lpBlur, TWO_PI, 0, 1) });
      break;
    }
    case 'drum':
    case 'disk':
      m = phys({ color: c3(0.62, 0.6, 0.57), metalness: 1, roughness: 0.36, anisotropy: 0.4 });
      m.anisotropyNode = vec2(0.4, 0);
      break;
    case 'innerCase':
      m = phys({ color: c3(0.32, 0.32, 0.31), metalness: 0.3, roughness: 0.6 });
      break;
    case 'shaft':
      m = phys({ color: c3(0.62, 0.62, 0.6), metalness: 1, roughness: 0.3, anisotropy: 0.6 });
      m.anisotropyNode = vec2(0.6, 0);
      break;
  }
  m.maskNode = outsideWedge(u);
  m.aoNode = float(CAVITY[kind]);
  return m;
}

/**
 * Indirect-light occlusion per part family. The studio light is image based and has no
 * visibility, so surfaces deep inside the nacelle or the core would be lit by the whole
 * environment and read washed out in the cutaway; GTAO only covers the small scale. These
 * factors stand in for the cavity occlusion (direct light keeps the key's shadow map, in the
 * rotor pass too: src/render/studio.ts, rotor shadow proxies).
 */
const CAVITY: Readonly<Record<PartMaterial, number>> = {
  inletLip: 1,
  nacellePaint: 1,
  acousticLiner: 0.65,
  fanCase: 0.65,
  splitter: 0.75,
  cowlPaint: 0.9,
  compressorCase: 0.5,
  combustorCase: 0.5,
  turbineCase: 0.5,
  exhaust: 0.85,
  plug: 0.9,
  spinner: 0.85,
  drum: 0.5,
  disk: 0.45,
  innerCase: 0.5,
  shaft: 0.45,
  combustorLiner: 0.45,
};

/** The painted spiral, in the spinner's frame: a stripe winding 0.9 turn from nose to base. */
function spinnerSpiral(): Node<'vec3'> {
  const SPINNER_NOSE_X = -0.42;
  const s = positionLocal.x.sub(SPINNER_NOSE_X).div(-SPINNER_NOSE_X).clamp(0, 1);
  const th = atan(positionLocal.z, positionLocal.y);
  const centre = sqrt(s).mul(0.9 * TWO_PI);
  const d = abs(wrapPi(th.sub(centre)));
  const half = float(0.1).add(s.mul(0.28));
  const aa = fwidth(d).add(1e-4);
  const stripe = float(1).sub(smoothstep(half.sub(aa), half.add(aa), d));
  const tip = float(1).sub(smoothstep(0.035, 0.05, s));
  const white = max(stripe, tip);
  return mix(vec3(0.035, 0.036, 0.038), vec3(0.8, 0.8, 0.79), white);
}

/** Section colours (LD-4): one red-orange family, darker for paint and composites. */
const CAP_TINT: Readonly<Record<PartMaterial, readonly [number, number, number]>> = {
  inletLip: [0.46, 0.08, 0.03],
  nacellePaint: [0.3, 0.06, 0.025],
  acousticLiner: [0.24, 0.05, 0.025],
  fanCase: [0.36, 0.07, 0.03],
  splitter: [0.46, 0.08, 0.03],
  cowlPaint: [0.3, 0.06, 0.025],
  compressorCase: [0.46, 0.08, 0.03],
  combustorCase: [0.52, 0.14, 0.03],
  turbineCase: [0.52, 0.14, 0.03],
  exhaust: [0.5, 0.12, 0.035],
  plug: [0.5, 0.12, 0.035],
  spinner: [0.3, 0.06, 0.025],
  drum: [0.46, 0.08, 0.03],
  disk: [0.46, 0.08, 0.03],
  innerCase: [0.46, 0.08, 0.03],
  shaft: [0.4, 0.07, 0.03],
  combustorLiner: [0.55, 0.2, 0.04],
};

function capMaterial(kind: PartMaterial): NodeMaterial {
  const [r, g, b] = CAP_TINT[kind];
  const m = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.6 });
  m.aoNode = float(0.7);
  // 45-degree hatching every 6 mm in the section plane (cap uv is (x, r) in metres),
  // anti-aliased, fading to the mean tone where the lines are finer than a pixel
  const s = uv().x.add(uv().y).div(0.006);
  const d = abs(fract(s).sub(0.5));
  const line = aaLine(float(0.5).sub(d), 0.09);
  const k = resolved1(s, 1);
  const base = vec3(r, g, b);
  m.colorNode = mix(base, base.mul(0.45), line.mul(k).add(float(1).sub(k).mul(0.18)));
  return m;
}

/** Hides a whole instanced blade whose angular extent touches the cutaway wedge. */
function bladeHide(
  u: LookUniforms,
  rowAngle: UniformNode<'float', number>,
  tMin: UniformNode<'float', number>,
  tMax: UniformNode<'float', number>,
  rule: BladeCutRule,
): Node<'vec3'> {
  return Fn(() => {
    const ang = attribute('instanceAngle', 'float').add(rowAngle);
    const mid = abs(wrapPi(ang.add(tMin.add(tMax).mul(0.5)).sub(u.cutCenter)));
    const half = tMax.sub(tMin).mul(0.5);
    // src/geometry/cutaway.ts bladeHidden: `inside` (the fan) keeps the blades at the faces
    const reach = rule === 'inside' ? u.cutHalf.sub(half) : u.cutHalf.add(half);
    const hidden = u.cutHalf.greaterThan(0).and(mid.lessThan(reach));
    return select(hidden, vec3(0, 0, 0), positionLocal);
  })();
}

/**
 * Stochastic time sampling of the fan (W1L-I3): each pixel keeps the fragments of one of the
 * fan's time copies (userData.timeSample). The choice is interleaved gradient noise (well
 * spread in every 3 x 3 neighbourhood, so TRAA's colour clamp spans the samples and keeps the
 * history) plus a per-frame offset, so every pixel cycles through all copies over the frames
 * (a static pattern left each pixel on one copy: vertical streaks). Within that copy the depth
 * test is the ordinary one.
 *
 * The test runs in the fan's depth pre-pass only (fanDepthMaterial). A discard does not save
 * the shading on Dawn (WGSL demotes the invocation to a helper, and the shader runs to its
 * end), so the shaded copies had each cost a full fan (pass 4: rotors 1.2 -> 5.7 ms at the
 * default view). The shaded copies now pass only where their depth equals the pre-pass's:
 * one shaded fragment per pixel, the picked copy's front one (lookdev-3).
 */
function fanTimeMask(u: LookUniforms): Node<'bool'> {
  const sample = uniform(0).onObjectUpdate(({ object }) =>
    Number(object?.userData.timeSample ?? 0),
  );
  const pick = floor(
    fract(interleavedGradientNoise(screenCoordinate.xy).add(u.fanSeed)).mul(u.fanCopies),
  ).min(u.fanCopies.sub(1));
  return pick.equal(sample);
}

/** Per-blade variation in [-1, 1] (V2: identical blades give one identical highlight each). */
const bladeJitter = (): F => hash(instanceIndex).mul(2).sub(1);

function rowSurface(kind: RowMaterial, u: LookUniforms): MeshPhysicalNodeMaterial {
  const span = uv().y;
  const chord = uv().x;
  const jit = bladeJitter();
  switch (kind) {
    case 'fanBlade': {
      const ti = vec3(0.54, 0.51, 0.47);
      const m = phys({
        color: c3(0.54, 0.51, 0.47),
        metalness: 1,
        roughness: 0.3,
        anisotropy: 0.45,
      });
      m.anisotropyNode = vec2(0, 0.45);
      // leading-edge erosion: a slightly brighter, rougher band along the first few % of chord
      const le = float(1).sub(smoothstep(0.0, 0.05, chord));
      const grain = mx_noise_float(positionLocal.mul(vec3(30, 260, 260))).mul(0.03);
      m.colorNode = ti.mul(float(1).add(le.mul(0.08)).add(jit.mul(0.02)));
      m.roughnessNode = float(0.3).add(le.mul(0.1)).add(grain).add(jit.mul(0.025));
      return m;
    }
    case 'compressorBlade': {
      const m = phys({
        color: c3(0.58, 0.56, 0.53),
        metalness: 1,
        roughness: 0.4,
        anisotropy: 0.3,
      });
      m.roughnessNode = float(0.4).add(jit.mul(0.07));
      m.colorNode = vec3(0.58, 0.56, 0.53).mul(float(1).add(jit.mul(0.03)));
      return m;
    }
    case 'compressorVane': {
      const m = phys({ color: c3(0.5, 0.49, 0.47), metalness: 1, roughness: 0.46 });
      m.roughnessNode = float(0.46).add(jit.mul(0.07));
      return m;
    }
    case 'strut':
      return phys({ color: c3(0.34, 0.34, 0.33), metalness: 0.3, roughness: 0.58 });
    case 'hptBlade':
    case 'hptVane': {
      const vane = kind === 'hptVane';
      const m = phys({ color: c3(0.7, 0.64, 0.54), metalness: 0, roughness: 0.62 });
      const burn = smoothstep(0.35, 1, chord.mul(0.6).add(span.mul(vane ? 0.2 : 0.55)))
        .mul(u.heat)
        .add(mx_fractal_noise_float(positionLocal.mul(160), 2, 2, 0.5).mul(0.08));
      const tbc = vec3(0.7, 0.64, 0.54);
      const scorched = vec3(0.34, 0.27, 0.21);
      m.colorNode = mix(tbc, scorched, burn.clamp(0, 1).mul(0.8)).mul(float(1).add(jit.mul(0.04)));
      m.roughnessNode = float(0.62).add(jit.mul(0.05));
      return m;
    }
    case 'lptBlade':
    case 'lptVane': {
      const m = phys({ color: c3(0.5, 0.48, 0.45), metalness: 0.85, roughness: 0.48 });
      m.colorNode = heatTint(vec3(0.5, 0.48, 0.45), u, kind === 'lptVane' ? 0.8 : 0.6).mul(
        float(1).add(jit.mul(0.04)),
      );
      m.roughnessNode = float(0.48).add(jit.mul(0.07));
      return m;
    }
  }
}

/**
 * The fan's depth pre-pass: depth only, the per-pixel copy pick (fanTimeMask) and the same
 * vertex position as the shaded fan (bladeHide over the same object uniforms), so a shaded
 * copy's fragment has bit-identical depth where it was picked (EqualDepth, rowSurface).
 */
function fanDepthMaterial(u: LookUniforms, positionOf: () => Node<'vec3'>): NodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.colorWrite = false;
  m.positionNode = positionOf();
  m.maskNode = fanTimeMask(u);
  return m;
}

/** The row's spool angle plus the mesh's own turn, and its blade's angular extent. */
function bladeHideOf(u: LookUniforms, rule: BladeCutRule): Node<'vec3'> {
  // the row group's spool angle plus the mesh's own turn (a fan time copy's offset)
  const rowAngle = uniform(0).onObjectUpdate(
    ({ object }) => (object?.parent?.rotation.x ?? 0) + (object?.rotation.x ?? 0),
  );
  const tMin = uniform(0).onObjectUpdate(({ object }) => Number(object?.userData.thetaMin ?? 0));
  const tMax = uniform(0).onObjectUpdate(({ object }) => Number(object?.userData.thetaMax ?? 0));
  return bladeHide(u, rowAngle, tMin, tMax, rule);
}

export interface MaterialSet {
  part(kind: PartMaterial): NodeMaterial;
  cap(kind: PartMaterial): NodeMaterial;
  /** The fan's depth pre-pass (one material for every time copy). */
  fanDepth(): NodeMaterial;
  /**
   * A blade-row material. Per-row values (the row's rotation and angular extent) are object
   * uniforms read from the mesh's userData, so one material serves every row of its kind.
   */
  row(kind: RowMaterial, spool: 'lp' | 'hp' | null): NodeMaterial;
  dispose(): void;
}

export function createMaterials(u: LookUniforms): MaterialSet {
  const cache = new Map<string, NodeMaterial>();
  const get = (key: string, make: () => NodeMaterial) => {
    let m = cache.get(key);
    if (m === undefined) {
      m = make();
      cache.set(key, m);
    }
    return m;
  };
  return {
    part: (kind) => get(`part:${kind}`, () => partMaterial(kind, u)),
    cap: (kind) => get(`cap:${kind}`, () => capMaterial(kind)),
    // the fan's pre-pass and shaded copies share the rule: EqualDepth needs identical positions
    fanDepth: () => get('fanDepth', () => fanDepthMaterial(u, () => bladeHideOf(u, 'inside'))),
    row: (kind, spool) =>
      get(`row:${kind}:${String(spool)}`, () => {
        const m = rowSurface(kind, u);
        m.positionNode = bladeHideOf(u, kind === 'fanBlade' ? 'inside' : 'touches');
        // inside the nacelle (fan) or the core (every other row): see CAVITY
        // the fan sees the studio only through the intake mouth: 0.52 (pass 4 had 0.62, and
        // its blades read as white streaks once the key no longer lit them, W1L-I2)
        m.aoNode = float(kind === 'fanBlade' ? 0.52 : 0.5);
        if (spool !== null) {
          // the rotor pass records the angle this spool turns while the shutter is open and
          // the row's blade pitch (the image is periodic in it: see src/render/post.ts)
          const pitch = uniform(0).onObjectUpdate(({ object }) =>
            object instanceof InstancedMesh ? TWO_PI / object.count : TWO_PI,
          );
          // b = 1 marks fan blades: the fan blur march hits only them (src/render/post.ts)
          const fanFlag = kind === 'fanBlade' ? 1 : 0;
          m.mrtNode = mrt({
            blur: vec4(spool === 'lp' ? u.lpBlur : u.hpBlur, pitch, fanFlag, 1),
          });
          if (kind === 'fanBlade') {
            // the pick was made in the depth pre-pass: only the picked copy's front fragment
            // has the stored depth, and with no discard here the depth test runs early, so
            // nothing else is shaded
            m.depthFunc = EqualDepth;
            m.depthWrite = false;
          }
        }
        return m;
      }),
    dispose: () => {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}
