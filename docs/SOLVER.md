# Flow solver: the discrete scheme (contract between the f64 reference and the WGSL kernel)

This file specifies, term by term, the discrete scheme of the live 2D axisymmetric + swirl flow solver. Two implementations follow it:

- **The oracle**: `src/flow/reference/` (w2/reference), in f64 (`Float64Array`), written for readability. Every formula below names the function that implements it.
- **The GPU kernel**: WGSL (w2/solver), in f32. It must implement the same formulas in the same order. Section 12 lists where f32 differs and the tolerances it must meet against the oracle.

Units are SI. The frame is the meridional (x, r, θ) frame of PHYSICS.md §2.1: x axial (x = 0 at the fan face), r ≥ 0, θ right-handed about +x. Everything is **per radian of revolution**: a cell's "volume" is ∫ r dA and a face's "area" is ∫ r dl.

## 1. The equations

The axisymmetric Euler equations with swirl, per radian, with a blockage factor b(x, r) (the fraction of the annulus open to the gas; 1 outside blade rows) and volume sources s (per unit of gas volume):

```
∂(b r U)/∂t + ∂(b r F_x)/∂x + ∂(b r F_r)/∂r = r G + b r s
U   = (ρ, ρu, ρv, ρ r w, ρE, ρZ)                       u = u_x, v = u_r, w = u_θ
F_x = (ρu, ρu² + p, ρuv, ρu r w, ρu h0, ρu Z)
F_r = (ρv, ρuv, ρv² + p, ρv r w, ρv h0, ρv Z)
r G = (0, p ∂b/∂x · r, p ∂(b r)/∂r + b ρ w², 0, 0, 0)  (per radian: the pressure on the blade metal and the axisymmetric terms)
```

with E = e + (u² + v² + w²)/2, h0 = E + p/ρ and Z the fuel-air ratio (FAR, kg fuel per kg air). The angular-momentum equation carries ρ r w (not ρw): it has **no geometric source**, so the discrete angular momentum is conserved exactly, a body-force torque enters as one source term, and the energy source of a rotor row is exactly Ω times that torque source (Euler work: Δh0 = Ω Δ(r w), ladder L9).

## 2. Mesh and metrics (`src/flow/mesh/`, `src/flow/reference/solverMesh.ts`)

The solver reads the mesh asset (binary v2, docs/MESH.md "Binary format v2"): 12 point-matched blocks, cells i-fastest.

- **Cell c** (block b, indices i, j): global index `cellOffset_b + j·ni + i`. Metrics: `CELL_AREA` A_c (planar), `CELL_VOLR` V_c = A_c r_c (per-radian volume), `CELL_R` r_c (planar centroid radius).
- **i-face** (i, j), i = 0..ni: `IFACE_NX/NR` = n·L (normal times length, pointing towards +i), `IFACE_AREAR` = r̄ L. **j-face** (i, j), j = 0..nj: the same towards +j.
- **Per-radian face vector**: S_f = (NX, NR) · (AREAR / L), L = hypot(NX, NR). Its magnitude is |S_f| = AREAR. The face radius is r_f = AREAR / L. A face with AREAR = 0 (on the axis) carries **no flux at all**: the kernel must skip it, not divide by r_f = 0.
- **Discrete identities** (exact in exact arithmetic, MESH.md): over a cell's four outward face vectors, Σ S_x = 0 (Green on (r, 0)) and Σ S_r = A_c (Green on (0, r)). The first is the geometric conservation law (free-stream preservation); the second balances the radial pressure source.
- **Metric precision**: the oracle uses the asset's metrics **as stored** (the browser asset stores them as f32; the oracle upcasts them to f64). It never recomputes them, so the GPU and the oracle see the same numbers. Ladder tests that need exact identities build the same mesh with f64 metrics in memory (`meshFileFromMesh(mesh, 'f64')`). Section 12.3 quantifies what the f32 metrics cost.

**Ghost cells** (`GHOST_SRC`, `GHOST_BC`): two layers on every block face, no corner ghosts. Within block b, ghosts are numbered from `ghostOffset_b` face by face (imin, imax, jmin, jmax), then layer 1..2 (1 touches the face), then the face-cell index c along the face (j on i-faces, i on j-faces). So the cell (i, j) outside the block is the ghost

| where | face | layer | c |
|---|---|---|---|
| i < 0 | imin | −i | j |
| i ≥ ni | imax | i − ni + 1 | j |
| j < 0 | jmin | −j | i |
| j ≥ nj | jmax | j − nj + 1 | i |

with face bases imin 0, imax 2·nj, jmin 4·nj, jmax 4·nj + 2·ni. The **boundary normal** of a ghost is the unit outward normal of its face cell's boundary face: −S/|S| of the i-face i = 0 (imin) or the j-face j = 0 (jmin), +S/|S| of i = ni (imax) or j = nj (jmax). An interface ghost's source is the neighbour block's cell `layer` cells in from the shared face; a physical ghost's source is this block's own cell `layer − 1` cells in from the face.

