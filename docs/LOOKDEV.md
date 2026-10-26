# Look-dev (W1 geometry)

The procedural engine (`src/geometry`) rendered by the look-dev view (`src/render`). Run it with `npx vite --port 5183` and open `/lookdev.html` (`?preset=<id>&clean=1&shutter=<deg>&quality=test`; keys 1-7 presets, `c`/`e`/`r` modes, `t`/`g` throttle). The spools turn at N1/N2 from the **MOCK** cycle (`src/mocks/mockCycle`), with the definition's rotation sign.

## Screenshots (`docs/look-dev/`, 1920x1080, Chrome 155, Arc 140T, 2026-10-26)

Taken through the chrome-devtools MCP with the viewport emulated at 1920x1080x1, after 60-80 fixed 1/60 s frames (`window.lookdev.renderFrames`), so TRAA has converged.

| File | Preset | What it shows |
|---|---|---|
| `01-three-quarter-front.jpg` | `threeQuarterFront`, idle, 180 degree shutter | Clearcoat nacelle, polished aluminium inlet lip, acoustic barrel, the fan blurred at idle as a 60 fps film camera sees it (54 degrees per exposure) |
| `02-side.jpg` | `side`, idle | Nacelle profile with panel lines (inlet/fan-cowl and fan-cowl/reverser joints), exposed core cowl, heat-tinted core nozzle and plug |
| `03-cutaway.jpg` | `cutaway` | A 100 degree wedge opened toward the camera: hatched section caps on every solid, fan case, splitter, booster, HPC drum and disks, combustor, HPT/LPT, LP and HP shafts |
| `04-exploded.jpg` | `exploded` | Modules slid apart along the shaft in flow order (cowls off): fan case, fan, booster, transition, HPC, combustor, HPT, LPT, exhaust |
| `05-fan-idle.jpg` | `fanIdle`, 21.6 degree shutter (1/1000 s) | Fan at idle (1074 rpm): 24 twisted, polished titanium blades, 6.4 degrees of blur |
| `06-fan-takeoff.jpg` | `fanTakeoff`, 1/1000 s | Fan at static takeoff (5040 rpm): 30 degrees per exposure, two blade pitches: the outer span reads as a disc |
| `07-hot-section.jpg` | `hotSection` (cutaway close-up) | HPT and LPT disks and blades, hatched caps, heat-tinted cases and plug |

## How each look is made

- **Geometry:** walls are the definition curves with 25 mm fillets (exact between fillets, within 3 mm of every point); NACA 65 sections (compressors), DCA (fan), NACA 4-digit thickness on a front-loaded camber line (turbines), on the definition's metal angles, lofted hub to tip on the rendered walls (rotor tips keep their clearance), at the real counts (24 fan blades, 2,296 blades in all).
- **Fan:** titanium F0, roughness 0.17, anisotropy 0.75 along the span, a duller leading-edge band.
- **Nacelle:** white paint under a clearcoat, procedural panel lines and fastener rows; polished aluminium lip; carbon-composite fan case with a 2x2 twill.
- **Hot section:** HPT blades and vanes in a cream thermal-barrier coating that darkens and browns toward the trailing edge and tip; LPT parts, cases, nozzle and plug with a straw-bronze-blue heat-tint ramp and a weak first-order iridescence.
- **Spinner:** dark paint with a white spiral, in the spinner's own frame.
- **Lighting and post:** Poly Haven "Aircraft Workshop 01" (CC0, 1k HDR, 1.7 MB, `NOTICE.md`) for lighting and reflections, a key light, GTAO at half resolution, TRAA, depth of field, bloom, AgX tone mapping.
- **Rotational blur (analytic):** the rotors render in their own pass; the composite averages the rotor image along each pixel's circular trajectory about the axis over the angle turned while the shutter is open (`shutterBlurAngle`, from N1/N2). The average is taken over at most one blade pitch, because the image is periodic in it.
- **Cutaway:** fragments in the wedge are discarded, each solid's meridional loop is its exact section cap (ear-clipped, hatched), and blades touching the wedge hide whole (a cut blade would be hollow).
- **Exploded:** module groups slide by rank x 0.22 m, eased; skins hide.

## Still placeholder or wrong

- **Fan blur artefacts:** at an oblique view the fan face disc (the plane the blur uses between blades) departs from the swept blade surface, so blade-edge "teeth" remain near the hub and on the near side (`01`, `06`). Needs a swept-volume intersection instead of one plane.
- **Spinner spiral:** too faint to read in the shots: the dark clearcoat reflects the HDRI more than the white stripe shows.
- **Backdrop:** a dark sweep is meant to sit behind the engine, but it renders as nearly black (not yet diagnosed). No pylon, no ground.
- **Synthesized internals:** drums, disks, shafts, case thicknesses, the nacelle shell and the cavities are plausible proportions, not engine data. There are no combustor liners, fuel nozzles, frames/struts, bleed ducts or accessories. Blade fillets, platforms and shrouds are missing.
- **Heat tint** is static (permanent discoloration), not driven by temperature. Blackbody emission is W2/flowviz.
- **Performance:** about 20-23 ms per GPU-synchronised frame at 1080p (1.46 M triangles), well over the ~8 ms render budget. See the handoff.
