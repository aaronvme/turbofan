# Flow-solver mesh (W0 mesh-topology spike)

The live flow solver runs on a 2D axisymmetric (x, r) plane with swirl, on a body-fitted, point-matched,
12-block structured mesh. This document describes that mesh as the W0 spike built it on the
**placeholder flowpath** (`tools/mesh/geometry/placeholder.ts`). The placeholder is illustrative, not
engine data: only the fan tip diameter D = 1.55 m is a public figure. W1 swaps in the real
`EngineDefinition` behind the same named-curve interface (`tools/mesh/geometry/flowpath.ts`).

- **Code:** `tools/mesh/`. The builder is `engineMesh.ts`, with specs `MESH_130K` and `MESH_80K`. The building blocks are distributions, curves, TFI, the smoother, topology checks, metrics, the ghost map, the binary format, SVG output and the report.
- **Regenerate:** `npm run mesh` writes the SVGs and `metrics-<spec>.json` in `docs/mesh/`, and round-trips the binary asset through the OS temp dir. It runs on plain Node 24 with `tools/mesh/ts-resolve.mjs` (no dependencies).
- **Tests:** `tests/unit/mesh/` holds 120 tests that run in about 2 s. `engineMesh.test.ts` builds both production specs and checks every requirement below.
- **Conventions:** SI units; x is axial, with x = 0 at the fan face (station 2) and positive downstream; r ≥ 0. Every block is right-handed in (x, r).

![Engine overview, 130k spec](mesh/mesh-130k-engine.svg)

## Requirements and how they are met

| Requirement | 130k | 80k | Where it is checked |
|---|---|---|---|
| About 12 blocks, point-matched, axis at r = 0 | 12 blocks, interfaces bitwise | same | `validateMesh`; interface nodes and face vectors bitwise |
| 16 cells across the core everywhere | 16 | 16 | `core.nj`; walls on their curves at every column |
| 48 across the fan, about 32 across the bypass | 48 / 32 | 48 / 32 | fan, bypass, afterbody, plume-bypass `nj` |
| ≥ 4 cells per blade chord | 8 to 19 (HPC rear 8) | 6 to 19 (HPC rear 6) | cell centres in [x_LE, x_TE] at mid-span |
| Plume Δr 8 to 10 mm at both lips | 9.0 mm inside and outside both lips | same | `lipSpacing` |
| ≥ 5 D upstream and radially | 5.006 D from the highlight; r_out = 5.65 D | same | domain test |
| About 20 D downstream | 20.006 D from the core lip | same | domain test |
| Stretching ≤ 1.15, including across interfaces | max 1.137 | max 1.135 | `meshQuality().maxStretch` |
| Positive Jacobian at every cell corner | min 2.6e-6 m² | min 3.5e-6 m² | `meshQuality().minJacobian` |
| Total 130k ± 5 % / 80k ± 5 % | 129,913 (−0.1 %) | 79,769 (−0.3 %) | count test |

**Representative chords.** These are the placeholder's mid-span axial chords:

| Rows | Count | Axial chord (mm) | Cells per chord, 130k | Cells per chord, 80k |
|---|---|---|---|---|
| Fan rotor, fan OGV | 2 | 160 to 170 | 14 to 19 | 10 to 19 |
| Booster (IGV + 3 stages) | 7 | 30 | 8 | 6 |
| HPC (IGV + 9 stages) | 19 | 30 down to 15 | 8 | 6 |
| HPT (NGV, R1) | 2 | 35 to 40 | 8 | 6 |
| LPT (4 stages) | 8 | 30 to 45 | 8 to 9 | 6 |
| Turbine rear frame struts | 1 | 70 | 8 | 7 |

The binding case is the HPC rear: 15 mm chords give 1.9 mm axial cells at 130k. W1 must recheck this
with the real chords; the test does so automatically.

## Blocks and connectivity