**Domain (W1M-N4).** The asset carries no domain fields. The loader derives the domain from the boundary patches' nodes: x_in = the x of every INFLOW node, x_out = the x of every OUTFLOW node, r_out = the r of every FARFIELD node. Each boundary must be a plane to 1e-9 m, or the asset is rejected (`meshDomain`).

## 3. Gas model (`src/flow/reference/gas.ts`)

A **gas table** is the pair (air, stoichiometric products) of `src/thermo` `GAS_TABLES`: per gas, R and two temperature ranges (break at 1000 K), each with cp = Σ_{k=0}^{4} c_k T^k and h = hConst + Σ c_k T^{k+1}/(k+1). The verification cases (L2-L5, L7, L9a) use a **calorically perfect** table instead (γ = 1.4, R = 287.05287: c_0 = γR/(γ−1), c_1..4 = 0, both ranges and both gases equal), so that their analytic solutions apply. It is the same code path with different constants.

**Mixture.** With f_st the stoichiometric FAR (0.0682) and Z clamped to [0, f_st]: φ(Z) = Z(1 + f_st) / (f_st(1 + Z)) (products mass fraction, `src/thermo` `productsMassFraction`), R(φ) = R_a + φ(R_p − R_a), cp(T, φ) = cp_a(T) + φ(cp_p(T) − cp_a(T)).

**Gauge form of the caloric equation of state.** The reference (ambient) state is (ρ∞, p∞, T∞, u∞ axial, Z = 0) with R∞ = R_a. Enthalpy differences are computed as divided differences so that the ambient gives exact zeros, in f32 as in f64:

- For one polynomial range, h(T) − h(T0) = (T − T0) · C(T, T0) with the **secant cp** C(T, T0) = Σ_k c_k/(k+1) · P_k, P_0 = 1, P_k = T·P_{k−1} + T0^k. C(T0, T0) = cp(T0).
- Across the 1000 K break (T∞ < 1000 K ≤ T): h(T) − h(T∞) = (1000 − T∞) C_lo(1000, T∞) + (T − 1000) C_hi(T, 1000). Symmetrically if T < 1000 ≤ T0. The tables are continuous at 1000 K.
- With T′ = T − T∞: Δh_g(T′) = h_g(T∞ + T′) − h_g(T∞) for g = air, products; D∞ = h_p(T∞) − h_a(T∞) (a constant).
- **Δh(T′, φ)** = h(T, φ) − h∞ = Δh_a(T′) + φ(Δh_p(T′) − Δh_a(T′) + D∞).
- **Δe(T′, φ)** = e(T, φ) − e∞ = Δh(T′, φ) − R∞ T′ − (R(φ) − R∞) T.

**Temperature from the energy** (`temperatureGauge`): solve Δe(T′, φ) = Δe* by Newton with **exactly 3 steps** (no convergence test) from T′_0 = (Δe* − φ D∞ + (R(φ) − R∞) T∞) / (cp(T∞, φ) − R(φ)); each step T′ ← T′ − (Δe(T′, φ) − Δe*) / (cp(T∞ + T′, φ) − R(φ)). For the calorically perfect table T′_0 is already exact. For the thermally perfect table 3 steps leave < 1e-6 K at 2000 K (tested). The polynomials are evaluated outside [200, 3500] K by extrapolation; the solver does not throw (non-finite values surface as divergence).

**Temperature from pressure and density** (`temperatureFromPressure`), exact zero in the ambient: T′ = (p′ − ρ′ R T∞ − ρ∞ T∞ (R − R∞)) / (ρ R), with R = R(φ), ρ = ρ∞ + ρ′.

**Pressure from temperature**: p′ = ρ′ R∞ T∞ + ρ R∞ T′ + ρ (R − R∞) T.

**Speed of sound**: c² = cp R T / (cp − R) at T = T∞ + T′.

## 4. State and gauge variables (`src/flow/reference/state.ts`)

Each cell stores six conserved values per unit volume:

| k | U_k | meaning |
|---|---|---|
| 0 | ρ′ = ρ − ρ∞ | density gauge |
| 1 | ρu | axial momentum |
| 2 | ρv | radial momentum |
| 3 | ρ r w | angular momentum (r u_θ is the specific angular momentum) |
| 4 | η = ρE − ρ h0∞ + p∞ = ρ(h0 − h0∞) − p′ | energy gauge |
| 5 | ρZ | fuel mass |

**Why gauges (f32).** An f32 carries 24 bits (relative 6e-8).
- *Exact ambient.* In the ambient every gauge value, every primitive gauge (ρ′, p′, T′), every face flux and every source is an **exact zero**, independent of metric rounding: with absolute p, a cell's pressure fluxes would sum to p∞ Σ S_f, which is zero only to the f32 rounding of the metrics (p∞ · 6e-8 · |S| per face), a spurious force that never goes away. Ladder L1 (quiescent) is therefore bitwise exact on the GPU.
- *Perturbation precision.* ρ′, p′ and T′ keep 24 bits of the perturbation itself: a 1 Pa wave is resolved to 6e-8 Pa, where p would quantise at 0.008 Pa (and ρ at 7e-8 kg/m³, which is the density signal of a 2e-5 m/s acoustic velocity).
- *Same encoding as the render textures (D0-4):* (p − p∞)/p∞ and (ρ − ρ∞)/ρ∞ are p′/p∞ and ρ′/ρ∞.

**Conserved → primitive** (`consToPrim`): ρ = ρ∞ + U0; u = U1/ρ; v = U2/ρ; (rw) = U3/ρ; Z = U5/ρ; w = (rw)/r_c; q² − q∞² = (u − u∞)(u + u∞) + v² + w²; Δe* = (U4 + ρ′ R∞ T∞ − ½ρ(q² − q∞²)) / ρ; T′ from Δe* (§3, 3 Newton steps); p′ from T′ (§3); c from T. The cell primitive vector is **q = (ρ′, u, v, rw, p′, Z)**.

**Primitive → conserved** (`primToCons`): T′ from (p′, ρ′, φ) (§3), then U4 = ρ Δe(T′, φ) − ρ′ R∞ T∞ + ½ρ(q² − q∞²) and the obvious others.

## 5. Ghost fill and boundary conditions (`src/flow/reference/boundary.ts`)

Each stage first converts every cell to primitives, then fills every ghost from its source cell's primitives q_s:

| code | BC | ghost primitives |
|---|---|---|
| 0 | interface | q_s (a plain copy; the neighbour's cell) |
| 1 | slip wall | from the wall cell q₀ and the next cell inwards q₁ (the two layers' sources): ρ′, rw, p′, Z and the tangential velocity extrapolated linearly (layer 1: 2q₀ − q₁, layer 2: 3q₀ − 2q₁), the normal velocity mirrored (−vn₀, −vn₁); the wall face itself carries only the wall pressure (§7) |
| 2 | axis | v → −v; everything else copied (rw is even across the axis) |
| 3 | far field | linearised characteristics about the free stream (below) |
| 4 | inflow | total conditions (below) |
| 5 | outflow | static pressure (below) |

**Far field (3)**, linearised about the free stream (ρ∞, u∞, c∞) with the outward normal n and tangent t = (−n_r, n_x): from the source cell, δu = (u − u∞, v), δu_n = δu·n, δu_t = δu·t, and the characteristic values w₊ = p′ + ρ∞c∞ δu_n, w₋ = p′ − ρ∞c∞ δu_n, w_s = p′ − c∞² ρ′. With vn∞ = u∞ n_x: keep w₊ if vn∞ + c∞ > 0, else 0; keep w₋ if vn∞ − c∞ > 0, else 0. Then p′_b = (w₊ + w₋)/2 and δu_n,b = (w₊ − w₋)/(2ρ∞c∞). If vn∞ + δu_n,b ≥ 0 (outflow) w_s, δu_t, rw and Z come from the cell, else they are the free stream's (w_s = 0, δu_t = 0, rw = 0, Z = 0). ρ′_b = (p′_b − w_s)/c∞², (u, v)_b = (u∞, 0) + δu_n,b n + δu_t t. It returns the free stream exactly for a free-stream cell.

**Far field under low-Mach preconditioning** (tracking mode with `lowMachPreconditioning`, §10): the characteristics are those of the preconditioned pseudo-time system at the free stream, β∞² = min(1, max(M∞², minMach²)): with λ± = ½((1 + β∞²) vn∞ ± sqrt((1 − β∞²)² vn∞² + 4 β∞² c∞²)) and a± = ρ∞(λ± − β∞² vn∞), w± = p′ + a± δu_n (kept from the cell where λ± > 0, else 0), δu_n,b = (w₊ − w₋)/(a₊ − a₋), p′_b = w₊ − a₊ δu_n,b; the rest as above. β∞² = 1 gives the physical form (a± = ±ρ∞c∞). With the physical characteristics the preconditioned iteration diverged (a far-field duct at M 0.01: ×7000 in 4000 iterations, NaN in 12 with an axis; the L7 sphere at M 0.01: NaN at iteration 74), because they reflect the slow pseudo-time acoustic waves. **This changes the steady state at the far-field boundary** by the difference of the two non-reflecting relations, which is of the order of the steady perturbation that reaches the boundary; the physical-time mode keeps the physical far field. Decision D4-22 accepts it for tracking mode, provided the shift stays at most a tenth of each ladder case's tolerance; only the preconditioned cases (L7, L8) can see it, and the handoff gives the measured shift (the preconditioned run with M_cut = 1, i.e. no D4-20 scaling, against the plain run, both converged).

**Inflow (4)**, subsonic, at the total conditions (p0, T0) (default: the free stream's), flow along the inward normal −n (axial on the domain's x = x_in plane), no swirl, Z = 0. The ghost lies on the (p0, T0) isentrope at the speed σ ≥ 0 for which the cell's **outgoing characteristic** w₊ = p′_s + ρ_s c_s u_n,s (u_n,s = (u, v)_s·n, n outward) reaches the ghost unchanged: p′_b(σ) − ρ_s c_s σ = w₊. Given σ, the static temperature is T_b = T0 + τ with h(T0 + τ) − h(T0) = −σ²/2 (the divided difference of §3; 3 Newton steps from τ_0 = −σ²/(2 cp(T0))), and p′_b(σ) = (p0 − p∞) + p0 expm1((φ_s(T_b) − φ_s(T0))/R_a), φ_s the entropy function (∫ cp/T). σ itself takes 3 Newton steps from σ_0 = max(0, −u_n,s): σ ← max(0, σ + (p′_b(σ) − ρ_s c_s σ − w₊)/(ρ_b σ + ρ_s c_s)), ρ_b = (p∞ + p′_b)/(R_a T_b); then τ and p′_b are evaluated once more at the final σ, so the ghost's totals are (p0, T0) to the Newton accuracy of τ. Ghost: (u, v) = −σ n, rw = 0, Z = 0, ρ′_b = (p′_b − ρ∞ R_a (T_b − T∞))/(R_a T_b). If the free stream is supersonic (u∞ ≥ c∞), the ghost is the free stream. **Why the characteristic, not the static pressure from inside** (the first version): with p_b = p_s the ghost's speed answers a pressure change with dσ = −dp/(ρσ), a feedback of rate c²/(σ Δx), 1/M times what the acoustic time step covers. The plain scheme left its own steady state by 1e13 in 10 iterations in a M 0.06 duct, and at M 0.3-0.4 the feedback sits just past the RK3 stability limit, which stalled the residual of ladder L4b and L9a. With the characteristic the gain is dσ = −dp/(ρc + ρσ), an acoustic rate.

**Outflow (5)**: if the source cell's outward normal velocity is below its speed of sound ((u, v)·n < c_s), p′_b = p_out − p∞ (default p_out = p∞) and everything else is copied; otherwise everything is copied (supersonic outflow).

**Per-test BC remap.** `SolverOptions.bcRemap` maps a code to another before the table is applied (for example slip wall → far field for ladder L1's uniform flow, which has no wall solution). The default is the identity; the GPU kernel never needs it except for L1.

**Why the wall ghost is extrapolated, not mirrored.** The W0 mirror ghost copies p, which imposes dp/dn = 0 at the wall. Wherever swirl or wall curvature sets a pressure gradient normal to the wall (ρw²/r behind every rotor, ρu²/R on every curved duct wall) that makes the wall pressure first order and leaves an odd-even wall mode: ladder L6 failed with it (radial-equilibrium error 1.3 % of q for the free vortex, 72 Pa at the inner wall), and the extrapolated ghost brings it to 3 Pa. Mirroring the Cartesian (u, v) also let mass leak through walls not aligned with x or r, because MUSCL limits u and v separately; the pressure-only wall flux makes the wall impermeable in any orientation.

Blockage of a ghost: b of its source cell. Both ghost layers are filled the same way, each from its own source cell.

## 6. Reconstruction (`src/flow/reference/muscl.ts`)

Dimension-split MUSCL on the primitive vector q = (ρ′, u, v, rw, p′, Z), in index space (no distance weighting; stretching is ≤ 1.15):

- **van Albada limited slope** of cell i along a grid line: σ_i = φ(q_i − q_{i−1}, q_{i+1} − q_i) per component, φ(a, b) = ab(a + b)/(a² + b² + 1e-30) if ab > 0, else 0. φ is symmetric and odd, so the two sides of an interface compute bitwise-equal face states whatever the blocks' index orientation.
- **Face states**: the face between cells i and i+1 gets q_L = q_i + ½σ_i and q_R = q_{i+1} − ½σ_{i+1}.
- **Positivity fallback, per cell and per direction**: if either of the cell's two face values in this direction (q_i ± ½σ_i) has ρ∞ + ρ′ ≤ 0 or p∞ + p′ ≤ 0, all six slopes of that cell in that direction are set to 0 (first order). It is per cell, not per face side, so a cell never sends different states to its two faces. It is not shared across directions on purpose: a cell's j-slope at a block boundary would need corner ghosts, which the neighbour block (computing the same face through its ghost copy of the cell) does not have, and the two sides of an interface would then compute different fluxes.
- **Stencil**: the i-face between i−1 and i uses cells i−2..i+1 (ghosts outside the block); the j-faces likewise. Corner ghosts are never read (W0M-N4).

Known limitation (W1M-N5): grid lines kink by up to 52° at some interfaces (lip, plume-outer, far field). Index-space MUSCL across a kink is formally first order there.

## 7. Flux: SLAU2 (`src/flow/reference/slau2.ts`)

SLAU2 (Kitamura & Shima, J. Comput. Phys. 245 (2013) 62-83; mass flux from SLAU, Shima & Kitamura, AIAA J. 49 (2011)). For the face vector S (|S| > 0), n = S/|S|, face radius r_f, and the two face states (each side: ρ = ρ∞ + ρ′, w = rw/r_f, T′ by §3 from (p′, ρ′, Z), c, Δh by §3):

```
vn = u n_x + v n_r ;  q² = u² + v² + w² ;  dh0 = Δh(T′, φ) + ½((u − u∞)(u + u∞) + v² + w²)
c̄ = (c_L + c_R)/2 ;  M_L = vn_L/c̄ ;  M_R = vn_R/c̄
q̄ = sqrt((q²_L + q²_R)/2) ;  M̂ = min(1, q̄/c̄) ;  χ = (1 − M̂)²
g = −max(min(M_L, 0), −1) · min(max(M_R, 0), 1)
V̄ = (ρ_L |vn_L| + ρ_R |vn_R|)/(ρ_L + ρ_R) ;  V̄⁺ = (1 − g)V̄ + g|vn_L| ;  V̄⁻ = (1 − g)V̄ + g|vn_R|
ṁ = ½(ρ_L(vn_L + V̄⁺) + ρ_R(vn_R − V̄⁻) − (χ/c̄)(p′_R − p′_L))
β±(M) = ¼(2 ∓ M)(M ± 1)² if |M| < 1, else ½(1 ± sign M)
p̃ = ½(p′_L + p′_R) + ½(β⁺(M_L) − β⁻(M_R))(p′_L − p′_R) + q̄ (β⁺(M_L) + β⁻(M_R) − 1) ½(ρ_L + ρ_R) c̄
ṁ⁺ = ½(ṁ + |ṁ|) ;  ṁ⁻ = ½(ṁ − |ṁ|)
F = |S| · (ṁ⁺ + ṁ⁻,  ṁ⁺u_L + ṁ⁻u_R + p̃ n_x,  ṁ⁺v_L + ṁ⁻v_R + p̃ n_r,  ṁ⁺rw_L + ṁ⁻rw_R,  ṁ⁺dh0_L + ṁ⁻dh0_R,  ṁ⁺Z_L + ṁ⁻Z_R)
```

The energy component is the η flux ṁ(h0 − h0∞); pressures are gauges (p′).

**Low-Mach dissipation scaling (tracking mode with `lowMachPreconditioning` only; decision D4-20).** The pressure-diffusion term of ṁ is divided by f_a:

```
M_ref = min(1, max(q̄/c̄, M_cut)) ;  f_a = M_ref (2 − M_ref)
ṁ = ½(ρ_L(vn_L + V̄⁺) + ρ_R(vn_R − V̄⁻) − (χ/(c̄ f_a))(p′_R − p′_L))
```

(code order: `fa = mRef * (2 - mRef)`, then `chi / (cbar * fa)`; f_a and q̄ are symmetric in L and R, so the antisymmetry stays bitwise, and f_a = 1 exactly when M_ref = 1, so the unscaled flux is bitwise the plain one). *Why:* SLAU's mass-flux pressure diffusion −(χ/2c̄)Δp is O(M) of the mass flux at low Mach (Δp ~ ρq² gives (χ/2c̄)Δp ~ ρq · M/2), so pressure and velocity decouple as M → 0: the odd-even wall-pressure sawtooth of ladder L7 (0.15 q) and the radial ±1.4 % mode of L8, and L7's non-convergence (the sawtooth's only damping was this term). Divided by f_a ≈ 2M_ref it is ~ ρq/4 · Δp/(ρq²), O(1) like an incompressible (Rhie-Chow) coupling, matched to the preconditioned pseudo-time derivative whose acoustic speed is O(M_ref c). This is AUSM+-up's 1/f_a(M_o), f_a = M_o(2 − M_o) (Liou, J. Comput. Phys. 214 (2006) 137-170), and the Weiss-Smith/Turkel preconditioned dissipation. Transonic and supersonic faces (q̄ ≥ c̄) have f_a = 1 and are unchanged.

**M_cut** (option `lowMachPreconditioning.machCut`, default = `minMach`): below M_cut the diffusion is held at 1/f_a(M_cut), so a stagnation point or dead air does not get an unbounded pressure diffusion. The default ties it to the preconditioner's cutoff: the scaled diffusion has a pseudo-time rate of about β²c/(8 M_ref Δx) against the step Δx/(βc), i.e. β/(8 M_ref) per step, which stays O(1/8) only while M_ref is not far below β. The same argument is why the scaling is **off without preconditioning** (β = 1: 1/(8 M_cut)) and **off in physical time** (the acoustics are wanted there). The engine (W3, static engine, free stream at rest) runs with **minMach = M_cut = 0.003**: the slowest part of the engine's flow that must be coupled is the far-field suction of the static engine, about 1 m/s (§13), M 0.003 at c∞ = 340 m/s; every faster region (inlet, ducts, jets, entrainment) gets M_ref = its own Mach number. The ladder uses the case's own reference Mach: L7 M_cut = minMach = M∞; L8 (at rest, 0.07-1.9 m/s at the measured radii) the engine's 0.003. The steady state depends on M_cut through a term of the order of the reconstructed jump Δp (second order in smooth flow); the handoff reports the sensitivity (M_cut × ½ and × 2) on L7 and L8.

**Slip-wall faces** do not use SLAU2: F = |S| (0, p′_w n_x, p′_w n_r, 0, 0, 0), with p′_w the wall cell's reconstructed face value of p′ at the wall (q₀ ± ½σ₀, its slope taken with the extrapolated ghost). Mass, angular momentum, energy and fuel fluxes through a wall are exact zeros. Written this way, F(L, R, S) = −F(R, L, −S) **bitwise**, which makes the max/max interfaces (bitwise-negated face vectors) exactly conservative too. For equal states F reduces to the physical flux (ρ vn, ρu vn + p′n_x, ...), which the tests check.

## 8. Blockage and volume sources (`src/flow/reference/sources.ts`): the W3 interface

**Blockage.** A per-cell field b_c ∈ (0, 1] (default 1). Face blockage b_f = ½(b_L + b_R) of the two cells (a ghost has its source cell's b, so a boundary face gets b_c). Every face flux is multiplied by b_f, the cell's gas volume is b_c V_c, and the local time step uses b-weighted face vectors (§10).

**Pressure and swirl source** (the geometric term, `geometricSource`): for cell c with primitives q_c,

```
P_c,x = p′_c Σ_f b_f S_f,x
P_c,r = p′_c Σ_f b_f S_f,r + b_c ρ_c w_c² A_c          (w_c = rw_c / r_c)
```

with S_f the cell's **outward** face vectors. For b ≡ 1 this is (0, p′A + ρw²A), the axisymmetric source, because Σ S_f = (0, A). With blockage it adds the force of the blade metal on the gas, p ∇b, in the form that balances a uniform pressure exactly: Σ_f b_f p′ S_f − p′ Σ_f b_f S_f = 0. The gauge p′ is used in both, so the p∞ parts cancel identically.

**Volume sources.** A source model (`SourceModel`) is called once per RK stage with the stage's primitives. Per cell it writes:
- `rate` s_c (6 values): conserved-gauge component rates per unit **gas** volume (kg/(m³ s), N/m³, N/m³, N m/m³, W/m³, kg/(m³ s)), for U = (ρ′, ρu, ρv, ρrw, η, ρZ). Since η = ρE − ρh0∞ + p∞, an energy source s_E and a mass source s_m give **s_η = s_E − h0∞ s_m**. A mass source at the local state carrying its stagnation enthalpy h0 (bleed, cooling flow) therefore has s_η = s_m (h0 − h0∞); helper `massSourceRates`.
- `damping` d_c (6 values, ≥ 0, 1/s): the diagonal of −∂s/∂U, for the point-implicit update. 0 means explicit.

The cell integral of a source is b_c V_c s_c. Body forces of a blade row (W3, Hall–Thollet) enter as s_1 = ρf_x, s_2 = ρf_r, s_3 = ρ r f_θ and s_4 = ρ(u f_x + v f_r + w f_θ) (or Ω s_3 for the Euler-work form); the combustor as s_4 = heat release per volume and s_5 = fuel per volume.

## 9. Residual

For each cell, with outward face fluxes F_f (§7, times b_f):

```
R_c = Σ_f b_f F_f − (0, P_c,x, P_c,r, 0, 0, 0) − b_c V_c s_c
```

The kernel computes each face flux once per face and adds it to both cells (+ for the cell on the −side of the face's vector, − for the other); at interfaces both blocks compute the face and each keeps its own side.

## 10. Time stepping (`src/flow/reference/solver.ts`)

**Local time step** (stage 1 of each iteration, from the stage-1 primitives): with s_w, s_e the cell's i-faces and s_s, s_n its j-faces (face vectors as stored, not outward),

```
λ_c = max(b_w(|u·s_w| + c|s_w|), b_e(|u·s_e| + c|s_e|)) + max(b_s(...s_s), b_n(...s_n))
τ_c = CFL / λ_c        (= dt_c / (b_c V_c))      dt_c = τ_c b_c V_c
```

The max over the two faces (not their average, as in the W0 spike) keeps the axis cells stable: an axis cell has one radial face of area r̄L, and its effective width is V/|S_n| = Δr/2.

**Tracking mode: 3-stage RK with local time steps**, α = (0.2, 0.5, 1.0), from U⁰ = Uⁿ:

```
U^(k) = Uⁿ − α_k τ_c (R_c(U^(k−1)) ) / (1 + α_k dt_c d_c)        k = 1, 2, 3 (componentwise)
```

**The coefficients are not the W0 spike's** (0.1918, 0.4929, 1.0; van Leer, Tai & Powell 1989). A linear (von Neumann) analysis of the 3-stage scheme G(z) = 1 + z + α₂z² + α₁α₂z³ with this MUSCL (κ = 0 in smooth regions, whose dissipation is O(θ⁴)) shows that α₂ < ½ leaves |G| > 1 near the origin of the imaginary axis: the spike's set is unstable for long waves at any CFL (growth 1.3e-4 per iteration at CFL 1, 1.5e-3 at CFL 1.5). With α₂ = ½, α₁ = 0.2 the stability limit is **CFL 1.54** for the second-order scheme and 1.86 for first order (`tests/unit/flow/rk.test.ts` repeats the analysis and pins both sets, decision D4-8). The default tracking CFL is **1.5**; the brief's range 1.5-1.8 is stable only where the limiter goes first order.

**Low-Mach preconditioning (tracking mode only; decision D4-10).** Without it the pseudo-time step is set by the acoustic speed |u| + c while the flow converges at the convective speed |u|, so the iterations to converge grow like 1/M (ladder L7: the M 0.01 sphere did not converge in 20000 iterations, the M 0.3 sphere took 3096). The option `lowMachPreconditioning: { minMach }` multiplies the pseudo-time derivative of the pressure by 1/β² (Turkel's preconditioner with α = 0 in the variables (p, u, v, rw, s, Z), equivalent for this gas to Weiss & Smith 1995). Per cell, from the stage-1 primitives and frozen for the three stages like τ:

```
β²_c = min(1, max((u² + v² + w²)/c², minMach², Δp_c/(ρ c²)))      Δp_c = max over the 4 face neighbours |p′_nb − p′_c|
```

The pressure term (Weiss, Maruszewski & Smith 1999, their ε|Δp/ρ|^½ limit of the reference velocity) keeps the preconditioner off where a pressure difference drives a flow that has not started yet: a duct started from rest with a 1 % pressure drop diverged without it. The neighbours are the stage-1 primitives of the cell's four face neighbours (ghosts included, after their BCs).

The local time step uses the preconditioned spectral radius of each face, in place of |u·s| + c|s|:

```
λ_f = b_f |s| ½((1 + β²)|vn| + sqrt((1 − β²)² vn² + 4 β² c²))        vn = u·s/|s|
```

(β² = 1 gives |vn| + c). After the point-implicit division, the stage increment δU_c = U^(k) − Uⁿ of each cell is replaced by

```
δp = R T δρ′ + (R/c_v)(δη + (R∞T∞ + ½(q∞² + q²) − Δe) δρ′ − u δ(ρu) − v δ(ρv) − w δ(ρrw)/r_c)
δU ← δU − (1 − β²) (δp / c²) (1, u, v, rw, Δh0, Z)
```

with the cell's (stage-k primitive) values: R = R(φ), c_v = cp(T, φ) − R, Δe = Δe(T′, φ), Δh0 = Δh(T′, φ) + ½(q² − q∞²), c² from §3. δp is the frozen-composition pressure differential of δU (δ(ρZ) does not enter), and (1/c²)(1, u, v, rw, Δh0, Z) is ∂U/∂p at constant (u, v, rw, s, Z); the two contract to exactly 1, so the update scales the pressure increment by β² and leaves the velocity, swirl, entropy and fuel increments unchanged. The ambient stays an exact zero (δU = 0 gives δp = 0). **The steady state does not change**: δU = 0 exactly when R = 0, and the update matrix is invertible for β² > 0 (`tests/unit/flow/precondition.test.ts` checks a converged low-Mach blockage channel with and without it). The physical-time mode is never preconditioned. Two parts of the preconditioned tracking mode do change the steady state, both by decision: SLAU2's mass-flux pressure diffusion is scaled by 1/f_a (§7, D4-20, which amends D4-10's "SLAU2 keeps its own dissipation"), and the far-field BC uses the preconditioned characteristics (§5, D4-22). With `machCut ≥ 1` the first is off, and the steady state is then the plain scheme's except at the far field (the test above uses that).

**Physical-time mode: SSP-RK3** (Shu & Osher 1988) at one global dt:

```
E(U) = U − τ (R(U)) / (1 + dt d)        τ = dt / (b_c V_c)
U¹ = E(Uⁿ) ;  U² = ¾Uⁿ + ¼E(U¹) ;  Uⁿ⁺¹ = ⅓Uⁿ + ⅔E(U²)
```

The default dt is CFL_phys · min_c(b_c V_c/λ_c) with CFL_phys = 0.9 (the RK3 limit for this MUSCL is 1.17); a caller may give dt.

**Point-implicit sources.** Both modes divide the stage increment by (1 + α dt d) componentwise. A steady state (R = 0, sources included) does not depend on d.

**The centrifugal source is explicit (D4-23 examined, 2026-10-27).** D4-23 asked for a point-implicit centrifugal/Coriolis source with its Jacobian for ladder L9a's stall at CFL 1.5. In the variables of §4 the swirl source is only b ρw²A = b A (ρrw)²/(ρ r_c²) in the radial momentum: its Jacobian has the two entries ∂/∂(ρrw) = 2w/r_c² and ∂/∂ρ′ = −w²/r_c, both in the ρv row, and no diagonal entry, so it is nilpotent (J² = 0): (I − α dt J)⁻¹ = I + α dt J adds a coupling but no damping. The u_r u_θ (Coriolis) coupling has no source here at all: ρ r w is conserved and the coupling is the flux ρ v (rw). Measured in L9a at CFL 1.5 (6000 iterations): the residual sits at 3.0e-4 of the peak without and 3.2e-4 with the point-implicit Jacobian. The rate it would damp is small anyway (2w/r · dt ≈ 0.003), and D4-23's fallback, a local step Δt ≤ C r/|u_θ|, would bind only for C ≲ 0.002. The stall is the limiter instead (see the handoff): with the slopes of u or of p′ unlimited, or with the smooth van Albada form (ε > 0), L9a converges to 1e-10 at CFL 1.5. That is a scheme change and waits for a decision, so §6 is unchanged and the kernel needs no swirl Jacobian.

## 11. Diagnostics

`residualDensityL2` = sqrt(mean_c (R_c,0 / (b_c V_c))²) from stage 1, kg/(m³ s) (`FlowStepStats.residualDensityL2`).

## 12. Where f32 differs, and what w2/solver must meet

### 12.1 Expected f32 differences
- **Exact in f32 as in f64**: the quiescent ambient (every flux, source and BC value is an exact zero, ladder L1 quiescent is bitwise) and the conservation across interfaces (bitwise-equal or negated face fluxes, §7). The wall fluxes of mass, angular momentum, energy and fuel are exact zeros too (pressure-only wall flux, §7).
- **Rounding-level in f32**: the free stream with u∞ ≠ 0 (u = (ρu)/ρ is not bitwise u∞), the 3-step Newton (converges to about 1e-7 relative instead of 1e-15), the inflow BC (sqrt of an enthalpy difference), pow/log in the inflow isentrope.
- **Metric rounding** (12.3): the f32 asset's Σ S_x is not zero. This affects the f64 oracle and the GPU equally, since both read the same metrics.
- **Accumulation order**: the kernel's per-face accumulation order may differ from the oracle's; sums agree to rounding.
- **Limiter switches**: ab > 0 and the positivity test are discontinuous; near a shock or an extremum, an ulp can flip a branch and the two runs then differ locally by O(the jump) for a few iterations.

### 12.2 Tolerances for the GPU kernel against the oracle (W0G-N4)

Protocol: the same mesh asset (130k, f32 metrics) and the same f32-representable initial state on both, the same options; compare after N iterations. For each primitive field q ∈ (ρ′, u, v, rw, p′, Z) and T′, the **relative error** is e_q = max_c |q_GPU − q_ref| / S_q with the perturbation scale S_q = max_c |q_ref − q∞| (velocity components share S = max |(u − u∞, v, w)|).

| case | N | must hold |
|---|---|---|
| A. quiescent ambient, real mesh | 1, 100 | every state value bitwise 0 |
| B. uniform M 0.5, real mesh, walls remapped to far field | 100 | max |u − u∞| ≤ 10 × the oracle's (the oracle's is a property of the f32 metrics, 12.3) |
| C. smooth field on the real mesh (acoustic pulse + swirl + a hot fuel-air spot; `tests/ladder/oracle.ts` `smoothPerturbation`), tracking | 1 / 10 / 100 | e_q ≤ 1e-5 / 1e-4 / 1e-3 |
| C, physical time (SSP-RK3, the oracle's dt) | 1 / 10 / 100 | e_q ≤ 1e-5 / 1e-4 / 1e-3 |
| D. Sod tube (ladder L2 set-up), physical time | 100 | L1 relative error of ρ′ and p′ ≤ 1e-3 (limiter switches, 12.1) |
| E. a blockage + source cell set (ladder L5/L8/L9 set-ups) | 10 | e_q ≤ 1e-4 |
| any | any | the residual L2 within 1e-3 relative of the oracle's |

Basis: f32 has a relative step of 6e-8; one iteration rounds each face flux and cell update a few dozen times, and the gauges keep that relative to the perturbation, so one iteration lands near 1e-6 and growth is at most linear over N for a stable smooth run. The f32-storage experiment in `tests/ladder/f32.test.ts` (the oracle with its state rounded to f32 after every stage) measures the storage part of this on case C, and the table sits ≥ 10× above it. Measured (2026-10-27, closed box per D4-12: slip walls and the axis, so the pulse stays in the domain): tracking 1.9e-7 / 4.4e-7 / 1.4e-6 after 1 / 10 / 100 iterations, physical time 8.4e-8 / 2.4e-7 / 1.3e-5, so every row, the N = 100 rows included, sits 54-720× above the storage error. A tolerance changes only through an orchestrator decision.

### 12.3 The f32 metrics and ladder L1
The f32 asset rounds the face vectors, so a cell's Σ S_x is not zero but of order 6e-8 |S|. In uniform flow that is a residual F∞ Σ S_x in every cell, and the steady state carries a perturbation that grows along streamlines. `tests/ladder/l1.test.ts` reports the asset's worst Σ S_x defect and the spurious velocity the oracle develops with the f32 asset. If it exceeds L1's 1e-4 m/s, the remedy belongs to the mesh asset (f64 metrics, about 5 MB more at 130k, or face vectors computed so that their f32 sums telescope exactly), not to the kernel.

## 13. Notes for W3

- **The far field at static conditions.** The linearised far field (3) imposes w₋ = 0, which for a steady inflow of speed |u_n| through the boundary means p′_b ≈ −ρ∞c∞|u_n|: with the static engine's suction at the far-field boundary (about 1 m/s), the whole field sits a few hundred pascals low. The upstream inflow boundary (4) uses total conditions and has no such offset. If L12 shows the offset, switch the lateral far field to total conditions on inflow faces too.
- **Corner ghosts** (W0M-N4): none; the v1 plume eddy viscosity must build its face gradients from the cells the dimension-split stencil reads.
- **Interface kinks** (W1M-N5): see §6.