| Block | What it covers | i direction | j direction (cells) |
|---|---|---|---|
| upstream | inflow x_in to the face in front of the inlet lip, axis to r_out | downstream | axis to r_out (inlet 32 + C-block arc 19 + far field 36 = 87) |
| inlet | inside the inlet, from the inlet-west curve to the fan face; axis and spinner up to the C-block | downstream | radial (32) |
| lip | **C-block** around the nacelle: from the fan face, along the inner wall, round the highlight, along the outer wall to the bypass lip | along the wall | wall-normal (16) |
| fan | fan face to the splitter plane | downstream | hub to casing (48) |
| bypass | splitter plane to the bypass-nozzle exit plane | downstream | cowl to nacelle (32) |
| core | **one H-block**, splitter plane to the core-nozzle exit plane | downstream | hub to core outer wall (16) |
| afterbody | over the core cowl, bypass-nozzle exit to core-nozzle exit plane | downstream | cowl to bypass shear line (32) |
| plug | over the plug, core-nozzle exit to the plug tip | downstream | plug to core shear line (16) |
| plume-core | behind the plug tip, axis to the core shear line | downstream | (16) |
| plume-bypass | between the core and bypass shear lines | downstream | (32) |
| plume-outer | outer shear layer of the bypass jet, above the bypass shear line | downstream | (16, continues the C-block's last column) |
| farfield | above the C-block's outer leg and plume-outer, to r_out and x_out | downstream | (36) |

```
 r_out +--------------------------------------------------------------------------------+
       |          :                          farfield                                   |
       | upstream :                                                                     |
       |          P2--------- lip (C-block, outer leg) ---------O                      |
       |         / \__                                          |\ plume-outer          |
       |        |  nacelle  )=================================B  \_____________________|
       |         \ __/                                          |   (bypass shear line) |
       |          P1--- lip (inner leg) ---+                     |                       |
       |          :        inlet           |  fan |  bypass      | afterbody | plume-   |
       |          :                        |      |--------------+-----------C bypass   |
       |          :              spinner __|      |  core (one H-block)        \_______ |
       |          :     _______/                  |                            |plug|plume-core
     0 +==========F==== axis =========================================================== +--> x
      x_in                                 x=0    splitter          bypass lip  core lip  x_out
```

The C-block wraps the nacelle from the fan face round the highlight to the bypass lip B. Its outer
edge carries two **valence-5 points**, P1 inside the inlet and P2 outside it. They sit where the
smoothed wall normal turns through 45° either side of the highlight. Five cells meet at each, and
the upstream block's east face turns there: by about 75° in the algebraic grid, against an ideal of
60°. O is the C-block's outer corner above the bypass lip. B, C, the splitter S and the plug tip are
geometry points.

**Interfaces.** Nineteen pairs, with node ranges for the 130k spec. They are stored once per side.
Face vectors are bitwise equal across min/max face pairs and bitwise negated across max/max pairs,
so the ghost exchange is exactly conservative.

| Interface | Side A (nodes) | Side B (nodes) | Smoothing |
|---|---|---|---|
| upstream \| inlet | upstream.imax 0..32 | inlet.imin 0..32 | floating |
| upstream \| lip | upstream.imax 32..51 | lip.jmax 78..97 | floating |
| upstream \| farfield | upstream.imax 51..87 | farfield.imin 0..36 | floating |
| inlet \| lip | inlet.jmax 0..78 | lip.jmax 78..0 (reversed, max/max) | floating |
| inlet \| fan | inlet.imax 0..32 | fan.imin 0..32 | fixed (fan face) |
| lip \| fan | lip.imin 0..16 | fan.imin 48..32 (reversed) | fixed (fan face) |
| lip \| plume-outer | lip.imax 0..16 | plume-outer.imin 0..16 | floating |
| lip \| farfield | lip.jmax 97..219 | farfield.jmin 0..122 | floating |
| fan \| core | fan.imax 0..16 | core.imin 0..16 | fixed (splitter plane) |
| fan \| bypass | fan.imax 16..48 | bypass.imin 0..32 | fixed (splitter plane) |
| core \| plug | core.imax 0..16 | plug.imin 0..16 | fixed (core-nozzle exit) |
| bypass \| afterbody | bypass.imax 0..32 | afterbody.imin 0..32 | fixed (bypass-nozzle exit) |
| afterbody \| plume-outer | afterbody.jmax 0..145 | plume-outer.jmin 0..145 | floating |
| afterbody \| plume-bypass | afterbody.imax 0..32 | plume-bypass.imin 0..32 | floating |
| plug \| plume-bypass | plug.jmax 0..59 | plume-bypass.jmin 0..59 | floating |
| plug \| plume-core | plug.imax 0..16 | plume-core.imin 0..16 | floating |
| plume-core \| plume-bypass | plume-core.jmax 0..833 | plume-bypass.jmin 59..892 | floating |
| plume-bypass \| plume-outer | plume-bypass.jmax 0..892 | plume-outer.jmin 145..1037 | floating |
| plume-outer \| farfield | plume-outer.jmax 0..1037 | farfield.jmin 122..1159 | floating |

"Floating" means elliptic smoothing may move the interface. The production specs run 0 sweeps
(decision D3), so nothing moves.

## Boundary conditions

The BC codes are part of the binary format, so they are never renumbered (`tools/mesh/types.ts`).

| Code | Name | Meaning | Patches (130k) |
|---|---|---|---|
| 0 | interface | point-matched; the ghost is an index copy of the neighbour's interior cell | the 19 pairs above |
| 1 | slip-wall | inviscid wall; losses come from the body force | `hub`: inlet.jmin 35..78 (spinner), fan, core, plug. `core-outer`: core.jmax. `core-cowl`: bypass.jmin, afterbody.jmin. `nacelle-inner`: lip.jmin 0..84, fan.jmax, bypass.jmax. `nacelle-outer`: lip.jmin 84..219 |
| 2 | axis | r = 0; mirror ghost cells | upstream.jmin, inlet.jmin 0..35, plume-core.jmin |
| 3 | farfield | lateral boundary r = r_out; characteristic | upstream.jmax, farfield.jmax |
| 4 | inflow | x = x_in; characteristic, free-stream totals | upstream.imin |
| 5 | outflow | x = x_out; characteristic, ambient static pressure | plume-core, plume-bypass, plume-outer and farfield imax |

Wall nodes lie on their geometry curves to within 1e-9 m. The test checks every wall patch against
its named curve.

## Cell counts

| Block | 130k ni × nj | 130k cells | 80k ni × nj | 80k cells |
|---|---|---|---|---|
| upstream | 43 × 87 | 3,741 | 43 × 87 | 3,741 |
| inlet | 78 × 32 | 2,496 | 78 × 32 | 2,496 |
| lip | 219 × 16 | 3,504 | 218 × 16 | 3,488 |
| fan | 48 × 48 | 2,304 | 48 × 48 | 2,304 |
| bypass | 103 × 32 | 3,296 | 85 × 32 | 2,720 |
| core | 550 × 16 | 8,800 | 440 × 16 | 7,040 |
| afterbody | 145 × 32 | 4,640 | 111 × 32 | 3,552 |
| plug | 59 × 16 | 944 | 46 × 16 | 736 |
| plume-core | 833 × 16 | 13,328 | 397 × 16 | 6,352 |
| plume-bypass | 892 × 32 | 28,544 | 443 × 32 | 14,176 |
| plume-outer | 1037 × 16 | 16,592 | 554 × 16 | 8,864 |
| farfield | 1159 × 36 | 41,724 | 675 × 36 | 24,300 |
| **total** | | **129,913** (−0.1 %) | | **79,769** (−0.3 %) |

**Where the cells go.** The engine internals (inlet, lip, fan, bypass, core, afterbody, plug) hold 26k
cells at 130k. The three plume blocks hold 58k and the far field 42k. Point matching drives this split:
every plume x-station continues up through plume-outer and the far field, so each station costs
16 + 32 + 16 + 36 = 100 cells. The 130k spec spends its extra ~50k cells on:
- **core:** 8 cells per chord against 6 (+1.8k cells);
- **nozzle lips:** 8 mm axial cells against 10 mm, growing at 0.5 % per cell against 0.8 %;
- **plume:** a 25 mm axial plateau to 11 D after the core lip, against 50 mm to 7 D. This keeps the shear layers resolved through the potential core.

**Resolution in numbers (both specs unless stated).**
- **Fan face:** 48 cells, uniform 11.1 mm.
- **Splitter:** 5 mm axial; 6.1 mm radial on both sides of the splitter lip.
- **Core:** 1.4 to 10 mm axial (blade rows at chord/8 or chord/6, combustor 8 mm), 16 radial. The HPC rear's 2.5 cm annulus gives 1.6 mm radial cells.
- **C-block:**
  - wall-normal: 3 mm first cell at the highlight; 16 cells over 0.12 m there; 0.18 m at the fan face; 0.27 m at the bypass lip;
  - tangential: 3.5 mm at the highlight.
- **Jet shear lines:** radial spacing h(x) = 9 mm + (45 mm − 9 mm)·u², where u = (x − x_lip)/(x_out − x_lip). It is used on both sides of each line.
- **Outflow face:** 45 mm uniform across the plume blocks.
- **Far field:** 36 geometric cells; ratio ≤ 1.123.

## Quality

The unsmoothed algebraic grid is the production grid (decision D3).

**Definitions** (all in `metrics.ts`):
- **Jacobian:** the corner cross product of the two cell edges at a corner, in m². The scaled Jacobian is the minimum over corners of sin(corner angle).
- **Stretching:** the ratio of adjacent cell lengths along a grid line, measured between face midpoints, including the pair of cells either side of every interface.
- **Skew:** the largest deviation of a cell corner angle from 90°.
- **Wall and interface orthogonality:** the deviation from 90° between the face and the grid line leaving it.
- **Kink:** the change of direction of a grid line crossing an interface.
- **Aspect ratio:** the ratio of a cell's two midpoint lengths.

### 130k

| Block | min J (m²) | max J (m²) | min scaled J | max stretch | max skew (°) | wall ortho (°) | iface ortho (°) | iface kink (°) | aspect min–max | edge min–max (m) |
|---|---|---|---|---|---|---|---|---|---|---|
| upstream | 1.73e-4 | 5.10e-1 | 0.69 | 1.137 | 46.5 | – | 46.5 | 46.1 | 1.0–51 | 1.37e-2–0.87 |
| inlet | 8.80e-5 | 4.12e-4 | 0.80 | 1.097 | 36.6 | 36.5 | 20.6 | 39.0 | 1.0–3 | 7.92e-3–0.03 |
| lip | 1.08e-5 | 6.30e-4 | 0.99 | 1.112 | 9.6 | 6.6 | 6.6 | 46.3 | 1.0–6 | 3.00e-3–0.03 |
| fan | 3.21e-5 | 1.06e-4 | 0.95 | 1.084 | 17.4 | 17.4 | 15.2 | 20.2 | 1.0–2 | 5.26e-3–0.01 |
| bypass | 3.13e-5 | 1.32e-4 | 0.96 | 1.086 | 16.5 | 16.5 | 16.4 | 20.2 | 1.0–3 | 4.75e-3–0.01 |
| core | 2.60e-6 | 1.11e-4 | 0.96 | 1.128 | 16.6 | 16.5 | 16.5 | 4.1 | 1.0–4 | 1.39e-3–0.01 |
| afterbody | 3.81e-5 | 1.04e-4 | 0.92 | 1.084 | 22.9 | 22.9 | 22.7 | 22.8 | 1.0–2 | 4.63e-3–0.01 |
| plug | 7.23e-5 | 2.99e-4 | 0.94 | 1.110 | 19.8 | 19.8 | 18.9 | 18.9 | 1.0–2 | 8.20e-3–0.03 |
| plume-core | 9.71e-5 | 7.33e-3 | 1.00 | 1.112 | 1.1 | – | 1.1 | 18.9 | 1.0–5 | 9.01e-3–0.16 |
| plume-bypass | 7.23e-5 | 7.31e-3 | 0.97 | 1.105 | 13.8 | – | 13.8 | 8.9 | 1.0–5 | 8.03e-3–0.16 |
| plume-outer | 7.08e-5 | 7.31e-3 | 0.95 | 1.105 | 17.7 | – | 17.7 | 46.3 | 1.0–4 | 7.49e-3–0.16 |
| farfield | 1.73e-4 | 6.56e-2 | 0.69 | 1.123 | 46.3 | – | 46.3 | 46.3 | 1.0–96 | 7.49e-3–0.87 |

### 80k

| Block | min J (m²) | max J (m²) | min scaled J | max stretch | max skew (°) | wall ortho (°) | iface ortho (°) | iface kink (°) | aspect min–max | edge min–max (m) |
|---|---|---|---|---|---|---|---|---|---|---|
| upstream | 1.73e-4 | 5.11e-1 | 0.69 | 1.135 | 46.4 | – | 46.3 | 45.9 | 1.0–52 | 1.37e-2–0.87 |
| inlet | 8.80e-5 | 4.12e-4 | 0.80 | 1.097 | 36.6 | 36.5 | 20.6 | 39.0 | 1.0–3 | 7.92e-3–0.03 |
| lip | 1.08e-5 | 6.28e-4 | 0.99 | 1.112 | 9.6 | 6.7 | 6.6 | 46.2 | 1.0–6 | 3.00e-3–0.03 |
| fan | 3.21e-5 | 1.06e-4 | 0.95 | 1.084 | 17.4 | 17.4 | 15.2 | 20.2 | 1.0–2 | 5.26e-3–0.01 |
| bypass | 3.14e-5 | 1.60e-4 | 0.96 | 1.086 | 16.5 | 16.5 | 16.4 | 20.2 | 1.0–3 | 4.75e-3–0.02 |
| core | 3.46e-6 | 1.11e-4 | 0.96 | 1.119 | 16.5 | 16.5 | 16.5 | 4.1 | 1.0–4 | 1.39e-3–0.01 |
| afterbody | 4.78e-5 | 1.41e-4 | 0.92 | 1.084 | 22.9 | 22.9 | 22.8 | 22.7 | 1.0–3 | 4.63e-3–0.02 |
| plug | 8.95e-5 | 3.96e-4 | 0.94 | 1.110 | 19.7 | 19.7 | 18.9 | 18.9 | 1.0–2 | 8.98e-3–0.03 |
| plume-core | 1.30e-4 | 1.16e-2 | 1.00 | 1.112 | 1.1 | – | 1.1 | 18.9 | 1.0–7 | 9.01e-3–0.26 |
| plume-bypass | 8.95e-5 | 1.16e-2 | 0.97 | 1.105 | 13.8 | – | 13.8 | 9.0 | 1.0–7 | 9.00e-3–0.26 |
| plume-outer | 8.87e-5 | 1.16e-2 | 0.95 | 1.105 | 17.8 | – | 17.7 | 46.3 | 1.0–7 | 9.00e-3–0.26 |
| farfield | 2.16e-4 | 1.04e-1 | 0.69 | 1.123 | 46.3 | – | 46.2 | 46.3 | 1.0–77 | 9.29e-3–0.87 |

**Worst values and where they occur** (130k; the 80k values are within 0.2 % except as noted):

| Metric | Value | Where | Why |
|---|---|---|---|
| Stretching | 1.137 | upstream, (−0.94, 0.96), next to P2 | the upstream columns fade the 75° turn of the east face at P2 |
| Skew | 46.5° | upstream corner cell at P2 (−0.76, 0.95) | valence-5 point; farfield 46.3° at O (1.70, 0.99) |
| Interface kink | 46.3° | around P1, P2 and O | grid lines change direction at the valence-5 points and at O |
| Wall orthogonality | 36.5° | inlet, at the spinner nose (−0.49, 0.02) | the hub leaves the axis at 35° |
| Wall orthogonality in the ducts | 16.5–22.9° | station planes | the radial planes meet sloped walls (cowl slope 0.3 at the splitter, boattail at the core lip) |
| Smallest edge | 1.39 mm | core, HPC rear (2.5 cm / 16 cells radial) | sets the explicit time step (risk R2) |
| Aspect ratio | 96 (80k: 77) | top of the far field (2.5, 8.4) | thin far-field cells under the plume x-stations |
| Minimum Jacobian | 2.6e-6 m² | core, HPC rear | small cells, not a bad shape (scaled 0.96) |

## Pictures

All of these are regenerated by `npm run mesh`. Colours identify blocks and repeat only on blocks that
never touch; every block is also labelled. Walls are black and the axis is dashed.

![Full domain, 130k](mesh/mesh-130k-domain.svg)

![Inlet lip C-block, 130k](mesh/mesh-130k-inlet-lip.svg)

![Splitter, 130k](mesh/mesh-130k-splitter.svg)

![HPC rear, 130k](mesh/mesh-130k-hpc-rear.svg)

![Core nozzle and bypass shear layer, 130k](mesh/mesh-130k-core-nozzle.svg)

![Plug, 130k](mesh/mesh-130k-plug.svg)

The 80k fallback, for comparison:

![Full domain, 80k](mesh/mesh-80k-domain.svg)

![Engine, 80k](mesh/mesh-80k-engine.svg)

## Binary format v1

The authoritative layout is in `tools/mesh/format.ts`. Writer → reader → writer round-trips bitwise;
this is tested, and `npm run mesh` repeats it on both production meshes.

The file is little-endian. A 64-byte header comes first, then the section table, then the sections
in id order. Each section starts on an 8-byte boundary, so a loader can view it in place as a typed
array (structure of arrays: one GPU buffer per section). Counts and offsets are u32.

**Header (64 bytes)**

| Offset | Type | Field |
|---|---|---|
| 0 | 8 bytes | magic `TFMESH\0\0` |
| 8 | u32 | version = 1 |
| 12 | u32 | flags: bit 0 set when the metrics are f32 (nodes are always f64) |
| 16 | u32 | number of blocks |
| 20 | u32 | number of patches |
| 24 | u32 | number of nodes |
| 28 | u32 | number of cells |
| 32 | u32 | number of i-faces |
| 36 | u32 | number of j-faces |
| 40 | u32 | number of ghosts |
| 44 | u32 | ghost layers (2) |
| 48 | u32 | number of sections (16) |
| 52 | u32 | header bytes (64) |
| 56 | u32 | total file bytes |
| 60 | u32 | reserved (0) |

**Section table:** 16 bytes per section, starting at byte 64: u32 id, u32 element type, u32 byte
offset, u32 byte length. The element types are 1 f64, 2 f32, 3 i32, 4 u8, 5 block record and
6 patch record.

| Id | Section | Element | Count | Indexing |
|---|---|---|---|---|
| 1 | BLOCKS | block record (64 B) | blocks | |
| 2 | PATCHES | patch record (64 B) | patches | |
| 3, 4 | NODE_X, NODE_R | f64 | nodes | `nodeOffset + j·(ni+1) + i` |
| 5, 6 | CELL_X, CELL_R | f64 or f32 | cells | planar centroid; `cellOffset + j·ni + i` |
| 7 | CELL_AREA | f64 or f32 | cells | planar area A (m²) |
| 8 | CELL_VOLR | f64 or f32 | cells | per-radian volume ∫r dA = A·r_centroid (m³/rad) |
| 9, 10 | IFACE_NX, IFACE_NR | f64 or f32 | i-faces | n·L pointing towards +i: (r_b − r_a, x_a − x_b), where a = node (i, j) and b = node (i, j+1); `iFaceOffset + j·(ni+1) + i` |
| 11 | IFACE_AREAR | f64 or f32 | i-faces | per-radian face area r̄·L (m²/rad) |
| 12, 13 | JFACE_NX, JFACE_NR | f64 or f32 | j-faces | n·L pointing towards +j: (r_a − r_b, x_b − x_a), where a = node (i, j) and b = node (i+1, j); `jFaceOffset + j·ni + i` |
| 14 | JFACE_AREAR | f64 or f32 | j-faces | r̄·L |
| 15 | GHOST_SRC | i32 | ghosts | global source cell of each ghost |
| 16 | GHOST_BC | u8 | ghosts | BC code (0 means a plain copy) |

**Block record (64 B).**
- Bytes 0–31: name in UTF-8, NUL-padded.
- Bytes 32–59: u32 ni, nj, nodeOffset, cellOffset, iFaceOffset, jFaceOffset, ghostOffset.
- Bytes 60–63: reserved.

**Patch record (64 B).**

| Bytes | Type | Field |
|---|---|---|
| 0 | u32 | block |
| 4 | u8 | face: 0 imin, 1 imax, 2 jmin, 3 jmax |
| 5 | u8 | BC |
| 6 | u8 | floating |
| 8 | u32 | start node |
| 12 | u32 | end node |
| 16 | i32 | neighbour block (−1 for a physical boundary) |
| 20 | u8 | neighbour face |
| 24 | u32 | neighbour start (may be greater than the end) |
| 28 | u32 | neighbour end |
| 32–63 | 32 B | label |

**Ghost map.** There are two layers.
- **Order:** ghosts are numbered block by block; within a block, face by face (imin, imax, jmin, jmax), then by layer (1 touches the face), then by face cell index.
- **Interfaces:** the source is the neighbour's cell `layer` cells in from the matching face, and the ghost is a plain copy. Because interface nodes, and hence face vectors, are bitwise shared, both blocks compute the same flux.
- **Physical boundaries:** the source is the block's own mirror cell, and the solver applies the BC.
- **Corners:** no corner ghosts are provided; the dimension-split MUSCL stencil never reads them.

**Discrete identity.** Summing n_r·r̄·L over a cell's faces gives the planar area A exactly. This is
Green's theorem on the field (0, r), and it is what balances the radial pressure source p·A in a
quiescent field (ladder L1). A metrics test checks it to 1e-12.

**Sizes.** At 130k the file is 12.8 MB with f64 metrics and 7.5 MB with f32. At 80k it is 7.9 MB
and 4.6 MB. The nodes alone are 2.2 MB at 130k.

## Decisions

- **D1 Topology.**
  - The mesh has 12 blocks: a C-block around the nacelle; one H-block core from the splitter to the core-nozzle exit; three plume blocks bounded by two jet shear lines (bypass shear from the bypass lip, core shear from the core lip); a far field above the C-block and plume-outer; upstream and inlet blocks in front.
  - The C-block's wall-normal count (nLip = 16) is also plume-outer's radial count, and it splits the fan face (inlet 32 + C-block 16 = 48).
  - The valence-5 points P1/P2 sit where the smoothed outer-edge normal turns through ±45°.
- **D2 Station planes.** The fan face (x = 0), the splitter plane and both nozzle exit planes are exact radial lines, bitwise at the geometry x. They are fixed interfaces, which suits the cycle model's station reductions. The cost is 16–23° of wall orthogonality where sloped walls cross them.
- **D3 No elliptic smoothing in production (sweeps = 0).** The algebraic construction is designed to meet every requirement on its own. Smoothing was measured with 300 Winslow/Thomas–Middlecoff sweeps:
  - with floating interfaces, the pinned junction points (P1, P2, O and the shear-line T-points) form spikes, with stretching up to 4.3 and folded cells;
  - with fixed interfaces, the far field's skew improves from 46° to 38°, but the cross-interface match at O breaks (1.31);
  - the upstream, inlet and C-block break next to P1/P2 (1.25 to 3.05);
  - the duct and plume blocks are unchanged to within about 1 % of the local spacing.

  The smoother stays wired in. `smoothingOptions` limits it to the fan, core and bypass blocks, where it is verified harmless. See risk R3 for what it would take to make smoothing pay.
- **D4 Matching by construction.** Every interface is matched by design:
  - duct walls are cut by a smoothed mean-line normal blended to radial over 1.5 duct heights, so the first wall cells are not compressed at the station planes;
  - each jet shear line has one radial spacing function used by the blocks on both sides;
  - plume-outer is designed by its first and top cells, so the far field above starts from a smooth, monotone first cell;
  - the far field and the inlet re-space their columns to the neighbour's last cell, with the per-column targets smoothed;
  - the upstream block blends its west face into progressively smoothed, arc-length-preserving copies of the east face, so the turns at P1/P2 fade without stepping the columns.
- **D5 Shear-layer spacing** grows like (distance/length)² from 9 mm at the lips to the 45 mm outflow spacing. A linear growth outran the jets' own mean cell a few diameters downstream and forced 1.14 ratios across plume-bypass.
- **D6 Budgets.** The 130k and 80k specs share the C-block, inlet, upstream and fan, the fixed counts across, and the 9 mm lip spacing. They differ in core cells per chord (8 against 6), lip axial spacing (8 against 10 mm) and plume plateau (25 mm to 11 D against 50 mm to 7 D). Both use nFar = 36, which keeps the far-field ratio at or below 1.123.
- **D7 Domain extents** are rounded outwards to whole centimetres plus 1 cm. This keeps 5 D and 20 D true after floating-point subtraction: x_in = −8.46 m, x_out = 34.01 m, r_out = 8.75 m.
- **D8 No new dependencies.** The generator runs on Node 24's native type stripping with a 15-line resolve hook (`tools/mesh/ts-resolve.mjs`).

## Open risks for W1

- **R1 Real geometry.** The builder's shape choices were tuned on the placeholder: the C-block thickness and normal smoothing, the inlet-west and far-field-west curves, the shear-line knots, and the 75° turns at P1/P2. The worst stretching margin is 1.137 against 1.15. The test suite catches any violation, but a different nacelle or duct may need retuning. The sensitive spots are:
  - the C-block's outer layer against its outer-edge spacing at P1/P2 (they must agree to within 15 %);
  - the far-field ratio where its first cell is smallest (next to P2);
  - sharper bends than the placeholder's gooseneck (the cut-normal smoothing assumes about one duct height of curvature length);
  - the boattail slope at O.
- **R2 Explicit time step.** The smallest cells are 1.39–1.9 mm in the HPC rear (16 cells across a 2.5 cm annulus, chord/8 axially). At the HPC exit (|u| + c ≈ 720 m/s axially, c ≈ 570 m/s radially) the 2D explicit limit at CFL 1 is about 1.4 µs (130k) or 1.6 µs (80k). That is **below the plan's 2 µs physical-time step**. Steady mode with local time stepping is unaffected. W1 needs a smaller physical-time step, local subcycling of the core, or an orchestrator decision on the HPC rear's radial count. The "16 everywhere" requirement fixes that count.
- **R3 Skew and orthogonality without smoothing.**
  - The figures are: skew up to 46° at P2 and O, wall orthogonality 36° at the spinner nose, 16–23° at the station planes.
  - If the solver wants better, the smoother needs singular-point-aware floating interfaces: free valence-5 points with a five-neighbour update, and regular junctions such as O and the shear-line T-points with a stencil in the block where they are face-interior.
  - The C-block's outer edge could also be faired into plume-outer's top at O, removing the 23° turn there.
- **R4 Shear-line placement.** The shear lines are block boundaries shaped like jets, not computed jet boundaries. The solver's jets will spread on their own. Resolution concentrates around these lines (9 mm at the lips, about 11 mm at 10 m, 37 mm at 30 m).
- **R5 Far-field cost.** Point matching runs every plume x-station through the far field: 42k of the 130k cells, with aspect ratios up to 96. A non-matching (patched) interface on top of plume-outer would free about 25–30k cells.
- **R6 Asset size.** The asset is 7.5 MB (f32) at 130k. Consider shipping nodes only (2.2 MB) and computing the metrics at load time, or compressing the asset.
- **R7 Placeholder chords.** The ≥ 4 per chord check runs on placeholder chords. The real HPC rear chords decide the core's axial count.
