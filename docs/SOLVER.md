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
| 1 | slip wall | from the wall cell q₀ and the next cell inwards q₁ (the two layers' sources): ρ′ and Z mirrored (layer 1: q₀, layer 2: q₁; D5-5), rw, p′ and the tangential velocity extrapolated linearly (layer 1: 2q₀ − q₁, layer 2: 3q₀ − 2q₁), the normal velocity mirrored (−vn₀, −vn₁); the wall face itself carries only the wall pressure (§7) |
| 2 | axis | v → −v; everything else copied (rw is even across the axis) |
| 3 | far field | linearised characteristics about the free stream (below) |
| 4 | inflow | total conditions (below) |
| 5 | outflow | static pressure; a backflow face takes the inflow ghost at (p_out, T∞) (below) |

**Far field (3)**, linearised about the free stream (ρ∞, u∞, c∞) with the outward normal n and tangent t = (−n_r, n_x): from the source cell, δu = (u − u∞, v), δu_n = δu·n, δu_t = δu·t, and the characteristic values w₊ = p′ + ρ∞c∞ δu_n, w₋ = p′ − ρ∞c∞ δu_n, w_s = p′ − c∞² ρ′. With vn∞ = u∞ n_x: keep w₊ if vn∞ + c∞ > 0, else 0; keep w₋ if vn∞ − c∞ > 0, else 0. Then p′_b = (w₊ + w₋)/2 and δu_n,b = (w₊ − w₋)/(2ρ∞c∞). If vn∞ + δu_n,b ≥ 0 (outflow) w_s, δu_t, rw and Z come from the cell, else they are the free stream's (w_s = 0, δu_t = 0, rw = 0, Z = 0). ρ′_b = (p′_b − w_s)/c∞², (u, v)_b = (u∞, 0) + δu_n,b n + δu_t t. It returns the free stream exactly for a free-stream cell.

**Far field under low-Mach preconditioning** (tracking mode with `lowMachPreconditioning`, §10): the characteristics are those of the preconditioned pseudo-time system at the free stream, β∞² = min(1, max(M∞², minMach²)): with λ± = ½((1 + β∞²) vn∞ ± sqrt((1 − β∞²)² vn∞² + 4 β∞² c∞²)) and a± = ρ∞(λ± − β∞² vn∞), w± = p′ + a± δu_n (kept from the cell where λ± > 0, else 0), δu_n,b = (w₊ − w₋)/(a₊ − a₋), p′_b = w₊ − a₊ δu_n,b; the rest as above. β∞² = 1 gives the physical form (a± = ±ρ∞c∞). With the physical characteristics the preconditioned iteration diverged (a far-field duct at M 0.01: ×7000 in 4000 iterations, NaN in 12 with an axis; the L7 sphere at M 0.01: NaN at iteration 74), because they reflect the slow pseudo-time acoustic waves. **This changes the steady state at the far-field boundary** by the difference of the two non-reflecting relations, which is of the order of the steady perturbation that reaches the boundary; the physical-time mode keeps the physical far field. Decision D4-22 accepts it for tracking mode, provided the shift stays at most a tenth of each ladder case's tolerance; only the preconditioned cases (L7, L8) can see it, and the handoff gives the measured shift (the preconditioned run with M_cut = 1, i.e. no D4-20 scaling, against the plain run, both converged). Measured on the M 0.3 sphere (L7 set-up, both to 1e-6, 2026-10-27): max |ΔCp| 4.0e-4, ΔCd 2.8e-6, Δ(asymmetry) 8.7e-6, against tenths of the tolerances of 2e-3 and 1e-3: accepted. (The 2.3e-3 the handoff reported before was the 1e-4 convergence level, not the BC.)

**Inflow (4)**, subsonic, at the total conditions (p0, T0) (default: the free stream's), flow along the inward normal −n (axial on the domain's x = x_in plane), no swirl, Z = 0. The ghost lies on the (p0, T0) isentrope at the speed σ ≥ 0 for which the cell's **outgoing characteristic** w₊ = p′_s + ρ_s c_s u_n,s (u_n,s = (u, v)_s·n, n outward) reaches the ghost unchanged: p′_b(σ) − ρ_s c_s σ = w₊. Given σ, the static temperature is T_b = T0 + τ with h(T0 + τ) − h(T0) = −σ²/2 (the divided difference of §3; 3 Newton steps from τ_0 = −σ²/(2 cp(T0))), and p′_b(σ) = (p0 − p∞) + p0 expm1((φ_s(T_b) − φ_s(T0))/R_a), φ_s the entropy function (∫ cp/T). σ itself takes 3 Newton steps from σ_0 = max(0, −u_n,s): σ ← max(0, σ + (p′_b(σ) − ρ_s c_s σ − w₊)/(ρ_b σ + ρ_s c_s)), ρ_b = (p∞ + p′_b)/(R_a T_b); then τ and p′_b are evaluated once more at the final σ, so the ghost's totals are (p0, T0) to the Newton accuracy of τ. Ghost: (u, v) = −σ n, rw = 0, Z = 0, ρ′_b = (p′_b − ρ∞ R_a (T_b − T∞))/(R_a T_b). If the free stream is supersonic (u∞ ≥ c∞), the ghost is the free stream. **Why the characteristic, not the static pressure from inside** (the first version): with p_b = p_s the ghost's speed answers a pressure change with dσ = −dp/(ρσ), a feedback of rate c²/(σ Δx), 1/M times what the acoustic time step covers. The plain scheme left its own steady state by 1e13 in 10 iterations in a M 0.06 duct, and at M 0.3-0.4 the feedback sits just past the RK3 stability limit, which stalled the residual of ladder L4b and L9a. With the characteristic the gain is dσ = −dp/(ρc + ρσ), an acoustic rate.

**Outflow (5)**, with vn = (u, v)_s·n the source cell's outward normal velocity: if 0 ≤ vn < c_s, p′_b = p_out − p∞ (default p_out = p∞) and everything else is copied; if vn ≥ c_s, everything is copied (supersonic outflow); **if vn < 0 (backflow: the flow enters through the face), the ghost is the inflow ghost (4) at the backflow totals (p0, T0) = (p_out, T∞)**: no swirl, Z = 0, along the inward normal, at the speed σ ≥ 0 for which the cell's outgoing characteristic reaches the ghost unchanged (the same 3 + 3 Newton steps). The supersonic free stream of (4) does not apply here. (The kernel: `outflow` and `subsonicInflow` in wgsl/boundary.ts, with the backflow totals from the uniforms pOut, pOutGauge, tInf and cpaInf.)

*Why the backflow branch (W2S-B1, §16).* What enters through an outflow face comes from beyond the boundary, where the gas is the ambient at rest at p_out and T∞; so a backflow face is an inflow face at those total conditions (the standard pressure-outlet backflow treatment: the outlet's static pressure is the backflow's total pressure, with an ambient backflow total temperature and composition). The copy it replaces specified all four incoming characteristics of a subsonic inflow (u, v, s, Z) by extrapolation from the cell, so the face fed the cell's own state back in: its momentum, total enthalpy and fuel. With p_b fixed the inflowing total pressure is p_out + ½ρvn², so the faster the backflow, the more total pressure and total enthalpy the face supplies: a positive feedback with no physical source. On the engine mesh the look-dev page's start state (perfState) reversed the jet at the outflow in the preconditioned pseudo-time transient, the reversed jet reached 640 m/s on the axis, and the hot plume gas it recycled reached T′ 1070 K at the outflow corner and the core nozzle, where it diverged (§16). With the backflow branch the face draws ambient gas at a speed set by the pressure difference alone, and the same start comes to rest. A face with vn ≥ 0 is bitwise unchanged. At vn → 0⁻ the ghost's temperature and composition switch to the ambient's, the upwind value for an entering flow; its pressure and velocity are continuous with the outflow's **only for a cell at p_out** (σ → 0, p′_b → p_out − p∞). *For p_s ≠ p_out the face's response jumps across vn = 0 (W2S-N2, critic pass 19):* the outflow ghost (u_s, p_out) puts p_out at the face only halfway, so the face velocity is about u_s + (p_s − p_out)/(2ρc), while the backflow ghost is the boundary state itself and the face velocity is −σ, about (p_s − p_out)/(ρc). The face's mass flux doubles its response across vn = 0, on a switch a face can chatter across. Nothing shows it in the rows of record (D4-63's rest state decays faster with the branch), but a limit cycle in a D4-63-type residual at an outflow is the first suspect.

*The backflow totals are the static-ambient form (W2S-N3).* (p_out, T∞) with no swirl and Z = 0 is the ambient at rest beyond the exit, in the engine's frame. In flight (u∞ ≠ 0) the gas beyond the exit moves at u∞ and its total pressure is p∞ + ½ρ∞u∞², not p_out, so the flight cases revisit the backflow totals.

**Per-test BC remap.** `SolverOptions.bcRemap` maps a code to another before the table is applied (for example slip wall → far field for ladder L1's uniform flow, which has no wall solution). The default is the identity; the GPU kernel never needs it except for L1.

**Why the wall ghost's pressure is extrapolated, not mirrored.** The W0 mirror ghost copies p, which imposes dp/dn = 0 at the wall. Wherever swirl or wall curvature sets a pressure gradient normal to the wall (ρw²/r behind every rotor, ρu²/R on every curved duct wall) that makes the wall pressure first order and leaves an odd-even wall mode: ladder L6 failed with it (radial-equilibrium error 1.3 % of q for the free vortex, 72 Pa at the inner wall), and the extrapolated ghost brings it to 3 Pa. Mirroring the Cartesian (u, v) also let mass leak through walls not aligned with x or r, because MUSCL limits u and v separately; the pressure-only wall flux makes the wall impermeable in any orientation.

**Why ρ′ and Z are mirrored (D5-5, w3/scheme round 2; SOLVER.md 17).** Extrapolated like p′ (round 1 and before), the scalars made a wall cell never a limiter extremum: its face value towards the interior was ½(q₀ + q₁), so when the flow left the wall the cell lost fuel and entropy at that value, faster than it held them (dρZ/dt = −ṁ(Z₀ + Z₁)/2 stays negative at Z₀ = 0). Ladder L14 showed it as ρZ < 0 and T′ below the ambient at the walls (5 cases under its undershoot row), and in its heating form (a wall cell losing gas colder than its mean) as the 1.39 overshoot and the f64 engine runaway's T′ of 31,740 K at the core duct's outer wall. A scalar at a slip wall is reflected (zero normal gradient), the standard reflective treatment; the extrapolated ghost could also leave ρ = 2ρ₀ − ρ₁ < 0 or Z < 0, a state without a sound speed. Only p′, rw and the tangential velocity keep the extrapolation, because those carry the wall-normal gradients that radial equilibrium needs (L6 above). The ghost's T′ follows from its extrapolated p′ over its mirrored ρ′, so where p′ has a wall-normal gradient the ghost is not a state of the gas (a wall cell at a higher pressure than the next cell has a hotter ghost); the local step's wall face keeps the cell's own radius for that reason (§10, §17).

Blockage of a ghost: b of its source cell. Both ghost layers are filled the same way, each from its own source cell. **A ghost's T′ and c (record entries 6 and 7) are don't-care (W2R-N2):** the oracle copies them from the source cell, but nothing reads them, because SLAU2 recomputes T′ and c from each face state (§7) and the local step reads only real cells. The kernel need not fill them.

## 6. Reconstruction (`src/flow/reference/muscl.ts`)

Dimension-split MUSCL on the primitive vector q = (ρ′, u, v, rw, p′, Z), in index space (no distance weighting; stretching is ≤ 1.15):

- **van Albada limited slope (the contract)** of cell i along a grid line: σ_i = φ(q_i − q_{i−1}, q_{i+1} − q_i) per component, φ(a, b) = ab(a + b)/(a² + b² + 1e-30) if ab > 0, else 0. φ is symmetric and odd, so the two sides of an interface compute bitwise-equal face states whatever the blocks' index orientation.
- **The smooth form (decision D4-25), a trial in the oracle, NOT yet the contract** (option `limiter: 'smooth'`, `smoothVanAlbada`): φ_ε(a, b) = (a + b)(ab + ε_k²)/(a² + b² + 2ε_k²), code order `e2 = eps * eps`, then `((a + b) * (a * b + e2)) / (a * a + b * b + 2 * e2)` (symmetric and odd bitwise; the denominator is ≥ 2ε² > 0, so no guard and no branch). **The ε rule:** ε_k = K_ε S_k, K_ε = 1e-3 (`LIMITER_EPS`), S = (ρ∞, c∞, c∞, c∞ r_c, ρ∞c∞², f_st) for (ρ′, u, v, rw, p′, Z), r_c the radius of the cell whose slope it is (a ghost: its source cell's, so an interface ghost's slope is bitwise the neighbour-block cell's own). **Its scaling:** φ_ε is homogeneous of degree 1 in (a, b, ε); for |a|, |b| ≫ ε it is ab(a + b)/(a² + b²), the classic formula without the switch (so at an extremum it is not 0 but bounded by min(|a|, |b|): a face value can overshoot an extremum by up to half the smaller jump), and for |a|, |b| ≪ ε it is the central slope (a + b)/2. Next to a flat region (a = 0) the slope is bε²/(b² + 2ε²) ≤ ε/(2√2). ε is a fraction of the reference scales, not of the mesh size. **Why it is not the contract yet (round 4, 2026-10-27):** it does what D4-25 wanted on the far-field duct (the D4-20 duct at M_cut = minMach converges, `precondition.test.ts`), but on the inflow/outflow blockage duct of `blockage.test.ts` (preconditioned, M 0.06) the residual stalls at a floor proportional to ε at every CFL from 0.8 to 1.5 (machCut 1: 9-12 × the first residual at K_ε 1e-3, 0.7 at 1e-4, 5e-2 at 1e-5, 5e-3 at 1e-6; machCut 0.01: 0.15 / 1e-2 / 9e-4 / 6e-4), and the plain low-Mach inflow/outflow duct of `solver.test.ts` leaves its steady state. Below ε the reconstruction is central, and the low-Mach acoustic pair of the tracking scheme then has only the scheme's own acoustic damping, which is weak or absent (the fully discrete 1D analysis, `tests/unit/flow/acoustic.ts`, round-4 WIP not yet pinned by a test: plain at rest stable only to CFL 1.24; preconditioned with matched D4-20 dissipation 0.97; preconditioned with machCut 1 no pressure damping at small β). The sharp switch clips every noise extremum to first order, a hidden dissipation that kept those cases converging. So the smooth form needs the acoustic stability of §10 (D4-30) first; until a decision, the kernel implements the sharp form.
- **Round-5 retest (decision D4-33, 2026-10-27, after D4-32: preconditioned CFL 0.8, p_u not adopted).** The smooth form was made the default of every case (an uncommitted experiment, the full ladder and the flow unit suites):
  - *It fixes:* L9a converges to 1e-6 of the peak in 3428 iterations and L9b to 1e-5 in 6169 (neither converged with the sharp form); W2R-6 goes away (§8: the blockage duct at 24 × 6 cells, and at throat M 0.35 when v keeps the sharp form).
  - *It keeps:* L2 (0.29 %, shock offset 0.23 cells), L3 (0.22 %), L4a (0.26 % / 0.12 %), L4b (1.66 %, steadiness 0.035 %; its convergence row stays at 0.15 of the first), L5, L6, L9's Euler-work and Rankine-Froude rows, and every f32-storage row.
  - *It breaks:* L8 (velocity error 27-30 % at CFL 0.4, 0.6 and 0.8, residual 5e-2 of the first: independent of the CFL, so a semi-discrete mode of the field at rest once every slope there is central); L1's uniform M 0.5 check (round-off grows between 25 and 50 iterations at the plain CFL 1.5, above the central-slope acoustic limit 1.236 of §10); four unit tests (the 24 × 3 annulus of `blockage.test.ts` does not converge even preconditioned, because the noise-level radial velocity is reconstructed centrally; the plain low-Mach duct of `solver.test.ts` leaves its steady state).
  - *So the contract stays the sharp form.* The handoff gives the proposal.
- **Round-6 trials (decision D4-36), stated before the runs.** Two variants, each an uncommitted experiment that makes it the default of every case (a scratch copy of the tree, `reports/scratch/trialA` and `trialB`), run on the full CPU ladder and on `blockage.test.ts`:
  - *(a) a smaller, Venkatakrishnan-scaled ε, with plain tracking at CFL 1.0:* the smooth form on all six primitives with ε_k = K_ε S_k (h_c/h_ref)^{3/2}, K_ε = 1e-4, h_ref = 0.01 m, h_c = sqrt(A_c) of the cell whose slope it is (A_c the meridional area; a ghost: its source cell's), S_k as above. ε² ∝ h³ is Venkatakrishnan's (1995) scaling: a smooth field's jumps are O(h), so ε shrinks relative to them under refinement. At h = 0.01 m it is a tenth of D4-33's ε. The plain tracking default becomes 1.0 (W2R-N7: the plain 1.5 is above the central-slope acoustic limit 1.236).
  - *(b) the smooth form on p′ and u only:* D4-33's ε (K_ε 1e-3) on p′ and u, which are W2R-6's variables, and the sharp van Albada on ρ′, v, rw and Z. The plain tracking CFL is also 1.0, for the same reason: p′ and u are the acoustic pair whose slopes become central.
  - *The rule (D4-36):* adopt the first variant, in the order (a), (b), that (1) keeps every ladder row that the sharp limiter passes in the round-5 ladder of record (every PASS row of L1-L7, L8's velocity row, L9a's Euler work, L9b's Rankine-Froude, the 12.2 storage rows) and (2) fixes W2R-6, so that the three `it.fails` of `blockage.test.ts` pass as plain tests. Otherwise the sharp form stays the contract, W2R-6 stays open and pinned, and the data go back to the orchestrator. Convergence rows and unit tests are reported, not part of the rule.
- **Round-7 results (D4-36, 2026-10-27): neither variant is adopted, and the sharp form stays the contract.** Each variant was run as the default of every case in a scratch copy of the tree (`reports/scratch/trialA`, `trialB`), on the full CPU ladder, `blockage.test.ts` and the flow unit suites. The sharp column is the same ladder at c937913 (`trialS`; the ladder of record before D4-45's caps). Logs and reports: `reports/scratch/r7/ladder_{S,A,B}`.

| row (the rule's rows first) | sharp (the contract) | (a) Venkatakrishnan ε, plain CFL 1.0 | (b) smooth on p′ and u only |
|---|---|---|---|
| L1 uniform M 0.5, f64 metrics: max \|u − u∞\| (m/s) | 2.0e-13 | 1.7e-13 | 1.8e-13 |
| L2 L1(ρ) / shock offset (cells) | 0.0028 / 0.23 | 0.0028 / 0.23 | 0.0028 / 0.22 |
| L3 L1(ρ) | 0.0021 | 0.0022 | 0.0021 |
| L4a Mach / mass flow | 0.0028 / 0.0010 | 0.0026 / 0.0013 | 0.0026 / 0.0013 |
| L4b shock position / steadiness | 0.0164 / 2.6e-4 | 0.0184 / 7.1e-5 | 0.0170 / 3.2e-4 |
| L5 mass flow | 8.4e-4 | 8.4e-4 | 8.4e-4 |
| L6 free vortex / solid body equilibrium | 3.0e-4 / 2.9e-5 | 3.2e-4 / 3.6e-5 | 3.0e-4 / 3.3e-5 |
| L7 asymmetry / Cd / iteration ratio (96 × 96) | 0.0131 / 0.0016 / 1.05 | 0.0123 / 0.0002 / 1.04 | 0.0131 / 0.0005 / 1.04 |
| **L8 velocity error (< 1 %)** | 0.37 % | **28.3 % FAIL** | **32.7 % FAIL** |
| L9a Euler work / L9b Rankine-Froude | 7.8e-6 / 0.80 % | 1.6e-9 / 0.57 % | 4.5e-10 / 0.56 % |
| 12.2 f32-storage rows | all 12 pass | all 12 pass | all 12 pass |
| **W2R-6: the three `it.fails` pass as plain tests** | no (the pins) | **no: 0 of 3** | **no: 2 of 3** |
| *reported:* iterations L4a / L5 to 1e-5 | 915 / 948 | 1371 / 1354 | 1372 / not converged (8000) |
| *reported:* L8 to 1e-5 (cap 20000) | not converged | not converged | not converged |
| *reported:* L9a / L9b (cap 20000) | not converged / not converged | 5373 / 9299 | 5059 / 9096 |
| *reported:* R (start from rest) / J (jet), residual / peak at 20000 | 4.2e-4 / 0.24 | converged (1e-6 at 1566) / 0.25 | converged (1e-6 at 1390) / 0.65 |
| *reported:* flow unit suites (sharp: 0 failures) | | 9 fail | 8 fail |

  - *W2R-6 in numbers* (`reports/scratch/r7/w2r6.ts`, `blockage.test.ts`'s protocol: the machCut-1 preconditioned set-up converged to 1e-11 in 8000 iterations, then the plain scheme's drift, bound 1e-8). Sharp: the set-ups converge (8e-12), the b = 1 control stays at 3.5e-12, and the three drifts grow to 9.6e-3 / 8.3e-3 / 7.4e-3. (a): the set-ups do not converge (4.1, 0.058 and 0.078 of their first residual), and the drifts from those states, the control's included, are 1e-2 to 1. (b): the set-ups reach 1.3e-7 / 8e-12 / 7.8e-10, and nothing grows. Physical time stays at 2e-9 (M 0.06) and 1.1e-12 (M 0.35), so those two pass. Tracking at M 0.06 sits flat at 1.4-2.0e-8 over 1000 iterations, above the bound only because its set-up stopped at 1.3e-7. So (b) removes the growth, but by the rule's letter it fails one of the three.
  - *What breaks:* both variants lose L8's velocity row, as D4-33's smooth form did (27-30 %). Under either variant the slopes of p′ and u in L8's field at rest are central, and the semi-discrete mode that round 5 found then stays. (b) also stalls L5 (6.5e-2 of the first residual, converged by sharp in 948) and the machCut-1 test configuration. The unit failures are D4-33's kind: the plain low-Mach duct of `solver.test.ts`; preconditioned ducts of `precondition.test.ts` (three under (a), one under (b)); the W2R-6 set-up test; the smooth-ε unit value (the formula changed); and `rk.test.ts`'s pin of the plain default 1.5.
  - *What they fix:* L9a and L9b converge (5059-9299 iterations; sharp does not in 20000), R converges, and the far-field duct at M_cut = minMach converges (its `it.fails` passes under both). J does not converge under either (W2R-I8, §10).
  - *D4-47, the L4a/L5 plateaus.* The oracle does not have a sharp-limiter floor on L4a or L5. In f64, with the sharp limiter, the residuals fall to 6.4e-13 (L4a) and 5.9e-12 (L5) of the first in 20000 iterations, and the variants do the same. With the state rounded to f32 after every stage (`storage: 'f32'`), the same runs plateau (the minimum over the last 2000 of 20000 iterations): sharp 1.6e-4 / 1.1e-3, (a) 3.2e-5 / 8.7e-4, (b) 1.3e-4 / 6.0e-2. The GPU's plateaus (3.99e-4 / 7.5e-3, D4-47) are of that order. So they are the f32 storage floor of a residual that is a small difference of large fluxes (the 12.2 rows B/E argument), and neither variant removes it. D4-38's stated floors (4e-5 and 1.7e-4) sat below the oracle's own f32-storage floor; D4-58 restates them from these runs as 1.6e-4 (L4a) and 1.1e-3 (L5) (§12.4). The start-from-rest floor R is the limiter's, as round 6 found: both variants converge it.
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

**Low-Mach dissipation scaling (tracking mode with `lowMachPreconditioning` only; decisions D4-20 and D4-44).** The pressure-diffusion term of ṁ is divided by f_a, with the reference Mach number taken from **the preconditioner's β of the face's two cells** (D4-44):

```
β̄_f = ½(β_L + β_R) ;  M_ref = min(1, max(β̄_f, M_cut)) ;  f_a = M_ref (2 − M_ref)
ṁ = ½(ρ_L(vn_L + V̄⁺) + ρ_R(vn_R − V̄⁻) − (χ/(c̄ f_a))(p′_R − p′_L))
```

β_L and β_R are the square roots of the β² of §10 of the two cells beside the face, frozen at stage 1 with τ. A ghost has its source cell's β (like its b, §8), so the two blocks of an interface compute the same β̄_f. Code order: the solver forms `0.5 * (betaL + betaR)` and passes it to `slau2Flux`, which forms `mRef = Math.min(1, Math.max(betaFace, machCut))`, `fa = mRef * (2 - mRef)`, then `chi / (cbar * fa)`. β̄_f and f_a are symmetric in L and R, so the antisymmetry stays bitwise, and f_a = 1 exactly when M_ref = 1, so the unscaled flux is bitwise the plain one. Without preconditioning, in physical time and with machCut ≥ 1, M_ref = 1. `residual()` and `faceFlux()` evaluate β from the current state first.

*Why β, not the face Mach q̄/c̄ (D4-44; it replaces D4-20's M_ref = max(q̄/c̄, M_cut)).* The scaled diffusion is matched to the preconditioned pseudo-time derivative only when the two use the same reference velocity, the standard consistency requirement of Weiss-Smith/Turkel preconditioning. With M_ref from the face Mach the scheme did not enforce it: β² takes max(M², minMach², Δp/(ρc²)) per cell, so β < M_ref on a face faster than its cell (a shear layer beside dead air: under-damped) and β > M_ref where the Δp term lifts β at low speed (a start from rest: over-damped). The fully discrete 1D analysis at rest (§10) gave limits below the CFL 0.8 on both sides (critic pass 8, W2R-I6). With β̄_f, M_ref = β on every uniform state, since β ≥ q/c (§10 has the analysis and the two flow cases). *Why:* SLAU's mass-flux pressure diffusion −(χ/2c̄)Δp is O(M) of the mass flux at low Mach (Δp ~ ρq² gives (χ/2c̄)Δp ~ ρq · M/2), so pressure and velocity decouple as M → 0: the odd-even wall-pressure sawtooth of ladder L7 (0.15 q) and the radial ±1.4 % mode of L8, and L7's non-convergence (the sawtooth's only damping was this term). Divided by f_a ≈ 2M_ref it is ~ ρq/4 · Δp/(ρq²), O(1) like an incompressible (Rhie-Chow) coupling, matched to the preconditioned pseudo-time derivative whose acoustic speed is O(M_ref c). This is AUSM+-up's 1/f_a(M_o), f_a = M_o(2 − M_o) (Liou, J. Comput. Phys. 214 (2006) 137-170), and the Weiss-Smith/Turkel preconditioned dissipation. Transonic and supersonic faces (q̄ ≥ c̄) have f_a = 1 and are unchanged.

**M_cut** (option `lowMachPreconditioning.machCut`, default = `minMach`): below M_cut the diffusion is held at 1/f_a(M_cut), so a stagnation point or dead air does not get an unbounded pressure diffusion. Since β ≥ minMach, M_cut matters only when it is set above minMach (a test configuration). The rest of this paragraph is D4-20's reasoning, written for the face Mach before D4-44; it holds for β, which is ≥ the cell Mach. The default ties it to the preconditioner's cutoff: the scaled diffusion has a pseudo-time rate of about β²c/(8 M_ref Δx) against the step Δx/(βc), i.e. β/(8 M_ref) per step, which stays O(1/8) only while M_ref is not far below β. The same argument is why the scaling is **off without preconditioning** (β = 1: 1/(8 M_cut)) and **off in physical time** (the acoustics are wanted there). The engine (W3, static engine, free stream at rest) runs with **minMach = M_cut = 0.003** (D4-59's trial of a global 0.02 was not adopted, §10): the slowest part of the engine's flow that must be coupled is the far-field suction of the static engine, about 1 m/s (§13), M 0.003 at c∞ = 340 m/s; every faster region (inlet, ducts, jets, entrainment) gets M_ref = its own Mach number. The ladder uses the case's own reference Mach: L7 M_cut = minMach = M∞; L8 (at rest, 0.07-1.9 m/s at the measured radii) the engine's 0.003. The steady state depends on M_cut through a term of the order of the reconstructed jump Δp (second order in smooth flow); the handoff reports the sensitivity (M_cut × ½ and × 2) on L7 and L8. **Open (2026-10-27):** with the sharp van Albada switch of §6, the scaled scheme stops converging where M_ref follows the local Mach (a far-field duct at M 0.01 cycles at 3e-3 of its first residual with M_cut ≤ 0.01 and converges with M_cut ≥ 0.02, or with the smooth van Albada form at any M_cut), and the L8 sink grows a large-scale polar mode for M_cut 0.0025-0.004 (stable at 0.0015 and 0.006). Both wait for a decision; see the handoff.

**Velocity diffusion of the pressure flux (AUSM+-up p_u; decisions D4-30 (2) and D4-32): tried, NOT adopted, deleted (D4-35, D4-43).** Neither the kernel nor the oracle has it: the oracle describes exactly one scheme. This paragraph and its table are the record of the negative result. The code lived in the oracle from 413b623 (round 5: the `ku` parameter of `slau2Flux`, the option `lowMachPreconditioning.velocityDiffusion`, default 0) until round 6 deleted it; `tests/unit/flow/acoustic.ts` keeps K_u as a parameter of the analysis. As tried, in preconditioned tracking with the D4-20 scaling on (machCut < 1) and K_u > 0, p̃ lost the term

```
p_u = K_u β⁺(M_L) β⁻(M_R) (ρ_L + ρ_R) f_a c̄ (vn_R − vn_L)        p̃ ← p̃ − p_u
```

with f_a and M_ref as above (Liou, J. Comput. Phys. 214 (2006) 137-170: the AUSM+-up pressure flux, whose P±₍₅₎ are SLAU2's β±). Every factor is symmetric under F(L, R, S) → F(R, L, −S), so the antisymmetry stayed bitwise, and with K_u = 0 the flux was bitwise the D4-20 one. *Why:* linearised at rest, SLAU2's own velocity dissipation q̄(β⁺ + β⁻ − 1)ρ̄c̄ ≈ −¾ ρ̄ q̄ (vn_R − vn_L) vanishes with q̄, so the pseudo-acoustic pair has only the mass-flux pressure diffusion; p_u is the matching velocity diffusion, ½ K_u ρ̄ f_a c̄ Δvn ≈ K_u ρ̄ M_ref c̄ Δvn at rest, at the preconditioned acoustic speed. The fully discrete analysis of §10 gives the 1D limits 1.231 / 1.413 / 1.254 at K_u 0.25 / 0.5 / 0.75 (0.972 without), so K_u = 0.5. It changes the steady state by a term of the order of the reconstructed velocity jump (second order in smooth flow), like D4-20's. On transonic faces (f_a = 1) it is AUSM+-up's own term; both-supersonic faces have β⁺β⁻ = 0.

*The trial (2026-10-27, K_u = 0.5; sharp limiter; against the same cases without p_u at CFL 0.8):*

| case | without p_u, CFL 0.8 | p_u, CFL 1.15 | p_u, CFL 0.8 | p_u, CFL 1.5 |
|---|---|---|---|---|
| L8 velocity error (< 1 %); residual at 20000 | 0.36 %; 3.9e-4 of the first | **1.38 %**; 3.5e-3 | **2.27 %**; 1.3e-4 | NaN at 24 |
| L7 M 0.01 asymmetry (< 0.02); Cd (< 0.01); iterations | 0.0437; 0.0096; 3901 | 0.0374; **0.0117**; 2707 | | |
| L7 iteration ratio M 0.01 / M 0.3 (≤ 3) | 0.89 | 0.95 (2707 / 2860) | | |
| C-pre (the 12.2 closed box; the density-residual L2) | bounded, 36 at 2000 (from 567) | NaN at 758 | | NaN at 8 |
| L2, L4 (plain, p_u off by construction) | unchanged | unchanged | | |

p_u worsens L8 (the velocity row fails at both CFLs) and L7's Cd (fails), and it destabilises C-pre, where the pulse's Δp term holds β well above M_ref: the at-rest analysis assumes β = M_ref, and its higher limit does not carry over. By D4-32 the preconditioned CFL is therefore **0.8 without p_u** (§10).

**Slip-wall faces** do not use SLAU2: F = |S| (0, p′_w n_x, p′_w n_r, 0, 0, 0), with p′_w the wall cell's reconstructed face value of p′ at the wall (q₀ ± ½σ₀, its slope taken with the extrapolated ghost p′). Mass, angular momentum, energy and fuel fluxes through a wall are exact zeros. Written this way, F(L, R, S) = −F(R, L, −S) **bitwise**, which makes the max/max interfaces (bitwise-negated face vectors) exactly conservative too. For equal states F reduces to the physical flux (ρ vn, ρu vn + p′n_x, ...), which the tests check.

## 8. Blockage and volume sources (`src/flow/reference/sources.ts`): the W3 interface

**Blockage.** A per-cell field b_c ∈ (0, 1] (default 1; `setBlockage` throws on a value outside it, W2R-N1). Face blockage b_f = ½(b_L + b_R) of the two cells (a ghost has its source cell's b, so a boundary face gets b_c). Every face flux is multiplied by b_f, the cell's gas volume is b_c V_c, and the local time step uses b-weighted face vectors (§10).

**Pressure and swirl source** (the geometric term, `geometricSource`): for cell c with primitives q_c,

```
P_c,x = p′_c Σ_f b_f S_f,x
P_c,r = p′_c Σ_f b_f S_f,r + b_c ρ_c w_c² A_c          (w_c = rw_c / r_c)
```

with S_f the cell's **outward** face vectors. For b ≡ 1 this is (0, p′A + ρw²A), the axisymmetric source, because Σ S_f = (0, A). With blockage it adds the force of the blade metal on the gas, p ∇b, in the form that balances a uniform pressure exactly: Σ_f b_f p′ S_f − p′ Σ_f b_f S_f = 0. The gauge p′ is used in both, so the p∞ parts cancel identically.

**Open: W2R-6, the plain scheme is unstable with blockage (decision D4-29: investigated and fixed before W3).** About its own steady state in a blockage duct (24 × 3 cells, b_min 0.85, throat M 0.06 or 0.35), the plain scheme grows a mode in both the tracking mode and the physical-time mode: from the converged state (relative 1e-12) the drift reaches 8e-3 in 1000 tracking iterations and 1e-2 in 1000 SSP-RK3 steps at the default dt at M 0.06; at M 0.35 the physical-time growth is slower (4e-9 at 1000 steps, 8e-3 at 2000). It saturates near 1 % of the state. The same duct with b ≡ 1 stays at 1e-12 in both modes, and the preconditioned tracking mode converges the blockage duct to 1e-11. Physical time is the mode of the surge and light-off events and every W3 blade row carries blockage, so this is a defect of the scheme, not a limitation to live with. Pinned as KNOWN-FAIL (`it.fails`) in `tests/unit/flow/blockage.test.ts`, with the b ≡ 1 control passing. The kernel implements this section as written; the fix may change it.

**W2R-6 located (decision D4-34, round 5, 2026-10-27): it is the sharp limiter's switch, not a blockage term.**
- *p_u does not remove it.* p_u lives in preconditioned tracking, where this duct is stable anyway. Put into the plain scheme (f_a = 1) it moves the M 0.06 duct's steady state by 16 % of the state, so it is not a candidate.
- *The mode* (a power iteration of the plain scheme about its steady state, physical time, read at a drift of 1e-7 where it is linear): growth × 20 per 80 SSP-RK3 steps at the default dt, σ ≈ 590 1/s, of the order of c/L of the duct. It is acoustic (δρ = δp/c², δ(ρu) ≈ δp/c): a smooth standing wave between the inflow and the outflow plus a grid-scale pressure/axial-velocity oscillation in the blockage cells.
- *Term switches* (a scratch copy of the oracle, `reports/scratch/r5/w2r6.ts` on `reports/scratch/ref5`, the duct of `blockage.test.ts`, physical time, 1000 steps from the converged state):

| variant | M 0.06 | M 0.35 |
|---|---|---|
| as specified | grows to 1e-2 | grows to 6e-3 at 2000 |
| first-order reconstruction | stable | |
| p′ slopes zero, the others limited | stable | stable |
| u slopes zero | stable | |
| p′ slopes central (unlimited) | stable | |
| ρ′ slopes zero; v slopes zero | grows | |
| the pressure force as b_c ∇p (each side's b on the face pressure, the p∇b source not used) | grows | |
| b_f = min(b_L, b_R) instead of the average | stable | stable |
| smooth van Albada (§6), 24 × 6 cells | stable (2e-13) | |
| smooth van Albada for all but v, 24 × 3 | stable | stable |
| as specified, 24 × 12 cells | grows (slower) | |

- *Reading.* The plain scheme's steady state carries a grid-scale pressure sawtooth at the throat (±50 Pa on a 200 Pa dynamic pressure; plain SLAU2's O(M) pressure coupling at M 0.06, the L7 sawtooth that D4-20 removes only in preconditioned tracking). So p′ and u have an extremum in nearly every blockage cell, where the sharp van Albada switches (φ = 0 for ab ≤ 0, and next to it a one-sided slope with ∂φ/∂b → 1). The linearisation of that switch is what grows. The p∇b source is well-balanced (D4-29), and replacing it does not help. The smooth limiter, which linearises to the central slope where |a|, |b| ≪ ε, removes the mode. With 3 radial cells it cannot be shown: its central reconstruction of the noise-level radial velocity (|v| ~ 1e-13 ≪ ε_v = 0.34 m/s) keeps this narrow annulus from converging even preconditioned. Central v slopes alone do that at 24 × 3, and 24 × 6 does not show it.
- *The direct check (W2R-N13, round 7, 2026-10-27; scratch `reports/scratch/trialN13/n13.ts`).* A power iteration of the plain scheme's one-iteration map about the steady state U0 of `blockage.test.ts`'s duct: δ_{n+1} = Φ(U0 + δ_n) − Φ(U0), renormalised to 1e-7 of the state every iteration. It is run twice: with the sharp van Albada's switch pattern frozen at U0 (the ab > 0 mask per cell, direction and primitive; 547 of the 1188 slopes are on), and with the live switch. The growth per iteration is the geometric mean of the last 100:

| map | frozen switch | live switch | the frozen map with the switch forced on for p′ and u | forced on for all six |
|---|---|---|---|---|
| tracking, M 0.06 | 1.0718 | 1.0718 | 1.2182 | 1.2182 |
| physical time, M 0.06 | 1.0397 | 1.0397 | | |
| physical time, M 0.35 | 1.0152 | 1.0151 | | |

  The frozen operator grows at the live rate to 5-6 digits, so the mode is a linear instability of the scheme linearised with that switch pattern, not the switching. Forcing the switch on (the classic ab(a + b)/(a² + b²) across the extrema) grows faster, so the zeroing at the extrema is not the cause either. What remains is the limited slope's linearisation beside the sawtooth's extrema, which is one-sided (∂φ/∂b → 1, ∂φ/∂a → 0), while the central slope (round 5: p′ slopes unlimited) is stable. Round 5's reading stands, and this check makes it direct.
- *Fix proposed:* the smooth limiter as the default (D4-33). Until a decision this section, §6 and the KNOWN-FAIL pins stand.

**Volume sources.** A source model (`SourceModel`) is called once per RK stage with the stage's primitives and the stage's time (physical time: t, t + dt and t + dt/2 for the three SSP-RK3 stages, so a time-dependent schedule keeps third order, W2R-N3; tracking: the iteration's time, unchanged). Per cell it writes:
- `rate` s_c (6 values): conserved-gauge component rates per unit **gas** volume (kg/(m³ s), N/m³, N/m³, N m/m³, W/m³, kg/(m³ s)), for U = (ρ′, ρu, ρv, ρrw, η, ρZ). Since η = ρE − ρh0∞ + p∞, an energy source s_E and a mass source s_m give **s_η = s_E − h0∞ s_m**. A mass source at the local state carrying its stagnation enthalpy h0 (bleed, cooling flow) therefore has s_η = s_m (h0 − h0∞); helper `massSourceRates`.
- `damping` d_c (6 values, ≥ 0, 1/s): the diagonal of −∂s/∂U, for the point-implicit update. 0 means explicit.

The cell integral of a source is b_c V_c s_c. Body forces of a blade row (W3, Hall–Thollet) enter as s_1 = ρf_x, s_2 = ρf_r, s_3 = ρ r f_θ and s_4 = ρ(u f_x + v f_r + w f_θ) (or Ω s_3 for the Euler-work form); the combustor as s_4 = heat release per volume and s_5 = fuel per volume.

**The W3 sources (w3/coupling; PHYSICS.md 3.3 CP1, CP2).** The blade rows' forces and the combustor plug in here, through `SourceModel` in the oracle and the cell-source kernel on the GPU (its coefficients grow to 10 vec4 per cell: the last two are the body force's, `(Ω, κ, c_N, c_P)`, `(δ_s, 2C_f, K_rev, kind)`). The formulas are in `src/flow/coupling/bodyForce.ts` (the f64 form of record, its header gives them) and `src/flow/gpu/wgsl/bodyForce.ts` (the same order in f32). Per cell: s_1 = ρf_x, s_2 = ρf_r, s_3 = ρ r f_θ and s_4 = Ω s_3 (the energy as the Euler work of the row's torque; 0 for a stator). The point-implicit damping of the momentum components is each force's rank-one eigenvalue (the normal force's c_N K_M W²/|W_xθ|, the follow-camber rate), applied to every component: the diagonal bound d n_i² lets the normal component overshoot by up to 2× at a large dt·d, a neutral, undamped step. The combustor is a constant rate0: s_0 = s_5 = s_m (the fuel's mass) and s_4 = q − h0∞ s_m (the fuel's enthalpy is 0 at the src/thermo datum, as in the cycle's balance), with no damping. The blockage is the metal's (`src/flow/coupling/rows.ts`), 1 at the rows' edges.

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

**The preconditioned tracking CFL (decision D4-32).** D4-8's analysis covers advection only. The pseudo-acoustic pair of the preconditioned scheme is a different family: linearised at rest, SLAU2's velocity dissipation q̄(β⁺ + β⁻ − 1)ρ̄c̄ is second order and vanishes, so the pair is damped only by the (D4-20-scaled) mass-flux pressure diffusion, and the 3-stage set's |G(iy)|² = 1 + 0.05y⁴ + 0.01y⁶ is anti-dissipative on the imaginary axis. `tests/unit/flow/acoustic.ts` is the fully discrete von Neumann analysis of the actual scheme on that family: MUSCL with central slopes (van Albada in smooth data), face states q ± σ/2, dimension-split fluxes, the pressure increment times β², the local step CFL/λ with λ the preconditioned spectral radius summed over the two directions, and G(z) of the three stages on each eigenvalue of the step's symbol, over every wave number (θ_x, θ_r). The cell shape enters as the aspect a = (r-face area)/(x-face area) of the cell; a = 0 is the 1D limit (a cell much longer in r than in x, or the axis cells' effective width). Stability limits (`tests/unit/flow/rk.test.ts` pins them):

| family (at rest) | a = 0 (1D) | 0.25 | 0.5 | 1 (square) |
|---|---|---|---|---|
| plain tracking (β = 1, f_a = 1) | 1.236 | 1.539 | 1.791 | 1.878 |
| preconditioned, D4-20 matched (β = M_ref, any β ≤ 0.006) | **0.972** | 1.210 | 1.408 | **1.550** |
| the same + AUSM+-up p_u, K_u = 0.25 | 1.231 | 1.517 | 1.691 | 1.777 |
| the same + p_u, K_u = 0.5 | **1.413** | 1.726 | 1.885 | **1.958** |
| the same + p_u, K_u = 0.75 | 1.254 | 1.567 | 1.880 | 2.107 |
| preconditioned without D4-20 (machCut ≥ 1), β = 0.06 | 0.475 | 0.591 | 0.687 | |

The worst cell shape is the 1D one, so the preconditioned tracking default is **`DEFAULT_CFL_PRECONDITIONED` = 0.8** (0.82 × 0.972; the 0.8 margin is the standard safety factor on a computed limit). It applies whenever `lowMachPreconditioning` is set with minMach < 1 and the caller gives no `cfl` (minMach ≥ 1 is the plain scheme and keeps the plain default, W2R-N8); the plain tracking default stays 1.5. **The plain 1.5 has no linear basis on the acoustic family in 1D** (W2R-N7, critic pass 8's probe): the 1D central-slope plain limit is 1.236 at rest and 1.448 at M 0.5, below 1.5 at every Mach number up to 0.8, and 1.539 at aspect 0.25. The plain default relies on the sharp limiter's clipping of noise extrema (§6) and on the cells of real meshes having aspect ≥ 0.25. A flow-dependent minimum of the plain family is 0.8 × 1.236 = 0.99, so a plain CFL of 1.0 sits at the edge of the margin, not inside it.

**The β/M_ref range (decision D4-44, W2R-I6).** The table above assumes β = M_ref. Before D4-44 the face's M_ref was its Mach number q̄/c̄, and the 1D limit at rest (M_cut 0.003; `acoustic.ts`, critic pass 8's probe agrees) fell below 0.8 on both sides of the matched value:

| β / M_ref | 0.1 | ¼ | ½ | ¾ | 1 | 2 | 4 | 8 | 16 |
|---|---|---|---|---|---|---|---|---|---|
| 1D limit (before D4-44) | 0.447 | 0.608 | 0.768 | 0.881 | 0.972 | 1.236 | 0.937 | 0.469 | 0.234 |

With D4-44 (§7, M_ref from β̄_f) every uniform state has M_ref = β, so the scheme is on the matched row by construction. Since β² ≥ M², the uniform states are β ∈ [M_cut, 1] with a flow Mach number M0 ≤ β. Their 1D limits (`acoustic.ts` at rest, and critic pass 8's probe, which builds the step from the module's own `slau2Flux`, `consToPrim`, `preconditionIncrement` and `spectralRadius`, with flow):

| β | M0 = 0 | M0 = β/4 | β/2 | 3β/4 | β | at rest, square cell |
|---|---|---|---|---|---|---|
| 0.003 | 0.972 | 1.234 | 1.418 | 1.445 | 1.215 | 1.550 |
| 0.03 | 0.977 | 1.238 | 1.421 | 1.446 | 1.216 | |
| 0.1 | 0.989 | 1.248 | 1.429 | 1.453 | 1.225 | 1.577 |
| 0.3 | 1.028 | 1.278 | 1.447 | 1.519 | 1.311 | 1.639 |
| 0.6 | 1.099 | 1.325 | 1.457 | 1.529 | 1.555 | 1.754 |

The minimum over the family is the at-rest 0.972 at β = M_cut, so CFL 0.8 holds over the whole β range. A von Neumann analysis needs a uniform state. Where β varies from cell to cell, β̄_f differs from each cell's own β, and two flow cases check that regime (D4-44 (c), `precondition.test.ts`). Each is run in preconditioned tracking at the engine settings (minMach = M_cut = 0.003) and the default CFL 0.8, started from rest:
- *R, a start from rest:* the inflow/outflow blockage duct of `precondition.test.ts` (24 × 6 cells, b_min 0.85, p0 = p∞, outflow 0.998 p∞, throat M 0.06). At the start the Δp term lifts β to about 0.04 at the outflow while the flow is at rest (β/M_ref ≈ 12 before D4-44).
- *J, a low-Mach jet into dead air:* a 32 × 16 rectangle, 0.8 × 0.4 m on the axis. The inflow (total conditions for M 0.05) covers the inner quarter of the x-min face and a slip wall the rest. The outflow is at p∞, and the far field (at rest) is at the outer radius. Across the jet's shear layer the dead-air cells have β = M_cut beside jet cells at M 0.05.

**The rule, stated before the runs:** each case must converge, with the residual at or below 1e-5 of its peak and staying there for 50 iterations, within 20000 iterations, with no NaN. If either fails with (a), option (b) is added: the scaled diffusion's eigenvalue joins the local step's λ. Before D4-44, at 20000 iterations, R had stalled at 8e-5 of the peak (a limit cycle) and J at 3e-2 (wandering between 5e-3 and 0.17).

*Results with (a) (round 6, 2026-10-27; scratch `reports/scratch/r6/cases.ts`).* Both cases FAIL the rule, but not on the acoustic limit that D4-44 addresses:
- R stalls at 4.2e-4 of its peak at 20000. The peak fell from 406 to 68 kg/(m³ s), because the start transient is damped as matched. The floor in absolute terms is unchanged (0.031 against 0.030 before D4-44). At CFL 0.4 R stalls at the same 4.0e-4, so the floor does not depend on the step. With the smooth limiter (K_ε 1e-3) R converges to 1e-6 of the peak in 1763 iterations. So R's floor is the sharp limiter's (D4-36), like L9a/L9b.
- J wanders at 0.24 of its peak at 20000 (between 3e-2 and 0.6). It does the same at CFL 0.4 (0.18) and with the smooth limiter (0.34). A J that converges under no variant does not test the step.
- Option (b), the rule's next step, was run in a scratch copy of the oracle (`reports/scratch/ref6b`): the diffusion eigenvalue β²χc/(2f_a) per face was added to λ, with M_ref from the cell's β. It does not change the outcome: R 4.4e-4 and J 0.17 of the peak at 20000. So (b) is not adopted.
- Without preconditioning, J (the plain scheme, sharp, CFL 1.5) reaches 4.1e-5 of its peak, 7.6e-5 kg/(m³ s) absolute, at 20000, still falling. Preconditioned, J stays at about 4-6 kg/(m³ s). So J's stall is a property of the preconditioned scheme at M_cut 0.003 beside a shear layer, open (see the handoff).
- (a) breaks no unit test (the flow suites: 132 passed). R and J are pinned as KNOWN-FAIL in `precondition.test.ts`. The closed-box case C-pre of §12.2 shows the limit is real: at CFL 1.5 the preconditioned pulse (engine settings, minMach = M_cut = 0.003) goes to NaN at iteration 79 (48 at a hundredth of the amplitude), while at 1.15 and 0.8 it stays bounded for 400 iterations; ladder L8's polar mode (D4-27) grows at 1.5 and 1.2, is neutral at 0.9 and decays at 0.75 (critic pass 7). Preconditioning with machCut ≥ 1 (no D4-20 scaling) has a far lower limit at small β (0.475 at β 0.06 and 0.176 at β 0.003, critic pass 8) and is a test configuration only (D4-22's measurement, the steady-state check of `precondition.test.ts`). It also takes the 0.8 default, which is above its limit. The option's documentation says so (W2R-I6 gap 2). D4-32's p_u trial (§7) worsened L7 and L8 and destabilised C-pre, so the default stays **0.8 without p_u** (decision D4-32's second branch).

*W2R-I8, J's stall (decision D4-52, round 7, 2026-10-27; scratch copy `reports/scratch/trialJ`, driver `rj/cases.ts`).* β² already has the pressure-difference cutoff K·Δp/(ρc²) with K = 1, Δp the largest |p′| difference to the four face neighbours (Weiss, Maruszewski & Smith 1999; Darmofal & Siu 1999). D4-52's trial varies K, and adds a velocity-difference term K_u |Δq|²/c² (Δq the largest velocity difference to the four neighbours), the neighbours' M² (the largest over the four), and the global cutoff M_cut. Everything else is J as above (sharp limiter, CFL 0.8, minMach = M_cut = 0.003 unless stated). The value is the residual over its peak at 20000 iterations (the rule is 1e-5):

| β² cutoff | J | R |
|---|---|---|
| K = 1 (the contract) | 0.24 | 4.2e-4 |
| K = 10 | 0.39 | 9.4e-4 |
| K = 100 | 0.40 | 2.7e-4 |
| K = 1000 | NaN at iteration 265 | |
| K = 1, K_u = 1 | 0.68 | |
| K = 10, K_u = 1 | 0.35 | |
| K = 100, K_u = 1 | 1.1e-3 | 2.7e-4 |
| K = 100, K_u = 4 | 1.8e-3 | |
| K = 1 and the neighbours' M² | 2.9e-3 (0.13 at 16000) | |
| M_cut = minMach = 0.01 | 0.50 | |
| M_cut = minMach = 0.02 | 5.8e-5 (9e-6 at 10000, bouncing) | |
| M_cut = minMach = 0.05 | 3.8e-6 | |
| the D4-36 limiter variants (a) / (b), K = 1 | 0.25 / 0.65 | converged (1e-6 at 1566 / 1390) |
| plain scheme (round 6) | 4.1e-5, falling | |

- *The pressure-difference cutoff does not fix J* at any K, and K = 1000 diverges. J's shear layer runs at the ambient pressure, so Δp is small there.
- *Where the residual sits* (K = 1 at 6000 iterations): in the dead air just outside the jet (the rows j = 4-5 beside the jet's four rows) and at the base-wall corner, where the flow is a slow recirculation (u from +0.9 to −1 m/s, M 3e-4 to 7e-3), at β ≈ M_cut. The ten largest cells carry 24 % of R².
- *J converges once M_cut ≥ 0.02*, about 0.4 of the jet Mach. The stall therefore comes from the dead-air cells whose β sits at M_cut, far below the jet's beside them. The local cutoffs that spread the jet's β into its neighbours (K_u, the neighbours' M²) bring J two orders lower, but it still stalls at 1e-3.
- *No variant is adopted* (the decision is the orchestrator's). The contract stays K = 1, and J stays pinned. A global cutoff tied to the flow (M_cut = K_g · the domain's maximum Mach, Turkel's β² ≥ K M∞²) is the form the data supports, but it is a contract change: it raises β everywhere in a fast flow. Two candidates for the next round: that cutoff, or a local cutoff that reaches more than one cell into the dead air.

*D4-59, the global M_cut = 0.02 trial (round 8, 2026-10-28). The rule, written before the runs.* The trial replaces the engine setting minMach = M_cut = 0.003 (D4-40) by minMach = M_cut = 0.02 wherever the engine setting is used: ladder L8, the C-pre and S rows of §12.2, R and J. A global cutoff applies to every flow, so the same floor goes on the ladder's other preconditioned run: L7's M 0.01 sphere runs at minMach = M_cut = max(M∞, 0.02) = 0.02 (the M 0.3 sphere keeps 0.3). L1-L6, L9a and L9b run without preconditioning, so the setting does not enter them; the trial ladder runs them all the same. The unit tests that pin a mechanism at a stated minMach or M_cut keep their values. Everything else is unchanged (sharp limiter, K = 1, CFL 0.8). **M_cut = 0.02 is adopted only if both hold:**
1. every ladder row that passes at 0.003 still passes at 0.02: L1-L7 (L7's asymmetry with its falling 24/48/96 sequence, Cd, and the iteration ratio ≤ 3×), L8's velocity row with its D4-45 steadiness, the L9 value rows that pass, and all 12 rows of §12.2's f32 storage;
2. J and R each meet D4-44 (c)'s rule above (≤ 1e-5 of the peak, staying there for 50 iterations, within 20000, no NaN).

Otherwise the engine setting stays 0.003 and J stays pinned. The rows that fail at 0.003 (L8's convergence, L9a's steadiness under D4-57, the L9 convergence rows) are reported beside the rule, not part of it. The trial runs in a scratch copy of the tree (`reports/scratch/trialM`).

*D4-59's results (round 8, 2026-10-28; `reports/scratch/trialM`, logs and reports in `reports/scratch/r8`, R and J from `trialM/rm/rj.ts`, which builds them as `precondition.test.ts` does).* **Not adopted: R fails rule 2, so the engine setting stays minMach = M_cut = 0.003 and J stays pinned.** The 0.003 column is the ladder of record at 0e1bdba (the code is unchanged since):

| row | 0.003 | 0.02 |
|---|---|---|
| L1-L6, L9a, L9b (no preconditioning) | as in the handoff | bitwise the same values |
| L7 M 0.01 (96 × 96): asymmetry, sequence 24/48/96 | 0.0131, falling (0.135 / 0.044 / 0.013) | 0.0109, falling (0.128 / 0.039 / 0.011): pass |
| L7: \|Cd\| | 0.0016 | 0.0013: pass |
| L7: iterations M 0.01 / M 0.3 (≤ 3) | 1.048 | 1.779 (14734 iterations at M 0.01): pass |
| L8 velocity (< 1 %), steadiness (≤ 0.1 %) | 0.449 %, 2.0e-5 | 0.754 %, 3.2e-5: pass |
| L8 convergence (fails at 0.003) | not at 37500 | not at 37500 |
| §12.2 C-pre after 1 / 10 / 100 | 1.43e-7 / 1.80e-7 / 2.26e-6 | 1.43e-7 / 1.79e-7 / 1.06e-6: pass |
| §12.2 S after 1 / 10 / 100 | 7.3e-8 / 1.6e-7 / 4.7e-7 | 1.2e-7 / 1.1e-7 / 2.0e-6: pass |
| §12.2 C tracking, C physical | pass | the same values |
| **R** (rule 2) | 4.2e-4 at 20000: FAIL | **4.3e-4 at 20000: FAIL** |
| **J** (rule 2) | 0.24 at 20000: FAIL | meets the rule at 9441 (8.4e-6), then rebounds: 2.7e-6 to 9.9e-5 over the next 10500 iterations, 5.8e-5 at 20000 |

- Rule 1 holds: every row that passes at 0.003 passes at 0.02. L7's iteration ratio rises from 1.05 to 1.78, because β is held at twice the M 0.01 sphere's Mach.
- Rule 2 fails on R. R's floor does not move with M_cut (4.3e-4 against 4.2e-4); it is the sharp limiter's, as round 6 found (the D4-36 variants converge it). So a global cutoff cannot remove it.
- J passes the rule's letter, but it does not stay converged. Run past the stop, it climbs back to 1e-4, the bouncing round 7 saw. A larger cutoff damps the shear-layer stall without curing it.

*D4-63, the rest state on the engine mesh (round 9, 2026-10-28; scratch `reports/scratch/r9`: `grow2.ts` on the 130k asset, `standin.ts` on one block of it, a switchable copy of the oracle in `r9/ref`).* The case: the engine default (thermally perfect, ISA SLS at rest, preconditioned tracking at minMach = M_cut = 0.003, CFL 0.8) from `engine-stability.test.ts`'s 0.1 % pressure wave. The oracle gives the GPU's numbers: max |ρ′| over its first 1.51 at 100, 10.4 at 1000, **13.6 at 2000**. Max |p′| over its first: 2.44 at 100, 5.43 at 200, 19.6 at 270 (upstream block, j = 1 at the axis, x −7.0 m: p′ −1985 Pa, u 12-15 m/s, β 0.09-0.11), 3.6 at 300, 12.3 at 600 and 4-8 from 700 to 2000 (plume-core and core blocks, at the axis or the walls). The density residual rises from 12.4 at 100 to 113 at 1000 and 129 at 2000.
- **The round-8 hypothesis is refuted** (the inflow ghost's jump lifting β in the first column and the face's M_ref leaving the next cell at β/M_ref ≈ 0.2, plus the inflow's physical ρc characteristic):
  - *Where the max sits there is no β jump.* Over iterations 60-210 the column i = 0..5 beside the inflow has β 0.028-0.063 and β/M_ref 0.82-1.08 on its faces. The pulse is a pressure low (−130 to −610 Pa) with u +1 to +8 m/s, moving to the axis.
  - *The stand-in* (the upstream block alone, from the asset's own nodes, its imax a slip wall) gives the engine's numbers to 4 digits at 100 (1.510 / 2.439 at (2, 64)). Max |p′| at 200: 5.43 as specified; **5.63 with the inflow remapped to the far field** (the preconditioned characteristics); **5.27 with the inflow's characteristic preconditioned** (ρβ∞c in place of ρc); **5.67 with the Δp term blind to physical ghosts**; 5.44 / 5.41 with the face β the max / min of the two cells'; 5.78 with the smooth limiter. In this block the pulse then decays: 0.96 at 1000, 0.23 at 2000 (0.22 remapped).
  - *It is semi-discrete:* at CFL 0.4 the engine run follows the CFL 0.8 one in pseudo-time (2.16 at 180 against 2.19 at 90; 3.66 at 300 against 3.70 at 150). So a local step limit cannot change it.
- **What it is, in two parts:**
  - *The nonlinear part (amplitude 1e-3, preconditioned only).* β² takes the Δp term (Δp up to 100 Pa lifts β to 0.03-0.1), and the pseudo-time velocities are u ~ p′/(ρβc), 5-15 m/s, against the 0.24 m/s of the physical acoustics. The radial wave focuses on the axis (the upstream block's 20× at 270, the plume-core's 12× at 600) and deposits entropy, which the rest state freezes: at 2000 max |ρ′| is 13.6× its first while max |p′| is 8×, so most of the density excess is entropy. Smaller amplitudes and larger floors reduce the focusing in the stand-in (max |p′| at 200: 5.04 at amplitude 1e-4, 1.93 at 1e-5; 2.28 at minMach 0.02, 2.04 at 0.05).
  - *The linear part (every amplitude, plain and preconditioned).* At amplitude 1e-6 (no Δp lift) the engine run's max |p′| is 2.76× its first at 1000 and the residual rises 6× (4.7e-2 at 100 to 0.28); the plain scheme at 1e-3 (CFL 1.5) reaches 3.3-4.0× from 600 to 1000 and its residual rises 6.7× (0.25 to 1.69). Both sit in the core duct (x 0.6-1.6 m, r 0.24-0.35 m, walls on both sides), and neither generates entropy (its max stays at the initial 0.286). Whether that is a transient (a pulse gathered into the small cells of a contracting duct) or a slow linear mode is open: a power iteration about rest is the next check. The round-8 report "1e-6 does not grow" stopped at 100 iterations.
  - The plume-core block alone (walls on imin and jmax, outflow at imax) does not grow (1.59 at 1000; 1.03 at 1e-6), so the engine's growth there needs the blocks around it.
- **No fix was run.** None of the three local remedies of the brief reaches either part: the preconditioned inflow characteristic and the ghost/face β change the transient by ≤ 5 %, and a step limit cannot change a semi-discrete process. A remedy is a scheme change (the β² rule, the floor, or the plain scheme's own core-duct behaviour), so it goes back to the orchestrator as a decision, with the rule below.
- **The rule for any D4-63 fix, stated before it runs.** Adopt it only if both hold: (1) **the rest state does not grow on the real mesh:** the D4-63 case above (`tests/ladder/cases/d463.ts`, 2000 iterations, D4-45's window), with max |p′| at most 2× its first over iterations 1000-2000, the density residual over 1000-2000 at most its value at 100, finite throughout; (2) every row that passes now still passes: L1-L7, L8's velocity row with its steadiness, the L9 value rows, and §12.1/§12.2's rows (C, C-pre, C physical, D, S and the f32-storage table). As specified the case fails (1): 8.0× late max, residual 10.4× its value at 100. The plain scheme fails it too (3.3× at 1000, residual 6.7×), so the bound itself is a question for the orchestrator, not a value to tune. Pinned in `tests/ladder/d463.test.ts`: the rule as `it.fails`, beside a passing signature (finite, max |p′| below 100× its first).

*D4-68, the β² pressure term at K = 0 and in a face-limited form (round 10, 2026-10-29; scratch `reports/scratch/r10`: a copy of `solver.ts` with the switches `R10_K` (the term's K) and `R10_DP=face`, run through the ladder's own case files by a resolve hook, `redirect.mjs`, that NODE_OPTIONS carries into L7's child processes).* The rule is round 9's, above. The face-limited form takes Δp_c as the largest jump |p′_R − p′_L| of the MUSCL-limited face states over the cell's four faces, in place of the cell-to-neighbour difference: in smooth data that jump is O(Δx²), at a discontinuity or a limiter-clipped extremum it is the full difference. Rows that run without preconditioning (L1-L6, L9a, L9b, §12.2's C tracking and C physical) do not see the term, and their values are bitwise the same.

| row (the rule) | K = 1, the contract | K = 0 | face-limited Δp |
|---|---|---|---|
| D4-63 case: finite to 2000 (rule 1) | yes | **NaN at iteration ~190** (the upstream block's radial focus at i = 2, r 0.8 m → axis) | yes |
| D4-63: max \|p′\| / first over 1000-2000 (≤ 2) | 8.0 | – | **8.05** |
| D4-63: residual over 1000-2000 / at 100 (≤ 1) | 10.4 | – | **11.2** |
| D4-63: volume-weighted L2 of p′ / first over 1000-2000 (D4-72's rule 1a, ≤ 2) | 1.72 (round 9's log) | – | 1.43 |
| D4-63: peak max \|p′\| / first at the checkpoints (signature < 100) | 12.3 (19.6 at 270, between checkpoints) | NaN | 10.3 |
| §12.2 C-pre f32 storage after 1 / 10 / 100 (≤ 1e-6 / 1e-5 / 1e-4) | 1.43e-7 / 1.80e-7 / 2.26e-6 | 6.31e-7 / **NaN / NaN** | 6.42e-7 / 1.88e-7 / 8.29e-7 |
| §12.2 S after 1 / 10 / 100 | 7.31e-8 / 1.56e-7 / 4.70e-7 | 7.31e-8 / 1.35e-7 / 2.71e-7 | 7.31e-8 / 2.01e-7 / 3.63e-7 |
| L7 M 0.01: asymmetry (falling 0.135 / 0.044 / 0.013), \|Cd\|, iterations M 0.01 / M 0.3 | 0.0131, 0.0016, 1.048 | 0.0131, 0.0016, 1.048 (the same) | not run (rule 1 fails) |
| L8 velocity (< 1 %), steadiness (≤ 1e-3) | 0.449 %, 2.0e-5 | **11.1 %, 0.071** (not converged at 37500, as at K = 1) | not run (rule 1 fails) |

- **Neither form is adopted; the contract stays K = 1 with the cell-to-neighbour Δp.** K = 0 fails rule 1 (NaN) and breaks C-pre (NaN by iteration 10) and L8's velocity and steadiness rows. The face-limited form keeps every row it was run on, but fails rule 1 like the contract (8.05×, 11.2×).
- **What this says about the nonlinear part.** The Δp term is not its cause. Without the term the same wave diverges, sooner. At β = M_cut the pseudo-time acoustic impedance is ρβc, so a pressure wave p′ carries a pseudo-velocity u ≈ p′/(ρβc): 80 m/s for the 100 Pa wave at β 0.003. The nonlinearity of the pseudo-time system is u/(βc) = p′/(ρβ²c²). The Δp term bounds it by p′/(K Δp), the ratio of the wave's amplitude to its change over one cell (about λ/(2πΔx), 4-5 in the far-field cells, more in fine cells). Only the M² term, or a larger floor, bounds it otherwise. So at a finite amplitude the preconditioned pseudo-time system is strongly nonlinear whatever local Δp form is used. Round 9's floor result agrees: minMach 0.02 cut the stand-in's focus from 5.4× to 2.3×. A remedy for the nonlinear part is a change to β²'s floor or to the scheme, a decision (below).
- Side observation (not on the engine path): the core block alone as a duct (far field at imin) goes to NaN within 100 iterations from the same 1e-3 isothermal pulse at K = 1 and K = 0. With a wall or an outflow there it does not. The engine's far field is at r 8.6 m, where the d463 wave is e^-11 of its peak, so the case does not reach it. The far-field BC under a finite pseudo-velocity at M_cut is a candidate for the next round.

*D4-72 (2026-10-29): rule 1's pressure bound is on the volume-weighted L2 of p′*, sqrt(Σ_c V_c p′_c²), in place of max |p′|. A converging cylindrical wave grows pointwise towards the axis (about 1/√r) while its energy decays. The bound stays 2× its first over 1000-2000, the residual part (at most its value at 100) and rule 2 are unchanged, and max |p′| is reported beside it (`tests/ladder/cases/d463.ts` rows 1 and 3). Under D4-72 the contract's D4-63 case passes 1a (1.72) and fails 1b (residual 11.9× its value at 100).

*D4-69, the linear part: a decaying non-normal transient, not a mode (round 10; `r10/power.ts`, `r10/arnoldi.ts`).* The map is one tracking iteration G about rest. At 1e-6 it is linear in β (β = M_cut: the M² and Δp terms are below minMach²); the sharp limiter makes it positively homogeneous, so a renormalised run is a valid power iteration. The norm that decides growth is the pseudo-energy E_τ = Σ_c (1/τ_c)(p′²/(β_c²ρc²) + ρ|u|²). The semi-discrete pseudo-time system at rest is non-increasing in it when R is dissipative, because the local step and the preconditioner are per-cell factors. Its per-cell weights span 9e-4 to 13 on the 130k mesh, so with E_τ non-increasing, max |p′| may still grow by up to 1400× in the core block and 250× in the far field (`r10/bound.ts`).
- **The 130k mesh, the engine default, the d463 wave made isentropic at 1e-6, 20000 iterations, renormalised in E_τ every 200** (`logs/engine_pre_sharp_20k.log`, 215 ms/it). E_τ falls in 99 of the 100 windows (the one rise is 3e-4), to 0.167^2 of its start. The volume-weighted L2 of p′ is 0.47-0.51 of its first over 1000-2000, and 0.022 at 20000. Max |p′| is 2.7-3.5× over 1000-2000, peaks at 4.98× at 3600 in the core duct, and is 0.35× at 20000. The residual is 7.9e-2 at 200, 0.61 at most over 1000-2000 (12.9× the value at 100), 1.31 at 5600, and 9.9e-2 at 20000. The late vector is pressure-poor (E_p/E_τ 0.04, the cosine between windows 0.83 and rising), with a decay of 0.999984 per iteration over 16000-20000. Its max |p′| sits in the core duct beside the plug, core(492, 0), x 2.37 m.
- **The core-duct stand-in** (the core block from the asset's nodes, walls on jmin and jmax). A power iteration with far field / outflow ends, sharp limiter, gives max |p′| 1 → 0.016 and the residual 0.16 → 1.8e-3 by 20000, with E_τ windows ≤ 1.02. Arnoldi on G^100 (40 vectors, the smooth limiter, whose slopes are central at this amplitude, so the map is linear) with a wall / outflow pair (no far-field switch) gives a leading Ritz value |λ| = 1 + 4.5e-7 per iteration (residual 2.6e-3, pressure-free: the neutral entropy / vortical family at rest). Every Ritz value that carries pressure is ≤ 0.99999 per iteration. **Spectral radius 1: the neutral family, with nothing outside the unit circle.** The block alone does not show the engine's max |p′| growth, so that growth is energy that the large blocks hand to the core duct's small cells.
- **Verdict: a non-normal transient.** The energy decays monotonically. Max |p′| and the residual, which weight small cells (the residual is the unweighted mean of (R_ρ/V)²), grow transiently 3-5× and 10-28×, then decay. The decay is slow (thousands of iterations): by 20000 the residual is still 2.1× its value at 100. So rule 1b fails for the linear part too: its residual is not an energy norm. Whether 1b moves to an energy-weighted residual is a decision. D4-70 does not let the window be changed here.
- *Found on the way (not the contract):* with the smooth limiter (D4-25's trial form) and a far-field boundary, G has a **genuine growing mode**, 1.00289 per iteration, pressure-free, at the far-field / wall corner of the stand-in (core(0..2, 14)). A power iteration from that Ritz vector holds the shape (cosine 0.99998) and the rate for 3000 iterations. With the sharp limiter the same start decays (0.99996 per iteration). The far field's inflow/outflow switch on the sign of u_n (§5) makes G non-additive at rest, so Arnoldi with a far field is only a candidate finder: the power iteration is the proof. It matters if D4-25's smooth form is ever adopted.

*D4-77 (round 11, 2026-10-29): rule 1b's residual is in the same volume-weighted norm as 1a*, `residualDensityL2Volume` = sqrt(Σ_c b_c V_c (R_ρ/(b_c V_c))² / Σ_c b_c V_c) of stage 1 (§11), in place of the cell mean. It rests on the definition (the energy norm of D4-72, and the standard convergence monitor), it is a change after seeing data (D4-69's decaying linear part fails the cell-mean form), and it does not loosen 1a. **The rule in force for any D4-63 fix until D4-79 (below), which replaces its window:** (1) the D4-63 case is finite to 2000 iterations, and over iterations 1000-2000 (a) the volume-weighted L2 of p′ is at most 2× its first and (b) the volume-weighted density residual is at most its value at iteration 100; (2) every row that passes now still passes (as stated above). Max |p′| and the cell-mean residual are reported beside it (`tests/ladder/cases/d463.ts` rows 3 and 4).

*D4-77's results (round 11; `reports/scratch/r11/diag.ts`, the case's start, solver and norms with the residual's location; logs in `r11/logs`).* The contract run reproduces round 9's numbers (max |p′| 2.44 at 100, 5.43 at 200; cell-mean residual 12.44 at 100), and the linear run round 10's (cell-mean residual 7.914e-2 at 200, the same digits).

| run | (a) L2(p′), late max / first (≤ 2) | (b) weighted residual, late max / at 100 (≤ 1) | cell-mean residual, late max / at 100 (reported) | max \|p′\|, late max / first (reported) |
|---|---|---|---|---|
| **the D4-63 case** (1e-3, isothermal, the contract) | 1.717: pass | **2.614: FAIL** (3.55 at 100, 9.28 at 1500, 6.87 at 2000) | 11.95 | 8.39 |
| the linear part (1e-6, isentropic) | 0.505: pass | **1.092: FAIL** (1.19e-2 at 100; 0.81-1.09 of it from 200 to 2000) | 12.19 | 3.57 |
| the linear part at 20000 (round 10's vector) | 0.022 | **0.14** | 2.10 | 0.35 |
| trial, not the contract: the D4-63 case at minMach = M_cut = 0.02 (D4-59's setting; scratch only) | 0.778: pass | **1.435: FAIL** (1.81 at 100; 1.19-1.44 of it from 300 to 2000) | 15.85 | 4.21 |

- **Where the weighted residual grows (the contract).** At iteration 100 it sits where the wave starts, in the upstream (42 %) and far-field (29 %) blocks. Over 1000-2000 it sits in the far-field block's interior (31-55 %; r 2.4-4.7 m, x 1.8-7.9 m, the rows 7-15 inside its outer boundary row), the plume-bypass block (15-19 %) and the plume-outer block (9-14 %). No cell carries more than 2 %. The far-field block is 80 % of the volume and the two plume blocks 1.6 % and 1.4 %, so per unit volume the plume blocks carry 8-12× the mean. The cell-mean form sits in the core block instead (40-78 %, r 0.26-0.29 m, V ~ 1e-6 m³ per radian): that is round 10's small-cell weighting, which D4-77 removes.
- **The linear part is non-growing in D4-70's sense (decay in the limit), and still fails the window, narrowly.** Its weighted residual is flat (0.81-1.09× its value at 100) through 2000 while L2(p′) falls to 0.5, and it is 0.14× by 20000 (the cell mean is still 2.1× there). It fails the 1000-2000 window by 9 % because its decay is slow, not because it grows.
- **The contract's nonlinear part grows in the energy norm.** Its L2(p′) rises to 1.27-1.72× while the linear part's halves, and its weighted residual rises 2.6× within the window, in the outer and plume blocks rather than at the axis. D4-68 found that no local Δp form removes it.
- **The floor trial** (one scratch run, for the decision only) removes the nonlinear part's energy growth: L2(p′) is 0.50-0.90× over the run, like the linear part. Its weighted residual still fails (b): flat at 1.2-1.4× its value at 100 from iteration 300 on, spread over the far-field (22-32 %), plume-bypass (15-26 %) and core (14-19 %) blocks. So (b) fails for both runs whose energy decays (the linear part and the floored case), each with a flat weighted residual over 1000-2000.
- **D4-63 stays open; the pin stays `it.fails`.** No scheme change was made. The candidates, for a decision:
  - *Rule (b)'s window.* A run whose energy decays still fails (b) when its weighted residual decays slowly: the linear part (flat through 2000, 0.14× by 20000) and the floored case. A test of decay in the limit (D4-70's definition) would separate those from growth, for example the weighted residual over 2000-4000 at most its maximum over 1000-2000. That changes the window, which D4-70 reserves to a logged decision. The contract's nonlinear part would still have to pass it.
  - *A β floor.* minMach 0.02 takes the contract's L2(p′) from 1.72× to 0.78× but leaves (b) at 1.43×. D4-59 did not adopt 0.02 globally, because R fails its convergence rule 2 there. A floor that applies only where p′/(ρβ²c²) is large (an amplitude-aware β²) is the narrower form, and it is not run.
  - *A local time-step limit.* Cap τ_c where the pseudo-time nonlinearity u/(βc) ≈ p′/(ρβ²c²) per step is large, or limit τ's ratio between neighbours (its per-cell weights span 9e-4 to 13, the non-normal factor of D4-69). This changes the iteration map but not the steady state. It cannot change the linear part's semi-discrete transient (round 9), so it can address only the nonlinear part. It is not run.

*D4-79 (round 12, 2026-10-29): rule (b) judges decay in the limit*, D4-70's definition of "non-growing", with round 11's evidence: a decaying non-normal transient can fail any early window (the linear part's weighted residual is flat through 2000 and 0.14× its value at 100 by 20000), so the 1000-2000 window does not test it. **The rule in force for any D4-63 fix** (it replaces D4-77's window, not its norms): (1) each D4-63 case, the contract (`tests/ladder/cases/d463.ts`: 1e-3, isothermal) and the linear part (`cases/d463lin.ts`: 1e-6, isentropic), runs **20000 iterations**, finite throughout, and (a) the volume-weighted L2 of p′ is at most 2× its first over iterations 1000-2000 (unchanged) and at iteration 20000; (b) the volume-weighted density residual (§11) at 20000 is at most its value at 10000 and at most its value at iteration 100; (2) every row that passes now still passes: L1-L7, L8's velocity row with its steadiness, the L9 value rows, and §12.1/§12.2's rows. Reported beside it: L2(p′)'s max over 1000-20000, D4-77's window (the weighted residual's max over 1000-2000 over its value at 100), max |p′| over 1000-2000 and at 20000, and the cell-mean residual at 20000 over its value at 100 (`d463.ts` rows 5-9). The ladder runs the contract case (`tests/ladder/d463.test.ts`, about 75 min alone); the linear part runs alone through `tests/ladder/runCase.ts d463lin`.

*D4-81 (round 13, 2026-10-30): the scheme change for D4-63, in D4-81's order, under D4-79's rule as written (the plan, written before the runs).* Round 12's contract case grows for real (L2(p′) 4.36× its first at 10000 and 5.39× at 15000; the weighted residual 8.73 at 10000 and 10.0 at 15000 against 3.55 at 100), so no window closes D4-63. Round 12's local time-step trial is not adopted and is reverted. The runs go one at a time, each to 20000 iterations with checkpoints every 100. The gated rows are D4-79's (a) and (b), and row R stays excluded (the sharp limiter's floor, pinned):
1. *The plain scheme* (`tests/ladder/cases/d463plain.ts`: no preconditioning, the plain default CFL 1.5, round 9's plain run carried to 20000). It shows whether the preconditioning is the source of the growth. It is not a candidate, because the engine needs the preconditioning for convergence at low Mach (L7).
2. *A global M_cut* (`lowMachPreconditioning.globalMachCut`, off by default, so D4-40's 0.003 contract is untouched). It is one floor, the same in every cell, which the caller ties to the domain's peak velocity: the standard global cutoff (Weiss & Smith 1995; Turkel's β² ≥ K M_ref²), with D4-59's rationale that 0.02 is about 4 % of the engine's inlet Mach of about 0.5. It raises minMach and M_cut to the cut: β ≥ the cut in every cell and in the far field's characteristics, and the flux scaling's M_cut ≥ the cut. An M_cut ≥ 1 (the scaling off) and a minMach ≥ 1 (the plain scheme) are unchanged (`precondition.test.ts`). It is run at 0.02 (`cases/d463mcut02.ts`), then at 0.05 (`d463mcut05.ts`) only if 0.02 fails.
3. *If a candidate passes (a) and (b)* on the contract case, the full ladder (`npm run test:ladder`) is run with the cut on every preconditioned run, as D4-59 applied it: L7's M 0.01 sphere, L8, §12.2's C-pre and S, and the d463 case. Every row that passes now must still pass. D4-79's rule also takes the linear part (`d463lin`) at the candidate. The WGSL kernel is not changed in this round: its mirror is D4-40's adapter default, as a parameter.
4. *If both cuts fail*, no new scheme is tried this round: the data go back to the orchestrator.

*D4-81's results (round 13; each run alone and detached, about 72 min; logs in `reports/scratch/r13/logs`).* The contract case (1e-3, isothermal), 20000 iterations:

| row | M_cut 0.003, the contract until D4-81 (round 12, killed at 16000) | plain scheme (CFL 1.5) | global M_cut 0.02 (`d463mcut02`) |
|---|---|---|---|
| (a) L2(p′) / first, max over 1000-2000 (≤ 2) | 1.717: pass | 0.366: pass | 0.778: pass |
| (a) L2(p′) / first at 20000 (≤ 2) | not reached (5.21 at 16000) | **0.0433: pass** | **0.488: pass** |
| L2(p′) / first at 10000 (reported) | 4.36 | 0.0735 | 0.524 |
| (b) weighted residual at 20000 / at 10000 (≤ 1) | not reached | **0.641: pass** | **0.524: pass** |
| (b) weighted residual at 20000 / at 100 (≤ 1) | not reached (2.48 at 16000) | **0.159: pass** | **0.223: pass** |
| weighted residual at 100 / 10000 / 20000 | 3.548 / 8.73 / – | 3.89e-2 / 9.63e-3 / 6.17e-3 | 1.806 / 0.771 / 0.404 |
| reported: L2(p′) / first, max over 1000-20000 | ≥ 5.39 (15000) | 0.366 (1000) | 0.778 (1000) |
| reported: D4-77's window (weighted residual, max over 1000-2000 / at 100) | 2.614 | 1.147 | 1.435 |
| reported: max \|p′\| / first, max over 1000-2000; at 20000 | 8.39; – | 5.95; 1.51 | 4.21; 0.92 |
| reported: cell-mean residual at 20000 / at 100 | – | 1.80 | 2.50 |
| signature: finite, peak max \|p′\| / first (< 100) | finite to 16000 | 6.59: pass | 4.21: pass |

- **The plain scheme decays (run 1): the preconditioning is the source of the growth.** From the same start, its L2(p′) falls every 1000 iterations from 0.365 at 1000 to 0.07 at 10000, then holds at 0.03-0.06 to 20000. Its weighted residual peaks at 4.47e-2 at 2000, falls to 9.6e-3 by 10000, and sits at 5-8e-3 from 13000 to 20000. Over the same 10000 iterations the contract's L2(p′) rose to 4.4× and its residual to 2.5× its value at 100. Max |p′| (the pointwise measure D4-72 replaced) reaches 3-6× its first before 5000, and it is 1.5× at 20000. The cell-mean residual ends at 1.8× its value at 100: that is round 10's small-cell weighting, which D4-77 removes.
- **The global M_cut 0.02 passes D4-79's (a) and (b) (run 2), so 0.05 is not run.** `cases/d463mcut02.ts` reproduces round 11's 0.02 trial through 2000 (L2 0.778 at 1000; the weighted residual 1.806 at 100). After 2000 its weighted residual falls: 2.59 at 2000, 0.59-0.63 over 7000-9000, 0.77 at 10000 (a local high; 0.60 at 11000), 0.33-0.42 over 15000-20000, and 0.404 at 20000. That is 0.52× its value at 10000 and 0.22× its value at 100. L2(p′) never rises above its 1000 value: 0.52 at 10000 and 0.49 at 20000. Max |p′| is 0.92× its first at 20000.
  - *What it does not show:* over the last 7000 iterations the decay is slow. L2(p′) holds at 0.48-0.51 from 13000 to 20000, and the weighted residual at 0.33-0.42 from 15000, ending 0.35 → 0.40 over the last 1000. The plain scheme falls to 0.04 over the same run. D4-79's rule compares only the values at 100, 10000 and 20000, and it passes on them, but those values do not show decay over 15000-20000.
  - *Under the pre-stated rule it is the candidate,* pending rule 2: every row that passes now must still pass in the full ladder with the cut on every preconditioned CPU run (`tests/ladder/oracle.ts` `GLOBAL_MACH_CUT`), and the linear part must pass at the cut. The d463 pin (`d463.test.ts`) is lifted. In force, its configuration is minMach = M_cut = 0.02, D4-59's.
- **Rule 2, the full ladder with the cut (round 13, `npm run test:ladder` at 8447e99).** Every row that passes at 0.003 still passes at 0.02, with D4-59's values to the digits shown:

| row | 0.003 (round 11's ladder of record) | global M_cut 0.02 |
|---|---|---|
| L1-L6, L9a, L9b (no preconditioning) | pass (L9a's steadiness, and the L8/L9 convergence rows, fail as of record) | the same rows pass and fail |
| L7 M 0.01 (96 × 96): asymmetry, sequence 24/48/96 | 0.0131, falling (0.135 / 0.044 / 0.013) | 0.0109, falling (0.128 / 0.039 / 0.011): pass |
| L7: \|Cd\| | 0.0016 | 0.0013: pass |
| L7: iterations M 0.01 / M 0.3 (≤ 3) | 1.048 | 1.779 (14734 at M 0.01): pass |
| L8 velocity (< 1 %), steadiness (≤ 1e-3) | 0.449 %, 2.0e-5 | 0.754 %, 3.2e-5: pass |
| L8 convergence (fails at 0.003) | not at 37500 | not at 37500 |
| §12.2 C-pre after 1 / 10 / 100 | 1.43e-7 / 1.80e-7 / 2.26e-6 | 1.43e-7 / 1.79e-7 / 1.06e-6: pass |
| §12.2 S after 1 / 10 / 100 | 7.3e-8 / 1.6e-7 / 4.7e-7 | 1.25e-7 / 1.11e-7 / 2.02e-6: pass |
| §12.2 C tracking, C physical; floor | pass | the same values: pass |
| D4-63 (d463, the ladder's run) | (b) fails, pinned | the same configuration as run 2 (results in the handoff) |



**Low-Mach preconditioning (tracking mode only; decision D4-10).** Without it the pseudo-time step is set by the acoustic speed |u| + c while the flow converges at the convective speed |u|, so the iterations to converge grow like 1/M (ladder L7: the M 0.01 sphere did not converge in 20000 iterations, the M 0.3 sphere took 3096). The option `lowMachPreconditioning: { minMach }` multiplies the pseudo-time derivative of the pressure by 1/β² (Turkel's preconditioner with α = 0 in the variables (p, u, v, rw, s, Z), equivalent for this gas to Weiss & Smith 1995). Per cell, from the stage-1 primitives and frozen for the three stages like τ:

```
β²_c = min(1, max((u² + v² + w²)/c², minMach², Δp_c/(ρ c²)))      Δp_c = max over the 4 face neighbours |p′_nb − p′_c|
```

The pressure term (Weiss, Maruszewski & Smith 1999, their ε|Δp/ρ|^½ limit of the reference velocity) keeps the preconditioner off where a pressure difference drives a flow that has not started yet: a duct started from rest with a 1 % pressure drop diverged without it. The neighbours are the stage-1 primitives of the cell's four face neighbours (ghosts included, after their BCs).

The local time step uses the preconditioned spectral radius of each face, in place of |u·s| + c|s|:

```
λ_f = b_f |s| ½((1 + β²)|vn| + sqrt((1 − β²)² vn² + 4 β² c²))        vn = u·s/|s|
```

(β² = 1 gives |vn| + c). **Each face takes the larger of its two cells' (§17, W2S-I1):** λ_f = b_f |s| max(r(q_c, β_c), r(q_nb, β_nb)), with r the bracket above, the neighbour's own β (a ghost's: its source cell's) and its sound speed from its own (p′, ρ′, Z); a slip-wall face keeps the cell's own. Without preconditioning (and with minMach ≥ 1) the step is the cell's own, as before. After the point-implicit division, the stage increment δU_c = U^(k) − Uⁿ of each cell is replaced by

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

`residualDensityL2Volume` = sqrt(Σ_c b_c V_c (R_c,0 / (b_c V_c))² / Σ_c b_c V_c) from the same stage, kg/(m³ s): the same residual in the volume-weighted norm (D4-77), the one D4-63's rule 1b judges. The oracle reports it beside the cell mean (`IterationStats`); the cell mean weights every cell alike, so on the r-weighted mesh the near-axis cells dominate it.

## 12. Where f32 differs, and what w2/solver must meet

### 12.1 Expected f32 differences
- **Exact in f32 as in f64**: the quiescent ambient (every flux, source and BC value is an exact zero, ladder L1 quiescent is bitwise) and the conservation across interfaces (bitwise-equal or negated face fluxes, §7). The wall fluxes of mass, angular momentum, energy and fuel are exact zeros too (pressure-only wall flux, §7).
- **Rounding-level in f32**: the free stream with u∞ ≠ 0 (u = (ρu)/ρ is not bitwise u∞), the 3-step Newton (converges to about 1e-7 relative instead of 1e-15), the inflow BC (sqrt of an enthalpy difference), pow/log in the inflow isentrope.
- **Metric rounding** (12.3): the f32 asset's Σ S_x is not zero. This affects the f64 oracle and the GPU equally, since both read the same metrics.
- **Accumulation order**: the kernel's per-face accumulation order may differ from the oracle's; sums agree to rounding.
- **Limiter switches**: ab > 0 and the positivity test are discontinuous; near a shock or an extremum, an ulp can flip a branch and the two runs then differ locally by O(the jump) for a few iterations.

### 12.2 Tolerances for the GPU kernel against the oracle (W0G-N4)

Protocol: the same mesh (the row's, below; always with f32 metrics, the numbers the GPU reads) and the same f32-representable initial state on both, the same options (the oracle's defaults unless the row names one); compare after N iterations. The set-ups, the perturbation and the error metric are exported by `tests/ladder/oracle.ts` (`closedBoxMesh`, `closedBoxOptions`, `smoothPerturbation`, `sinkCase`, `relativeError`); the f32-storage experiment (`tests/ladder/cases/f32.ts`) and the GPU tests import the same module. A field the oracle leaves exactly unperturbed (S_q = 0, such as Z in the sink) must stay exactly so. For each primitive field q ∈ (ρ′, u, v, rw, p′, Z) and T′, the **relative error** is e_q = max_c |q_GPU − q_ref| / S_q with the perturbation scale S_q = max_c |q_ref − q∞| (velocity components share S = max |(u − u∞, v, w)|).

| case | N | must hold |
|---|---|---|
| A. quiescent ambient, real mesh (the 130k asset, f32 metrics); plain and preconditioned tracking and physical time | 1, 100 | every state value bitwise 0 |
| B. uniform M 0.5, real mesh, walls remapped to far field | 100 | max |u − u∞| ≤ 10 × the oracle's (the oracle's is a property of the f32 metrics, 12.3); the residual over the flux scale ≤ 2e-10 (below, D4-62) |
| C. smooth field (acoustic pulse + swirl + a hot fuel-air spot, `smoothPerturbation`) in the closed box (`closedBoxMesh`: three wiggled 20 × 12 blocks over 0.6 × 0.15 m with a max/max and a min/min interface, slip walls and the axis, D4-12), plain tracking (`closedBoxOptions('tracking')`, CFL 1.5) | 1 / 10 / 100 | e_q ≤ 1e-5 / 1e-4 / 1e-3 |
| C-pre. the same, **preconditioned tracking at the engine's settings** (`closedBoxOptions('preconditioned')`: minMach = M_cut = 0.003, so β², the δU update, the D4-20 scaling and the default CFL of §10 are all exercised) | 1 / 10 / 100 | e_q ≤ 1e-5 / 1e-4 / 1e-3 |
| C, physical time (SSP-RK3, the oracle's dt) | 1 / 10 / 100 | e_q ≤ 1e-5 / 1e-4 / 1e-3 |
| D. Sod tube (ladder L2 set-up), physical time | 100 | L1 relative error of ρ′ and p′ ≤ 1e-3 (limiter switches, 12.1) |
| E. a blockage + source cell set (ladder L5/L8/L9 set-ups) | 10 | e_q ≤ 1e-4; the residual over the flux scale ≤ 3e-7 (E-L5) and 1e-10 (E-L9a) (below, D4-62; D4-71) |
| S. ladder L8's sink (`sinkCase({ minMach: 0.003 }, 'f32')`: 64 × 24 polar mesh, slip wall inside, the preconditioned far field outside, the point-implicit sink source), preconditioned tracking from the ambient at rest | 1 / 10 / 100 | e_q ≤ 1e-5 / 1e-4 / 1e-3 |
| any other row (A, C, C-pre, C physical, D, S) | any | the residual L2 within 1e-3 relative of the oracle's: |r_GPU − r_ref| / r_ref ≤ 1e-3 |

**The residual check on rows B and E: over the flux scale (decision D4-48, after D4-39).** This is a change of normalisation only. The tolerance stays 1e-3, and the row's other checks are unchanged. On B (a uniform stream, whose residual is the f32 metric defect F∞ Σ S_x of 12.3) and on E (blockage and source set-ups near their steady states), the residual is a small difference of large face fluxes. Dividing the GPU's difference by the residual itself is then ill-posed in f32: the denominator is itself an f32 cancellation. These two rows divide by the flux scale instead:

```
|r_GPU − r_ref| / r_flux ≤ 1e-3        r_flux = sqrt(mean_c (Σ_f |b_f F_f,ρ| / (b_c V_c))²)
```

r_flux is the density residual's L2 (§11) with every face's mass flux counted positive. It is the oracle's, in f64, at the compared state: `ReferenceSolver.residualFluxScale()`, the tracking residual's face fluxes (every block; interface faces counted once per side, as the residual assembles them; `tests/unit/flow/solver.test.ts` checks it against the face-by-face sum). Without volume sources r_ref ≤ r_flux (the triangle inequality, per cell), so the flux-scale form is looser by the factor r_flux / r_ref, which is exactly the cancellation that made the residual form ill-posed. r_ref is the stage-1 residual of the last iteration and r_flux the state after it; for a scale, that one-iteration offset does not matter. Measured by w2/solver (round 2): E-L5 is 1.05e-3 over the residual and 2.7e-8 over the flux scale, and E-L9a is 6.6e-9 and 2.5e-12.

**The flux-scale tolerances (decision D4-62, round 9; tightening only).** At the 1e-3 of D4-48 rows B and E could not fail: r_flux / r_ref is 3.9e4 on E-L5 and 1.15e10 on B (W2R-I11), so E-L5 would pass a GPU residual 39× the oracle's. D4-62 sets each row's tolerance from the f32 error model, at ten times the measured error on the flux scale. *The model.* The GPU's density residual differs from the oracle's by the f32 rounding of what it sums: each flow face carries the gauge flux G_f of §14.4 (F_f less the free stream's flux, exact zero for the free stream), evaluated in a few dozen f32 operations of relative step ε = 6e-8, and §14.6(a) sums a cell's faces compensated, so the sum adds nothing of that order. The cell's error is then k ε Σ_f |b_f G_f,ρ| with k = O(1), and over the flux scale
```
|r_GPU − r_ref| / r_flux ≈ k ε r_G / r_flux        r_G = r_flux with G_f in place of F_f
```
(plus the part of the stored states' own difference after N iterations, which is of the same order for a stable smooth run). So the model bounds the row by k ε r_G / r_flux ≤ k ε, and r_G / r_flux is a property of the set-up: about 1 where the free stream is at rest (E-L5 and E-L9a, u∞ = 0, G = F), far below 1 where the faces carry mostly the free stream (B, a uniform M 0.5 stream whose gauge fluxes are the f32 metric defect of §12.3). The measurements: E-L5 2.67e-8 = 0.45 ε, at the bound; B 1.27e-11, the free stream removed by the gauges; E-L9a 2.46e-12, far below the bound (its mass fluxes at 10 iterations are mostly exact in f32, or their roundings cancel; the model does not resolve it). An upper bound of k ε would leave B and E-L9a 1e4-1e5 × slack, the failure D4-62 is about, so the tolerance is per row: **ten times the measured error, rounded up to one significant figure.** The measurements are the GPU's in the merged `test:gpu` of critic pass 10 (2026-10-28, Dawn; LOG.md "Critic pass 10") and the w2-solver-int handoff (B), with the kernel of record (§14.3-14.6, the D4-44 mirror):

| row | measured, over the flux scale | tolerance (was 1e-3) | margin to 1e-3 |
|---|---|---|---|
| B (uniform M 0.5, real mesh, 100 iterations) | 1.27e-11 | **2e-10** | 5e6 × tighter |
| E-L5 (blockage duct, 10 iterations) | 2.67e-8 | **3e-7** | 3300 × tighter |
| E-L9a (rotor disk sources, 10 iterations) | 2.46e-12 | **1e-10** (D4-71; was 3e-11) | 1e7 × tighter |

Each row stays 10-16× above its measurement, D4-62's margin, except E-L9a. **D4-71:** E-L9a's 3e-11 sat inside the f32 rounding of the norm it compares (W2R-I17), so it is 1e-10 (40× its measurement), above that floor. A kernel change that moves the GPU's f32 arithmetic (operand order, a new f32 form) re-measures the three numbers and restates the rows through the orchestrator; a row is never loosened to pass. The residual-over-residual rows of the other cases (1e-3) are unchanged, and E-L5's extra 1e-6 over the flux scale (round 2) is subsumed by 3e-7. *Kernel side (the solver's tests follow §12, D4-62):* `tests/gpu/oracle.test.ts` (E-L5, E-L9a: `fluxScaleError` against these values in place of `TOL_RESIDUAL` and the 1e-6) and `tests/gpu-ladder/ladder.test.ts` (B's residual row). **D5-6 (W3S-I1, w3/scheme round 3):** E-L9a's row compares r_GPU with the oracle's residual of the GPU's own U⁹, K2 = |r_GPU − L2 R_ref(U⁹_GPU)| / r_flux, at the same 1e-10; the form above is printed beside it (§17.1).

Basis: f32 has a relative step of 6e-8; one iteration rounds each face flux and cell update a few dozen times, and the gauges keep that relative to the perturbation, so one iteration lands near 1e-6 and growth is at most linear over N for a stable smooth run. The f32-storage experiment in `tests/ladder/f32.test.ts` (the oracle with its state rounded to f32 after every stage) measures the storage part of this on the rows' own set-ups, and the table must sit ≥ 10× above it. Measured (2026-10-27, `tests/ladder/oracle.ts` set-ups, f32 metrics, after 1 / 10 / 100 iterations):

| row | storage error | margin to the tolerance |
|---|---|---|
| C, plain tracking (CFL 1.5) | 1.7e-7 / 1.1e-6 / 7.8e-7 | 59 / 90 / 1300 × |
| C-pre, preconditioned tracking (engine settings, CFL 0.8) | 1.1e-7 / 1.7e-7 / 5.1e-7 | 93 / 590 / 2000 × |
| C, physical time | 8.0e-8 / 2.4e-7 / 4.2e-6 | 125 / 410 / 240 × |
| S, the L8 sink, preconditioned (CFL 0.8) | 7.3e-8 / 1.8e-7 / 6.3e-7 | 140 / 570 / 1600 × |

(Before W2R-I2 the box ran with f64 metrics: 1.9e-7 / 4.4e-7 / 1.4e-6 tracking, 8.4e-8 / 2.4e-7 / 1.3e-5 physical time.) At the plain CFL 1.5 the C-pre set-up diverges (NaN at iteration 79, §10), so these rows also check that the kernel takes the preconditioned default CFL. If the preconditioned scheme changes (§7, §10), the C-pre and S rows are re-measured with it. A tolerance changes only through an orchestrator decision.

### 12.3 The f32 metrics and ladder L1
The f32 asset rounds the face vectors, so a cell's Σ S_x is not zero but of order 6e-8 |S|. In uniform flow that is a residual F∞ Σ S_x in every cell, and the steady state carries a perturbation that grows along streamlines. `tests/ladder/l1.test.ts` reports the asset's worst Σ S_x defect and the spurious velocity the oracle develops with the f32 asset. If it exceeds L1's 1e-4 m/s, the remedy belongs to the mesh asset (f64 metrics, about 5 MB more at 130k, or face vectors computed so that their f32 sums telescope exactly), not to the kernel.

### 12.4 The GPU convergence floors (D4-38, restated by D4-58)
"Converged to 1e-5" is the oracle's stopping rule, in f64. The GPU's L4 (a) and L5 runs use D4-38's instead: the density residual has reached its f32 plateau, at or below the stated floor × the first iteration's residual, and the accuracy metric (L4 (a) Mach and mass flow, L5 mass flow) changes by less than 1e-4 relative over the last 2000 iterations. The accuracy rows remain the checks of record. **The floors are the oracle's own with f32 storage** (`storage: 'f32'`, the state rounded to f32 after every stage, sharp limiter): the minimum of the residual over the first, over the last 2000 of 20000 iterations. **L4 (a) 1.6e-4, L5 1.1e-3** (`GPU_CONVERGENCE_FLOOR` in `tests/ladder/oracle.ts`, which the GPU tests import). `tests/ladder/floor.test.ts` re-measures them (1.590e-4 and 1.096e-3) and checks two things: that the stated values are the measurement to two significant figures, so a scheme change that moves the oracle's floor shows there and the floor is restated with it; and that the same runs in f64 fall at least 100× lower (6.4e-13 and 5.9e-12), so the plateau is the f32 storage of a residual that is a small difference of large fluxes, not the scheme (D4-47 as corrected by D4-58). D4-38 first stated 4e-5 and 1.7e-4, which sit below the oracle's own f32 floor. The GPU's measured plateaus (3.99e-4 and 7.5e-3, D4-47) are still above the restated floors. That gap is f32 arithmetic beyond storage, so the GPU convergence rows stay KNOWN-FAIL with the measured gap (D4-58).

## 13. Notes for W3

- **The far field at static conditions.** The linearised far field (3) imposes w₋ = 0, which for a steady inflow of speed |u_n| through the boundary means p′_b ≈ −ρ∞c∞|u_n|: with the static engine's suction at the far-field boundary (about 1 m/s), the whole field sits a few hundred pascals low. The upstream inflow boundary (4) uses total conditions and has no such offset. If L12 shows the offset, switch the lateral far field to total conditions on inflow faces too.
- **Corner ghosts** (W0M-N4): none; the v1 plume eddy viscosity must build its face gradients from the cells the dimension-split stencil reads.
- **Interface kinks** (W1M-N5): see §6.

## 14. f32 implementation forms (w2/solver; D4-37, D4-41)

The GPU kernel evaluates some terms of sections 3-10 in a different but algebraically identical order, so that f32 rounds the perturbation rather than the free stream. Each form below states its identity; `tests/unit/flow/f32forms.test.ts` transcribes each WGSL form in f64 and shows that it agrees with the oracle's literal form to f64 rounding. The oracle keeps the literal forms. (D4-41 named this section 13; 13 already holds the notes for W3, so it is appended as 14. The reference does not edit it.)

**14.1 R(φ) − R∞ = φ (R_p − R_a)** (`gasRDelta`, wgsl/gas.ts). The ambient is air, R∞ = R_a, and R(φ) = R_a + φ(R_p − R_a) (§3). In f32, R_a + φ dR keeps only the high bits of a small φ dR (a third of it at φ 1e-4), which put an error of 3e-8 p∞ into every p′ and 1e-2 K into T′ of a lean fuel trace.

**14.2 The preconditioned density increment** (`preconditionIncrement`, wgsl/kernels.ts). §10's δρ′ ← δρ′ − (1 − β²) δp/c². With c² = cp R T / c_v (§3) and c_v = cp − R, δp/c² = δρ′ − n with the non-acoustic part

```
n = (Y δρ′ − δη + u δ(ρu) + v δ(ρv) + w δ(ρrw)/r_c) / (cp T),   Y = R∞ T′ + (R − R∞) T − ½(u∞² + q²) + Δe
```

so δρ′ ← n + β² (δρ′ − n). The literal order is the difference of two numbers equal to within β², a relative error ~1e-7/β² in f32 (2.7e-2 on ladder L8's sink at β² = 9e-6). The other five components keep the literal form.

**14.3 The momentum and velocity gauges.** The kernel stores (ρu)′ = ρu − ρ∞u∞ in place of ρu (§4's U_1) and carries u′ = u − u∞ in place of u in the primitive record (§4's q_1), with ρ∞, u∞ the kernel's f32 reference values (the host converts with ρ∞u∞ = fround(ρ∞) fround(u∞), exact in f64). Identities: u′ = ((ρu)′ − ρ′ u∞)/ρ; q² − q∞² = u′(u′ + 2u∞) + v² + w²; the MUSCL slopes and face values of u′ are those of u (differences and q ± σ/2); every absolute velocity the scheme uses (vn, q², the BCs, λ_c, β²_c) is u∞ + u′. The f32 free stream (u′ = 0, every other gauge 0) is then an exact zero of every gauge, like the quiescent ambient. The tracking update U + δU and the stage combinations are affine with weights summing to 1, so they act on (ρu)′ exactly as on ρu.

**14.4 Gauge flux differences** (`slau2`, wgsl/flux.ts; the stage kernel). Each flow face (not a slip wall) carries G_f = F_f − F∞(S_f), where F∞(S) = (ρ∞u∞, ρ∞u∞², 0, 0, 0, 0) S_x is the free stream's flux. With vn = vn∞ + δvn (vn∞ = u∞ n_x, δvn = u′ n_x + v n_r) and §7's g = 0 or not:

```
2 G_0 = ρ′_L vn_L + ρ′_R vn_R + ρ∞ (δvn_L + δvn_R) + (1 − g) V̄ (ρ′_L − ρ′_R) + g (ρ_L|vn_L| − ρ_R|vn_R|) − (χ/(c̄ f_a))(p′_R − p′_L)
ṁ   = ρ∞ vn∞ + G_0
G_1 = G_0 u∞ + ṁ⁺ u′_L + ṁ⁻ u′_R + p̃ n_x
```

(the first line is §7's ṁ − ρ∞vn∞ expanded, using V̄⁺ = (1 − g)V̄ + g|vn_L| and V̄⁻ likewise; the second uses ṁ⁺ + ṁ⁻ = ṁ). Components 2-5 are already gauges and unchanged. The cell residual adds the free stream's part back once: R_c = Σ_f ± b_f |S_f| G_f + (ρ∞u∞, ρ∞u∞²) Σ_flow faces b_f S_f,x − (sources), the sum computed in f64 from the stored metrics (`CELL_GEO.w`, layout.ts blockageData). Slip-wall faces keep §7's pressure-only flux and are left out of that sum. In f32 the f32 metrics' Σ S_x is then the only forcing of the free stream, exactly the oracle's (§12.3).

**14.5 p̃'s last term from the gauges.** β⁺(M) + β⁻(M) = 1 for every M, so β⁺(M_L) + β⁻(M_R) − 1 = β⁺(M_L) − β⁺(M_R) = ¼ (M_L − M_R)(3 − M_L² − M_L M_R − M_R²) for |M_L|, |M_R| < 1 (β⁺ = ¼(2 + 3M − M³)), with M_L − M_R = (δvn_L − δvn_R)/c̄. Otherwise the literal form. For equal states it is an exact zero; the literal β⁺ + β⁻ − 1 rounds to ~1e-7 and multiplies q̄ ρ̄ c̄ (7e-3 Pa per face at M 0.5).

**14.6 Compensated sums.** (a) The cell residual of §9 is a Neumaier (compensated) sum of its face fluxes and sources, per component. (b) U^n is the f32 state plus a per-cell low part (the `lo` buffer). Tracking: U^{n+1} = U^n + δU_3 is a TwoSum of the f32 part and (low part + δU_3), the rounding error kept as the new low part; stages 1 and 2 use the f32 part. Physical time: SSP-RK3 in its Butcher form U^{n+1} = U^n + ⅙ e_1 + ⅙ e_2 + ⅔ e_3 (e_k = E(U^(k−1)) − U^(k−1) with the point-implicit factor; identical to §10's Shu-Osher form), the weighted e_k accumulated in the low part and added to U^n as a TwoSum at stage 3; the stage values themselves are §10's. Increments below the state's ulp then accumulate at their exact rate (`tests/gpu/solver-exact.test.ts`). The primitives are computed from the f32 part.

**What the forms bought (D4-37, 130k asset, Dawn, 2026-10-27).** Ladder L1 uniform (M 0.5, 20k iterations): 2.0e-4 m/s with the literal forms; 14.4 alone 1.1e-4 at 2000; 14.4 + 14.6(b) 7.8e-5 at 2000; 14.3 + 14.4 + 14.6 2.9e-5; with 14.5's gauge Mach difference **2.1e-5, plateaued from iteration 200** (2.07e-5 at 200, 2.13e-5 at 20k), against the oracle's 1.44e-5 at 100 iterations (GPU − oracle per cell 8.4e-6, the f32 rounding of the free stream itself). With 14.3-14.5 in place, 14.6 changes L1 by less than 1e-8; it is what tightens the physical-time rows of 12.2 (D 7.7e-7 → 3.7e-8).

## 15. The kernel round: the global M_cut on the GPU (w2/kernel; D4-89, W2R-I19)

The reference does not edit this section (like §14), so the two branches' SOLVER.md edits stay disjoint.

**15.1 The mirror (D4-89).** D4-40's engine adapter default in `GpuFlowSolver` becomes minMach = M_cut = **`ENGINE_MACH_CUT` = 0.02**, the CPU ladder's `GLOBAL_MACH_CUT` (§10, D4-81/D4-89), as a parameter: `enginePreconditioning(machCut)` and `adapterPreconditioning` in `src/flow/gpu/params.ts`, `GpuFlowSolverOptions.machCut` (refused beside an explicit `lowMachPreconditioning`). **No WGSL changed:** the kernel already takes minMach² (β²'s floor, `wgsl/kernels.ts` beta pass) and M_cut (SLAU2's M_ref = min(1, max(β̄_f, M_cut)), `wgsl/flux.ts`) as uniforms, and the preconditioned far field's β∞² = max(M∞², minMach²) is a host-side BC constant (§5). The GPU scheme options also take the oracle's `globalMachCut` (w2/reference-9's `SolverOptions.lowMachPreconditioning.globalMachCut`) with its meaning: minMach and M_cut raised to the cut, an M_cut ≥ 1 and a minMach ≥ 1 kept (`tests/unit/flow/gpu/machCut.test.ts`: the same uniforms as minMach = cut). The GPU tests run the engine's preconditioning in force on both sides, minMach = M_cut = 0.02 (`tests/gpu/helpers/solver.ts` `ENGINE_PRECONDITIONING_CUT`): row A, C-pre, S, the moving-gauge rows, `solver-exact`, L8, and L7's M 0.01 sphere at max(M, 0.02), as the CPU ladder runs them; `forms.test.ts` adds 0.02 to SLAU2's M_cut values; `engine-stability.test.ts` pins the default's uniforms.
- **Coupling to w2/reference-9 (merged from main cf87af0 at 61433d9).** Its `tests/ladder/oracle.ts` has `GLOBAL_MACH_CUT = 0.02` and `ENGINE_PRECONDITIONING_CUT = { minMach: 0.003, globalMachCut: 0.02 }` (in force 0.02 / 0.02). The GPU tests pass the values in force (`tests/gpu/helpers/solver.ts`), and `tests/unit/flow/gpu/machCut.test.ts` pins the two sides (D4-93): `ENGINE_MACH_CUT === GLOBAL_MACH_CUT`, and the oracle's constant gives the GPU default's `stageParams` uniforms (tracking, BCs, physical). With either constant set to 0.03 the pin fails: the oracle's at 0.03 fails both pin tests while the four GPU-only tests pass, and `ENGINE_MACH_CUT` at 0.03 fails five of the six. §12.2's C-pre and S rows (minMach 0.003 in their text) run at the cut on both sides.

**15.2 D4-63 on the GPU at the cut (D4-89's question).** `tests/gpu-ladder/d463.test.ts`: D4-63's contract case (the 1e-3 wave, isothermal, at rest, the 130k asset) on `GpuFlowSolver`'s own default, 20000 iterations, checkpoints every 100. The GPU reduces only the cell-mean residual (§11), so at each checkpoint the GPU's state (f32 copy plus low parts) goes into an oracle shell with the GPU's own scheme parameters, which evaluates p′ and R(Uⁿ) in f64: the volume-weighted L2 of p′ (D4-72) and the volume-weighted density residual (D4-77). Check of that evaluation: the GPU's own cell mean (its last stage 1, R(Uⁿ⁻¹)) over the shell's cell mean is 1.009 at 20000 (0.97-1.04 over every checkpoint). D4-79's rule gates; the trend is reported. Dawn, 2026-10-30, 235 s at 0.003 and 457 s at 0.02 with 20000 extra iterations (`D463_GPU_EXTEND`).

| | GPU at 0.003 (D4-40) | GPU at 0.02 | CPU at 0.02 (w2/reference-9, D4-89) |
|---|---|---|---|
| (a) L2(p′)/first, max over 1000-2000 (≤ 2) | 1.717 | **0.778** | 0.778 |
| (a) L2(p′)/first at 20000 (≤ 2) | 5.480: FAIL | **0.486** | 0.488 |
| (b) weighted residual 20000 / 10000 (≤ 1) | 1.245: FAIL | **0.491** | 0.524 |
| (b) weighted residual 20000 / 100 (≤ 1) | 3.255: FAIL | **0.211** | 0.223 |
| signature: peak max \|p′\|/first (< 100) | 117.5: FAIL | 4.21 | 4.21 |
| weighted residual at 100 / 1000 / 2000 | 3.562 / 7.725 / 6.859 | 1.809 / 2.272 / 2.595 | 1.806 / 2.271 / 2.589 |
| weighted residual at 10000 / 15000 / 20000 | 9.314 / 9.434 / 11.595 | 0.777 / 0.358 / 0.382 | 0.771 / 0.414 / 0.404 |
| weighted residual over 15000-20000 (min-max) | | 0.298-0.427 | 0.332-0.465 |
| its log-linear trend over 15000-20000, per 1000 iterations | 1.033 | **0.994** | |
| L2(p′)/first over 13000-20000 (min-max); trend 15000-20000 | ; 1.018 | 0.482-0.532; 0.992 | 0.48-0.51 |
| past 20000 (reported): weighted residual at 25000 / 30000 / 35000 / 40000 | | 0.288 / 0.184 / 0.159 / 0.150 | not run |
| past 20000: its trend over 20000-40000, per 1000; max over 20000-40000 / at 20000 | | **0.953**; 1.16 (0.434 at 21000) | |
| past 20000: L2(p′)/first at 30000 / 40000 | | 0.411 / 0.328 | |

- **At 0.02 the GPU passes D4-79's rule on the contract case, and keeps decaying past 20000** (D4-89's question). Over 15000-20000 its weighted residual is flat within its oscillation (0.30-0.43, trend 0.994 per 1000; 0.358 → 0.382), as the CPU's (0.33-0.47); from 20000 to 40000 it falls 2.6× (0.382 → 0.150, 0.953 per 1000) and L2(p′) falls from 0.486 to 0.328. No growth, so D4-63 stays closed on the GPU as on the CPU.
- The GPU follows the CPU to 3-4 digits through 2000 iterations (L2 0.5846 / 0.7779 / 0.6987 at 100 / 1000 / 2000 on both), and later stays close: over the 200 checkpoints |GPU/CPU − 1| is 0.15 % at the median and 1.8 % at the 90th percentile in L2 (10 % at most, at 14500), 0.8 % and 12 % in the weighted residual (21 % at most; the small late residual oscillates, and a checkpoint samples its phase).
- At 0.003 the GPU reproduces D4-81's growth (CPU: L2 1.27× at 2000, 4.36× at 10000, 5.39× at 15000; residual 3.55 at 100, 8.73 at 10000, 10.0 at 15000), so the test fails without the mirror (its TDD commit).

**15.3 W2R-I19's rows at the cut (D4-62, D4-71, D4-93).** The flux-scale rows of §12.2 are in force on the GPU in place of D4-48's 1e-3 and round 2's extra 1e-6 on E-L5: **B ≤ 2e-10, E-L5 ≤ 3e-7, E-L9a ≤ 1e-10** (`FLUX_SCALE_TOLERANCE` in `tests/gpu/helpers/solver.ts`, read by `tests/gpu/oracle.test.ts` for E and `tests/gpu-ladder/ladder.test.ts` for B). B, E-L5 and E-L9a run the plain scheme, so the cut does not enter them; C-pre and S run the engine's preconditioning in force on both sides, minMach = M_cut = 0.02 (15.1). Measured by round 1's gate run (Dawn, 2026-10-30, test:gpu 23:51 and test:gpu-ladder 23:52-23:57, the code of b777653; logs `reports/scratch/k/g-gpu.log` and `g-gpuladder.log`, outside git):

| row | measured | must hold (§12.2) | margin |
|---|---|---|---|
| E-L5: the residual over the flux scale (10 iterations) | 2.67e-8 | ≤ 3e-7 | 11 × |
| E-L9a: the residual over the flux scale (10 iterations) | 2.46e-12 | ≤ 1e-10 | 41 × |
| B: the residual over the flux scale (100 iterations; r_flux / r_ref 1.15e10) | 1.266e-11 | ≤ 2e-10 | 16 × |
| B: max \|u − u∞\| | 1.95e-5 m/s | ≤ 10 × the oracle's 1.49e-5 | 7.6 × |
| C-pre at 0.02: e_q after 1 / 10 / 100 | 5.13e-7 / 3.77e-7 / 1.05e-6 | ≤ 1e-5 / 1e-4 / 1e-3 | 19 / 270 / 950 × |
| S at 0.02: e_q after 1 / 10 / 100 | 5.32e-7 / 4.77e-7 / 7.67e-6 | ≤ 1e-5 / 1e-4 / 1e-3 | 19 / 210 / 130 × |

- The three flux-scale numbers are §12.2's measurements of record (2.67e-8, 1.27e-11, 2.46e-12, critic pass 10 and w2-solver-int) to their figures: the mirror changed no WGSL (15.1), so the kernel's f32 arithmetic is the one the rows were set from, and D4-62's rule (re-measure and restate only after a change to it) does not fire.
- The suites in that run: test:gpu 70 passed (12 files), test:gpu-ladder 13 passed + 1 expected fail (L9a's D4-45 steadiness, `it.fails`, KNOWN-FAIL D4-57).

## 16. W2S-B1: the look-dev page's divergence and the outflow's backflow (w2/solver-diverge; D4-100)

The reference does not edit this section (like §14-15). The rule it adds is §5's backflow branch, in the oracle and the kernel alike.

**The finding (D4-100).** In the official P4flow capture the look-dev page's solver went NaN: "the density residual is NaN after 6759 iterations". The page (`src/lookdev/flowPanel.ts`) runs `GpuFlowSolver`'s default (the app's: thermally perfect, ISA SLS at rest, preconditioned tracking at minMach = M_cut = 0.02, CFL 0.8) but starts it from the timing state `perfState` (an axial jet of 60 m/s, swirl, a 2 % pressure wave and a hot fuel-air plume, T′ 300 K, Z 0.025; not a solution), and steps it at about 2 iterations per frame indefinitely. The app itself (`src/app/simWorker.ts`) starts the same solver from the ambient at rest, which, uncoupled, is an exact zero of every flux and source and stays bitwise ambient (20000 iterations, `tests/gpu-ladder/app-longrun.test.ts`).

**The reproduction (Dawn, 2026-11-01; scratch `reports/scratch/diverge/repro.ts`, `probe.ts`, `oracle.ts`).** Headless, the same configuration (the app's device limits, `step()` frames of 2 iterations with their resample) gives its first non-finite state at **iteration 6756** (the page read it back a few frames late). The run is deterministic: replayed from a saved state it repeats bitwise.
- *Where it broke:* the core duct's outer-wall row (block 5 `core`, i 510 of 534, j 15 of 16, x 2.53 m, r 0.43 m, near the core nozzle's exit). T′ there went 1077 → 1100 K at 6743, then grew 1.12-1.2× per iteration to 18,700 K at 6754, T′ −2600 K (T < 0) at 6755, and at 6756 the speed of sound (√ of a negative T) was NaN in 33 cells. The gas there was hot plume gas (T′ 300-1265 K, Z 0.010-0.017) flowing upstream (u′ −40 to −57 m/s) into the core nozzle.
- *Before it:* no jump from rest, a drift. The GPU's cell-mean residual never decayed (173 at 100, 362 at 1000, 536 at 2500, 250-340 from 4500). At the outflow (plume-core i 815-822, x 33.7 m) the jet **reversed between iterations 1000 and 2000** (u′ +43..+58 → −61..−231 m/s), and the axis cell at the outflow corner then ran back at −385 (3000), −550 (5000), −643 m/s (6700), Mach 0.90, while its T′ rose 321 → 519 → 814 → 1072 K. By 6000 backflowing hot gas (T′ 270-285 K, u′ −100 to −130 m/s) filled the plume-bypass, plume-outer and farfield blocks from x ≈ 8 m to the outflow. The initial maximum T′ was 300 K and nothing in the uncoupled field adds heat.

**The bisection.**

| run (GPU unless named; look-dev start unless named) | result |
|---|---|
| M_cut 0.02 (the app's default, D4-89), CFL 0.8 | non-finite at 6756 |
| M_cut 0.003 (D4-40) | non-finite between 6000 and 6100 (13,774 cells at 6100): **not D4-89's mirror** |
| the plain scheme (CFL 1.5) | finite to 12000; the residual falls 87 (1000) → 5.4 (12000); the jet keeps leaving through the outflow (+60 → +30 m/s), and the plume leaves by 8000 (max T′ 7.9 K at 12000) |
| M_cut 0.02 at CFL 0.4 | finite to 16000 but on the same pseudo-time path (max T′ 840 K at 10000 against 814 K at 5000 at CFL 0.8; 1388 K and Mach 1.12 at 16000): **semi-discrete, not a step limit** |
| the f64 oracle (pre-fix), from the GPU's state at 6700 | the same runaway to 4-5 digits (the wall cell's T′ 1100.4 / 1236.6 / 1392.1 K at 6743-6745, the GPU's 1100.4 / 1236.7 / 1392.2), non-finite at 6755 (16 cells): **the scheme, not f32** |
| the commits since w2/solver-int | the kernel's WGSL is solver-int's except the bitwise-equal solver-fix refactor; D4-89 changed only uniforms (15.1). The 0.003 row is that kernel, and it diverges too |
| the app's start (rest) | bitwise ambient to 20000, before and after the fix |
| with §5's backflow branch | finite to 20000 and D4-79's rule met (below) |

**The cause: the outflow's copy under backflow.** An outflow face whose flow reverses (vn < 0) is an inflow face, and a subsonic inflow takes four of its characteristics from outside. The copy specified all four from the cell itself (velocity, entropy, swirl, fuel), with only the static pressure fixed: the face fed the cell's own state back in, at a total pressure p_out + ½ρvn² that grows with the backflow and a total enthalpy that carries its kinetic energy in as heat. That is a positive feedback with no physical source: the reversed jet accelerated, and the plume gas it recycled grew hotter at every pass. The plain scheme never reversed its jet, so it never entered the loop; the preconditioned pseudo-time transient did (its pressure at the outflow fell 100-670 Pa below p_out at 1000-2000 while the jet decayed), at either cut. The final local runaway at the core nozzle's wall is where the recycled hot gas, now upstream, failed first; it is reproduced by the f64 oracle, so it is the scheme's response to that state, not f32.

**The fix (§5).** A backflow face takes the inflow ghost at the ambient's totals beyond it, (p0, T0) = (p_out, T∞), with no swirl and Z = 0, at the speed set by the cell's outgoing characteristic. The rationale is in §5. A face with vn ≥ 0 is bitwise unchanged.

**The long-run test** (`tests/gpu-ladder/app-longrun.test.ts`; D4-79's rule as `d463.test.ts` applies it, the norms in f64 through an oracle shell of the GPU's state; Dawn, 2026-11-01):

| row (the look-dev start, 20000 iterations, checkpoints every 100) | must hold | before (36fd594) | after (3513e28) |
|---|---|---|---|
| signature: finite to 20000, peak max \|p′\| / first | finite, < 100 | non-finite at the 6800 checkpoint | finite; 21.0 |
| (a) volume-weighted L2 of p′ / first, max over 1000-2000 | ≤ 2 | 0.793 (then NaN) | 0.659 |
| (a) the same at 20000 | ≤ 2 | NaN | 5.09e-4 |
| (b) volume-weighted residual 20000 / 10000 | ≤ 1 | NaN | 0.108 |
| (b) volume-weighted residual 20000 / 100 | ≤ 1 | NaN | 7.28e-3 |
| reported: max T′ over the run (start 299.9 K) | | 1072 K by 6700 | 303.8 K; 0.94 K at 20000 |
| reported: the GPU's cell-mean residual 20000 / 100 | | NaN | 0.0228 |
| the app's start (rest): every state word exactly 0 at 5000 / 10000 / 15000 / 20000 | bitwise | pass | pass |

The kernel follows the oracle on the backflow branch: `tests/gpu/oracle.test.ts`'s backflow row (an inflow/outflow duct with hot, fuelled, swirling gas flowing back in through the outflow, preconditioned at the cut) checks the outflow ghosts (no swirl or fuel enters, the rest within 1e-5 of the oracle's) and row C's tolerances after 1 / 10 / 100 iterations.

**D4-63's contract case with the backflow branch (GPU, `tests/gpu-ladder/d463.test.ts`, the same run of test:gpu-ladder, 2026-11-01).** The rest state's outflow faces carry tiny velocities of either sign, so the branch fires there too. D4-79's rows still pass, by more, and the slow late decay that D4-89 recorded (and 15.2 measured: flat over 15000-20000) is gone:

| | GPU at 0.02 before (15.2) | GPU at 0.02 with the backflow branch |
|---|---|---|
| (a) L2(p′)/first, max over 1000-2000 (≤ 2) | 0.778 | **0.445** |
| (a) L2(p′)/first at 20000 (≤ 2) | 0.486 | **0.0090** |
| (b) weighted residual 20000 / 10000 (≤ 1) | 0.491 | **0.163** |
| (b) weighted residual 20000 / 100 (≤ 1) | 0.211 | **0.0325** |
| signature: peak max \|p′\|/first (< 100) | 4.21 | 4.21 |
| weighted residual at 100 / 1000 / 2000 | 1.809 / 2.272 / 2.595 | 1.809 / 2.122 / 2.234 |
| weighted residual at 10000 / 15000 / 20000 | 0.777 / 0.358 / 0.382 | 0.360 / 0.160 / 0.0588 |
| its log-linear trend over 15000-20000, per 1000 iterations | 0.994 | **0.820** |

So part of what D4-89 recorded as the contract case's slow late decay was the outflow feeding its own state back in. The rows without an outflow face are unchanged in the same run (L1, B, L7: iteration ratio 1.779, L8: 0.754 %).

## 17. W2S-I1: the hot gas pocket and the local step (w3/scheme; D5-2, ladder L14)

The reference does not edit this section (like §14-16). The rule it adds is §10's pairwise face eigenvalue, in the oracle and the kernel alike.

**The finding (critic pass 19, W2S-I1; pre-registered as L14, PHYSICS.md 3.3).** At the engine's defaults (preconditioned tracking, minMach = M_cut = 0.02, CFL 0.8, the sharp limiter) a hot pocket (T′ 900-1200 K, Z 0.015, pressure equilibrium) moving at 100-300 m/s through still cold gas in a 60 × 16 annular duct goes non-finite. Sampled after every iteration (`tests/ladder/hotPocket.ts`), the eight moving L14 cases are already non-finite at **iteration 1**, on the f64 oracle and on the kernel alike (the probe sampled every 100 and saw "within 5-100"). Of the two probe cases that stayed bounded, 900 K at −50 m/s fails L14's undershoot row (min T′ −0.217 ΔT), and 1200 K at rest passes on the CPU (an exact rest state: every flux is zero).

**Diagnosis (scratch `reports/scratch/diag`: `jac.ts`, `jacsub.ts`, `eigsub.py`; the 1200 K, −100 m/s, wall case at its start).**
- *The local step's estimate against the cell's neighbour.* The cold cells at rest have β = minMach = 0.02 and c = 340 m/s, so their own face radius is βc = 6.8 m/s: their step is 1/minMach = 50 times their acoustic one. The pocket's cells have c = 745 m/s (a 2.19× sound-speed jump) and β = M = 0.134. On the face between the cold cell ahead of the pocket and the pocket, the pocket's preconditioned radius (vn = −100 m/s) is **23.9×** the cold cell's own; on the face below the pocket (no normal velocity) it is still 14.7× (βc of the hot gas, 100 m/s). Over the cell's two directions the cold cell's λ is 12.0× (ahead) and 8.1× (below) too small for what arrives through its faces: a Courant number of about 10 at CFL 0.8.
- *The true spectral radius.* The linearised one-stage operator A = −τ P ∂R/∂U (frozen τ and β, by finite differences on the oracle, the 126 cells within three of the pocket, 756 unknowns) has its leading eigenvalues at **z = 1.01 ± 4.87i**, |G(z)| = **16.4** per iteration (G the 3-stage polynomial of §10), all of them in the column of four cold cells just ahead of the pocket. The step meant |z| ≲ CFL; the true |z| is 6× that. The same operator at CFL 0.4 has |G| 3.27, with D4-44 (b) 9.49, and with the pairwise rule below 1.24, whose leading eigenvalue is real (z = 0.215) and does not scale with τ: the semi-discrete linearisation about a moving pocket, not a step limit.
- *Face against cell β/M_ref (D4-44).* On that face β̄_f = 0.077 = M_ref, so β/M_ref is 0.26 for the cold cell and 1.74 for the hot one. The cold side sits where §10's uniform-state analysis already gives a 1D limit near 0.6, below 0.8, but the scaled diffusion is small next to what the neighbour brings (β_c² χ c²/(2c̄ f_a) ≈ 0.6 m/s against βc = 6.8 m/s), which is why D4-44 (b) cannot reach it.

So the step was too long in the **cold** cells beside the hot gas, not in the hot cells: the local step took only the cell's own state, while what crosses a face is set by both of its states.

**The rule (§10).** With preconditioning (minMach < 1), each face's eigenvalue in the local step is the larger of its two cells' preconditioned spectral radii. The neighbour's takes its own β (a ghost's: its source cell's, as β̄_f does) and its sound speed from its own (p′, ρ′, Z) by §3, as SLAU2 takes a face state's (a ghost's stored T′ and c are don't-care, W2R-N2). A slip-wall face keeps the cell's own: the wall flux is pressure only, and the wall ghost is a reflection built for the wall cell's slopes, not a neighbour's state. With round 1's extrapolated scalars a hot wall cell under cold gas had a ghost with ρ = 2ρ₀ − ρ₁ < 0, a state without a sound speed; with ρ′ and Z mirrored (D5-5, §5) the ghost's T′ comes from its extrapolated p′ over the cell's own ρ′, so a wall cell at a higher pressure than the next cell has a ghost hotter than any gas beside it (23 % in the unit test's wall row at p∞ + 30 kPa), which the exclusion keeps out of the step. This is the standard local wave-speed bound of a face (the Rusanov/LLF estimate) applied to the preconditioned system. It changes the iteration map, not the steady state (R = 0 does not depend on τ). The plain scheme, physical time and minMach ≥ 1 are unchanged; the kernel keeps its `cellLambda` call there, so those paths are bitwise as before (E-L5 2.67e-8 and E-L9a 2.46e-12 over the flux scale, as of record).
- *Oracle:* `computeLocalDt` and `neighbourSpectralRadius` (`src/flow/reference/solver.ts`, `precondition.ts`).
- *Kernel:* the stage kernel at stage 1 (`neighbourRadius` in `wgsl/kernels.ts`), from the halo's primitives (`wqa`, `wqb`), the slip-wall flag (`wb` < 0) and the ring's β (`wbeta`), which the stage kernel already holds for β̄_f. No workgroup memory is added (16272 of 16384 bytes at 16 × 8). The f32 order is the oracle's literal one (`temperatureFromPressure`, `soundSpeed`, `spectralRadius`), so §14 has no new form.
- *Tests:* `tests/unit/flow/precondition.test.ts` ("section 17": the neighbour's radius, a cold cell's step against the recomputed rule, the plain step and the wall face, and since D5-5 a wall cell whose mirrored-ρ′ ghost would carry a 7 % larger radius on the wall face than the cell's whole j term; the two mutants, the rule off and the wall exclusion off, are killed), and L14 on the CPU and the GPU.

**The candidates (D5-2's options in order).** L14 on the CPU oracle, every case sampled after every iteration; scratch `reports/scratch/trial`, a switchable copy of the oracle, which with the pairwise rule gives the branch's L14 values to the digits shown. "Every row" counts the cases that pass all four rows.

| candidate | finite to 2000 (of 10) | cases passing every row | worst peak max T′ / start | worst min T′ / ΔT |
|---|---|---|---|---|
| the contract (before) | 2 (8 non-finite at iteration 1) | 1 | (non-finite) | −0.217 |
| D4-44 (b): the scaled diffusion's eigenvalue added to λ | 2 (8 non-finite at iteration 1) | 1 | (non-finite) | −0.053 |
| **each face's larger preconditioned radius (adopted)** | **10** | **3** | 1.393 (900 K, −300, wall, iteration 389) | −0.0765 |
| a per-stage positivity guard alone (δU scaled so that ρ ≥ ½ρ and ½T ≤ T ≤ 2T of the stage start) | 10 | 2 | 2.645 | −0.188 |
| the adopted rule with that guard | 10 (the guard never fires) | 3 | 1.393 | −0.0765 |
| reference, not a candidate: CFL 0.4 (the contract) | 6 | 1 | 1.010 | −0.206 |
| reference, not a candidate: the plain scheme (CFL 1.5) | 10 | 1 | 1.170 | −0.041 |

- D4-44 (b) changes nothing that matters: the cold cell's scaled diffusion is 9 % of its own radius. The guard keeps every case finite but leaves the worst overshoot and undershoot of all (a scaled increment is still a step too long, only clipped). The pairwise rule makes every case finite with the guard never firing, so it is the one the data choose.
- Variants of the rule, run only with the wall trial below: the neighbour's state at the cell's own β gives a worst peak of 1.049 and a worst undershoot of −0.0102 ΔT; a radius from the face-mean state with β̄_f, 1.043 and −0.0082. Neither changes which rows fail.

**What the rule does not fix: two rows, for reasons a step cannot reach (decisions for the orchestrator).**
1. *The undershoot row (min T′ ≥ −0.03 ΔT) on 5 cases (−0.045 to −0.077 ΔT), and the 1.39 overshoot at iteration 389:* a **slip-wall scalar drain**. The wall ghost extrapolates ρ′ and Z (§5, 2q₀ − q₁), so a wall cell is never a limiter extremum: its face value towards the interior is ½(q₀ + q₁), and when the flow leaves the wall the cell loses fuel and entropy at that value, faster than it holds them. In the 900 K, −100 m/s, mid case the inner-wall cell (16, 0) drains from Z 8e-4 to below zero at iteration 49 while every neighbour's Z is positive; by iteration 85 a row of wall cells has ρZ < 0 (Z −0.0039) and T′ −69 K. The same drain run the other way (a wall cell losing gas colder than its mean) heats diluted pocket gas (Z 0.008) to 1253 K at the inner wall of the 900 K, −300, wall case. It is semi-discrete: dρZ/dt = −ṁ(Z₀ + Z₁)/2 stays negative at Z₀ = 0.
   - *A trial (scratch only, not one of D5-2's options):* the wall ghost mirrors ρ′ and Z (layer 1 q₀, layer 2 q₁), while p′, rw and the tangential velocity keep the extrapolation that L6 needs. With the pairwise rule it brings every undershoot to ≥ −0.0070 ΔT and removes the late overshoot: 6 of the 10 cases pass every row, and the other four fail only (2). Without the pairwise rule it changes nothing about finiteness (2 of 10).
2. *The peak row (≤ 1.03 × the start) on the four −300 m/s cases (1.043-1.056 at iterations 7-8):* the **start's compression**. A slug of hot gas set moving at 300 m/s into still gas decelerates, and its leading edge compresses (p′ ≈ 11 kPa at iteration 10 in the 900 K wall case, whose isentropic compression alone gives 1.034 × ΔT). The plain scheme, closer to the physical transient, peaks at 1.14-1.17 in the same iterations; the probe's 100-iteration sampling missed that, so its "bounded, peak 1213-1215 K" was the value after the transient. No step limit removes a compression the scheme is meant to compute.

On the GPU the at-rest case fails the undershoot row too (−0.040 ΔT): its f32 start is not an exact rest state, so the pocket moves off the wall and the drain follows.

**J (D4-44 (c), W2R-I8) converges.** The low-Mach jet into dead air at its row's settings (minMach = M_cut = 0.003) had stalled at 0.2-0.6 of its peak since round 6, and D4-52 had located the stall in the dead-air cells at β = M_cut beside the jet. With the pairwise rule those cells take the jet's radius on their shared faces. J meets D4-44 (c)'s rule at **2415 iterations** and stays below 9.1e-6 of its peak through 30000 (1.6e-8 at 28000), so its `it.fails` pin is lifted. R (the blockage duct from rest) keeps its sharp-limiter floor and stays pinned.
- *At the engine's cut 0.02*, J does not converge with the contract or with the rule alike (0.6-0.85 of its peak over 2000-30000 in both). D4-59's 5.8e-5 at 0.02 predates D4-101's backflow branch: J's outflow column now carries backflow on 9 of its 16 rows (the jet's entrainment), and the residual sits in the jet next to the outflow. That is W2S-N2's first suspect (§5), reported here, not changed.

**The engine runaway re-run (D5-2, reported, not gated).** The f64 oracle on the 130k mesh from w2/solver-diverge's GPU state at 6700 iterations (`perf-lastfinite.bin`, the look-dev start before D4-101's backflow branch; scratch `reports/scratch/diverge`, the copied `oracle.ts` with the source trees `before` and `beforeStep`), minMach = M_cut = 0.02, CFL 0.8:

| source | result from the 6700 state |
|---|---|
| before D4-101 (no backflow branch, the contract step) | non-finite at 6755 (16 cells), as §16 records |
| before D4-101 with the pairwise step | non-finite by 6770 (63 cells) |
| this branch (the backflow branch and the pairwise step) | non-finite by 6770 (63 cells); the outflow corner's backflow decays (−643 → −61 m/s, T′ 1077 → −1 K) |
| trial: this branch with the wall ghost's ρ′ and Z mirrored (scratch only) | **finite to 7000** (300 iterations), max T′ falling 1059 → 979 K |

- *Where it fails on the branch:* the core duct's outer-wall row beside the cell §16 named, core (509, 15) at x 2.52 m, r 0.43 m. The gas there leaves the wall (v −45 to −65 m/s), its Z falls 0.0063 → 0.0024 → −0.0011, and its T′ climbs 2322 → 4056 → 9117 → 31,740 K over 6758-6768: the wall scalar drain above, in its heating form. So the semi-discrete wall growth the critic asked about is **not** the step mechanism of L14's non-finite cases (the pairwise step delays it by 15 iterations), and not the backflow (which only brought the hot gas there). It is the wall drain of L14's failing rows, and the mirrored-scalar trial removes it here too. The app's own start (rest) never reaches this state (§16).

**No regression (D5-2's pre-registered list; HEAD cd62658, 2026-11-02, on battery).** The rule touches only the preconditioned tracking rows; the plain and physical rows are bitwise the same code on both sides.

| row | record | CPU oracle | GPU kernel |
|---|---|---|---|
| L1 quiescent (bitwise 0); uniform M 0.5 | 0; GPU 2.13e-5 m/s (the CPU's: plain path, code unchanged) | 0; 2.03e-13 | 0; 2.13e-5 |
| L2 L1(ρ), shock offset | physical time, code unchanged | 0.002767, 0.2282 | 0.002768, 0.2282 |
| L3 L1(ρ) | physical time, code unchanged | 0.002113 | 0.002113 |
| L4a Mach, mass flow, iterations | 0.278 %, 0.0997 %, 915 | 0.2779 %, 0.0997 %, 915 | 0.2779 %, 0.0996 % (its D4-38 rows as before: plain, code unchanged) |
| L4b shock, steadiness | 1.640 %, 2.58e-4 | 1.6397 %, 2.580e-4 | (not a GPU row) |
| L5 mass flow, iterations | 0.0843 %, 948 | 0.0843 %, 948 | 0.0843 % |
| L6 radial equilibrium, drift (free vortex; solid body) | plain tracking, code unchanged | 3.005e-4, 4.7e-15; 2.90e-5, 5.41e-8 | 3.007e-4, 4.9e-8; 2.89e-5, 8.6e-8 |
| L7 M 0.01 (96 × 96) asymmetry; \|Cd\|; ratio M 0.01 / M 0.3 | 0.01093; 0.00131; 1.779 | **0.01110** (+1.6 %); 0.00129; 1.644 | **0.01110**; 0.00129; 1.644 (14781 / 8993 its) |
| L8 velocity, steadiness | 0.754 %, 3.2e-5 | 0.7529 %, 2.40e-5 | 0.752 %, 3.22e-5 |
| L9a Euler work, steadiness (D4-57 KNOWN-FAIL) | 8.86e-6, 1.062e-5 | 8.857e-6, 1.062e-5 | as of record (pinned) |
| L9b momentum theory, steadiness | 0.80 %, 2.49e-5 | 0.8008 %, 2.487e-5 | pass, spread 3.43e-5 |
| 12.2 floors (L4a, L5; f32 / f64) | 1.590e-4, 1.096e-3; 6.4e-13, 5.9e-12 | the same | |
| 12.2 C-pre after 1 / 10 / 100 (f32 storage; GPU against the oracle) | CPU 1.43e-7 / 1.79e-7 / 1.06e-6; GPU 5.13e-7 / 3.77e-7 / 1.05e-6 | 1.35e-7 / 1.71e-7 / 4.65e-7 | 5.68e-7 / 3.54e-7 / 1.29e-6 |
| 12.2 S after 1 / 10 / 100 | CPU 1.25e-7 / 1.11e-7 / 2.02e-6; GPU 5.32e-7 / 4.77e-7 / 7.67e-6 | 1.25e-7 / 1.09e-7 / 6.29e-7 | 5.32e-7 / 5.06e-7 / 9.72e-6 |
| E-L5, E-L9a over the flux scale; B | 2.67e-8, 2.46e-12; 1.266e-11 | | 2.67e-8, 2.46e-12; 1.266e-11, 1.95e-5 m/s |
| D4-63 (a) L2(p′) max over 1000-2000; at 20000 | CPU 0.4450 / 0.009223; GPU 0.4450 / 0.008997 | finite to 3000, then the 6 h timeout on battery: 0.428 at 1000, 0.270 at 2000 (not of record) | **0.4497** / 0.0077 |
| D4-63 (b) weighted residual 20000/10000; 20000/100 | CPU 0.1535 / 0.03063; GPU 0.1634 / 0.03253 | | **0.2112** / 0.03125 (trend 0.858 per 1000 over 15000-20000, against 0.820) |
| W2S-B1 long run (a); (b) | 0.659 / 5.09e-4; 0.108 / 7.28e-3 | | 0.629 / 1.55e-3; 0.186 / 0.0287 (max T′ 300.9 K, start 299.9) |
| L14 | (new) | finite 10/10, 3 cases pass every row | finite 10/10, 2 cases pass every row |

Every row passes its bar. Strictly against the record, a few values read on a pseudo-time path are worse: L7's asymmetry (+1.6 %, read at the 1e-4 stop), and on the GPU D4-63's 1000-2000 window (+1 %) and its residual ratio 20000/10000 (0.211 against 0.163, still ≤ 1), and the W2S-B1 long run's ratios at 20000 (still 35-500× inside). Those are values at a stop or a fixed iteration of a changed iteration map, not of the steady state (which the rule does not change); whether D5-2's "at or better than record" applies to them is the handoff's decision 3. The f32 agreement rows (C-pre, S) move both ways by up to 1.3× inside tolerances of 18-775×.

**P1 (indicative only: on battery, `--quick`, D4-63's CPU run beside it).** In one session, the app scene's solver at 1.739 ms/it with the rule and 1.700 ms/it without it (the stage kernel patched off, then restored), so the rule costs about 2 % of the kernel's iteration; both runs report 120 it/s, the 2 iterations per frame at 60 Hz on battery. P1 of record stays 180 it/s (D4-100), to be re-measured in a quiet window on AC.

### 17.1 Round 2 (D5-5): the mirrored wall ghost and the restated peak row

**The wall (D5-5 item 1, §5).** The slip-wall ghost mirrors ρ′ and Z (layer 1 the wall cell's, layer 2 the next cell's); p′, ρw and the tangential velocity keep the extrapolation L6 needs. Oracle `wallGhost` (`boundary.ts`) and kernel `wallGhost` (`wgsl/boundary.ts`, two `select`s; the copy is exact in f32, so §14 has no new form). Tests: `tests/unit/flow/boundary.test.ts` (the mirror against round 1's extrapolation, and ρ > 0, Z ≥ 0 where extrapolating gave ρ = 2ρ₀ − ρ₁ < 0 or Z < 0), `tests/gpu/oracle.test.ts` (the kernel's wall ghosts: ρ′ and Z bitwise its own source cells', the rest within row C's one-iteration tolerance of the oracle's) and `tests/unit/flow/precondition.test.ts` (the wall face's step: with ρ′ mirrored and p′ extrapolated, a wall row at p∞ + 30 kPa has a ghost 23 % hotter than the cell, whose radius on the wall face would exceed the cell's whole j term by 7 %; the wall exclusion keeps it out, and the exclusion-off mutant, which round 1's test no longer kills with the mirrored ghost, is killed by this one).

**The peak row (D5-5 item 2, PHYSICS.md 3.3 amended).** For every cell and iteration T′ ≤ 1.03 T′_s, T′_s = T_h (p/p∞)^((γ−1)/γ) − T∞ with γ = cp/(cp − R) of the thermally perfect gas at T_h = T∞ + ΔT and Z 0.015 (`isentropicPocketBound` in `tests/ladder/hotPocket.ts`; the row's value is the run's max over cells and iterations of T′/T′_s; `tests/unit/flow/hotPocket.test.ts`). `thresholds.ts` mirrors the restated text (`maxPeakOverIsentropicCompression`, 1.03).

**L14 after the wall change** (HEAD d9e728e; values: peak T′/T′_s / max T′ at 2000 over its start / min T′/ΔT; the pre-registered "peak max T′ / start" of round 1 in brackets, reported):

| case | CPU oracle | GPU kernel |
|---|---|---|
| 900 K, −100, wall | 1.0020 [1.005] / 0.061 / −0.0002: PASS | 1.0020 / 0.061 / −0.0002: PASS |
| 900 K, −100, mid | 1.0020 [1.005] / 0.260 / −0.0003: PASS | 1.0020 / 0.260 / −0.0003: PASS |
| 900 K, −300, wall | 1.0209 [1.056] / 0.000 / −0.0069: PASS | 1.0209 / 0.000 / −0.0069: PASS |
| 900 K, −300, mid | 1.0209 [1.056] / 0.000 / −0.0070: PASS | 1.0209 / 0.000 / −0.0070: PASS |
| 1200 K, −100, wall | 1.0016 [1.004] / 0.189 / −0.0001: PASS | 1.0016 / 0.188 / −0.0001: PASS |
| 1200 K, −100, mid | 1.0016 [1.004] / 0.191 / −0.0001: PASS | 1.0016 / 0.191 / −0.0001: PASS |
| 1200 K, −300, wall | 1.0160 [1.043] / 0.235 / −0.0040: PASS | 1.0160 / 0.235 / −0.0040: PASS |
| 1200 K, −300, mid | 1.0161 [1.043] / 0.000 / −0.0040: PASS | 1.0161 / 0.000 / −0.0040: PASS |
| 900 K, −50, wall | 1.0005 [1.001] / 0.313 / −0.0000: PASS | 1.0005 / 0.313 / −0.0000: PASS |
| 1200 K, 0, wall | 1.0001 [1.000] / 1.000 (1 − 1e-15) / −0.0000: PASS | 1.0001 / 0.412 / −0.0000: PASS |

All 10 cases pass every row on both, so round 1's KNOWN-FAIL pin is lifted (`tests/ladder/l14.test.ts`, `tests/gpu-ladder/l14.test.ts`: "every row of every case"). The worst peak sits at iteration 8 in the −300 m/s slug's leading edge (the start's compression, as D5-5 found), 2 % above its own isentrope; the at-rest case's 1.0001 is its start (the pocket's T′ is 1200.09 K at p∞, because the start sets ρ with the air's R). On the CPU the at-rest case stays a rest state to round-off (max T′ at 2000 is 1 − 1e-15 of its start; round 1's GOTCHA 3 still applies).

**The control and the references under the restated row** (CPU, scratch `reports/scratch/trial`, `TRIAL_WALL=extrapolate` restoring round 1's wall where named; worst case in brackets):

| scheme | worst peak T′/T′_s | cases passing every row | worst min T′/ΔT |
|---|---|---|---|
| **control: the positivity guard alone (contract step, round 1's wall), SOLVER.md 17's candidate** | **2.647** (1200 K, −300, wall, iteration 156): **FAILS**, as D5-5 requires | 2 | −0.188 |
| the guard alone with the mirrored wall | 1.022 | 1 | −0.188 |
| the pairwise step with round 1's wall (round 1's branch) | 1.394 (900 K, −300, wall, iteration 389: the wall drain's heating) | 5 | −0.0765 |
| **the pairwise step with the mirrored wall (this branch)** | **1.021** | **10** | **−0.0070** |
| reference: the plain scheme (CFL 1.5), round 1's wall | 1.0312 (900 K, −300, wall, iteration 5) | 7 | −0.041 |
| reference: the plain scheme, the mirrored wall | 1.0312 (the same) | 7 | −0.041 |

- The restated row separates what the data said it should: the guard's 2.647 is a temperature the scheme made (its pressure there gives T′_s near ΔT), while the pairwise step's 1.021 is the slug's own compression to within 2 %. The plain scheme, closer to the physical transient, sits at 1.031 on the two 900 K, −300 m/s cases, just over the bar, and passes it on the other eight (its 1.14-1.17 under the pre-registered row were mostly compression); its at-rest case fails "max T′ at 2000 ≤ its start" by round-off.
- Without the pairwise step the mirrored wall changes nothing about finiteness (round 1's trial: 2 of 10); the guard with the mirrored wall still undershoots to −0.188 ΔT (the step, not the wall).

**J at the engine's cut 0.02 (D5-5 item 4; diagnosed, nothing changed).** Scratch `reports/scratch/r2/jdiag.ts` (J's set-up from `precondition.test.ts`, 12000 iterations, the last 2000 sampled every iteration) with a switchable copy of `boundary.ts` (`reports/scratch/r2/boundary.ts`, `TRIAL_OUTFLOW`, loaded by `redirectB.mjs`); every row on the branch's oracle (the pairwise step and the mirrored wall).

| outflow ghost (trial) | M_cut 0.02: residual / peak over the last 2000 | 0.02: outflow rows switching across vn = 0 | M_cut 0.003 |
|---|---|---|---|
| the branch (D4-101: backflow takes the inflow ghost at (p_out, T∞)) | **0.57-0.87 (stalled)** | rows 5-15, 30-63 sign changes each | converges (2415) |
| W2S-N2 removed: the subsonic outflow ghost on the outgoing characteristic (p_out, u_n,s + (p′_s − p′_out)/(ρc)), the branch switched on that u_n, so p and u_n are continuous across the switch for any p_s | 0.57-0.87 (stalled) | the same rows, the same counts | converges (2416) |
| the backflow ghost keeps the cell's tangential velocity | 0.55-0.83 (stalled) | rows 5-15, 30-62 | |
| both of the above | 0.55-0.83 (stalled) | rows 5-15, 20-63 | |
| the backflow ghost on the preconditioned characteristic (impedance ρ(λ₊ − β²vn), §5's far-field form) | 0.58-0.89 (stalled) | rows 5-15, 31-63 | converges (2353) |
| the smooth limiter (the branch's BCs) | 0.59-0.92 (stalled) | rows 5-15, 31-63 | |
| the backflow ghost at the **static** p_out on the outgoing characteristic, with T∞, Z = 0, no swirl | **converges (10581)** | none (steady backflow on rows 9-14) | **stalls** (0.09-0.82; rows 4-15 switch 8-36 times) |
| before D4-101: a copy with p_out (no backflow branch) | **converges (11003)** | none (steady backflow on rows 10-14) | **stalls** (1e-3 to 1e-2; rows 8-10 switch) |

- *What the stall is:* a limit cycle of period about 64 iterations (62-63 sign changes in 2000 on rows 5-9, 30 on rows 10-15) in which the outflow rows next to the jet alternate between outflow and backflow, the residual sitting in the last columns (shares 0.11 and 0.18 in i = 29 and 30). Backflow as such is not it: at 0.003 the branch holds steady backflow on rows 6-14 for all 2000 iterations and converges.
- *W2S-N2's doubled response is not the cause:* removing it (p and u_n continuous across vn = 0 for any p_s) leaves the cycle unchanged to the sign-change count, and neither the tangential velocity, the limiter nor a preconditioned impedance changes it.
- *What decides it is the backflow's pressure condition, and it decides it the opposite way at the two cuts:* a backflow at the total p_out (static p_out − ½ρσ²: the branch, and every variant built on the inflow ghost) cycles at 0.02 and converges at 0.003; a backflow at the static p_out (the old copy, or the characteristic ghost with ambient T and Z) converges at 0.02 and cycles at 0.003. The outflow rows' p′ are 0.3-5 Pa, the same size as ½ρσ² at the backflow speeds (1-2 m/s), so the two conditions are different boundary problems here, not a small change of one.
- *Proposed fix (for w3/plume-bake, L11's jets; not made here, and not a one-line correction):* find the cycling mode before choosing a form. Linearise J at its limit cycle's mean state (scratch `reports/scratch/diag/jac.ts` and `eigsub.py` did this for L14) with each backflow pressure condition, at 0.02 and 0.003, and take the form whose leading eigenvalue of the 3-stage map is inside the unit circle at both cuts. A candidate to test first is a backflow at the total p_out with its dynamic head taken from the face's normal velocity rather than from the ghost's own σ (which removes the ghost's own ½ρσ² feedback while keeping W2S-B1's protection against the momentum feedback). The pre-registered test: J converges at both 0.003 and 0.02, D4-63 and the W2S-B1 long run pass, and the engine runaway stays finite.

**No regression with the mirrored wall (D5-5 item 3; code of ea9c486, run 2026-11-02 on AC, each suite alone).** "Converged" values must be at or better than record; values read at a stop, a cap or a fixed iteration must pass their bar and are shown beside the record (D5-5 item 3).

| row | record | CPU oracle | GPU kernel |
|---|---|---|---|
| L1 quiescent; uniform M 0.5 | 0; GPU 2.13e-5 m/s | 0; 2.03e-13 | 0; 2.13e-5 |
| L2 L1(ρ), shock offset | 0.002767, 0.2282 | 0.002767, 0.2282 | 0.002768, 0.2282 |
| L3 L1(ρ) | 0.002113 | 0.002113 | 0.002113 |
| L4a Mach, mass flow, iterations | 0.278 %, 0.0997 %, 915 | 0.2779 %, 0.0997 %, 915 | 0.2779 %, 0.0996 % |
| L4b shock, steadiness | 1.640 %, 2.58e-4 | 1.640 %, 2.580e-4 | (not a GPU row) |
| L5 mass flow, iterations | 0.0843 %, 948 | 0.0843 %, 948 | 0.0843 % |
| L6 free vortex; solid body (error, drift) | 3.005e-4, 4.7e-15; 2.90e-5, 5.41e-8 | 3.004e-4, 4.5e-15; 2.90e-5, 5.41e-8 | 3.000e-4, 4.9e-8; 2.87e-5, 8.6e-8 |
| L7 asymmetry; \|Cd\|; ratio (at the 1e-4 stop) | 0.01093; 0.00131; 1.779 | 0.01110; 0.001287; 1.644 (as round 1) | 0.01110; 0.001287; 1.644 (14781 / 8993) |
| L8 velocity, steadiness (at the cap) | 0.754 %, 3.2e-5 | 0.7526 %, 2.65e-5 | 0.7530 %, 3.26e-5 |
| L9a Euler work, steadiness (at the cap) | 8.86e-6, 1.062e-5 (FAIL, D4-57) | 9.82e-6, **9.20e-6: PASSES D4-57's row** | 1.66e-6, 1.344e-5 (pinned as before; round 1 1.31e-5) |
| L9b momentum theory, steadiness | 0.80 %, 2.49e-5 | 0.8008 %, 2.487e-5 | 0.7990 %, 3.43e-5 |
| 12.2 floors (L4a, L5; f32 / f64) | 1.590e-4, 1.096e-3; 6.4e-13, 5.9e-12 | 1.595e-4, 1.096e-3; 6.43e-13, 5.43e-12 | |
| 12.2 C-pre after 1 / 10 / 100 | CPU 1.43e-7 / 1.79e-7 / 1.06e-6; GPU 5.13e-7 / 3.77e-7 / 1.05e-6 | 1.35e-7 / 1.71e-7 / 4.99e-7 | 5.68e-7 / 3.72e-7 / 1.30e-6 |
| 12.2 S after 1 / 10 / 100 | CPU 1.25e-7 / 1.11e-7 / 2.02e-6; GPU 5.32e-7 / 4.77e-7 / 7.67e-6 | 1.25e-7 / 1.34e-7 / 9.50e-7 | 5.32e-7 / 5.79e-7 / 1.30e-5 |
| E-L5, E-L9a over the flux scale; B | 2.67e-8, 2.46e-12; 1.266e-11 | | 2.67e-8, 1.19e-9 in the old form, **K2 2.20e-11 ≤ 1e-10 (D5-6, below)**; 1.266e-11, 1.95e-5 m/s |
| D4-63 (a) L2(p′) max over 1000-2000; at 20000 | CPU 0.4450 / 0.009223; GPU 0.4450 / 0.008997 | **the run of record on AC, alone, 85 min: finite**, 0.4497 / 0.008369 | 0.4497 / 0.008217 |
| D4-63 (b) residual 20000/10000; 20000/100 | CPU 0.1535 / 0.03063; GPU 0.1634 / 0.03253 | 0.2156 / 0.03297 | 0.2158 / 0.03297 (trend 0.876 per 1000) |
| W2S-B1 long run (a); (b) | 0.659 / 5.09e-4; 0.108 / 7.28e-3 | | 0.6286 / 2.06e-3; 0.1621 / 0.0262 (max T′ 300.9 K) |
| L14 | (round 1: 3 of 10 CPU, 2 of 10 GPU) | 10 of 10 | 10 of 10 |

- Every row passes its bar. E-L9a's flux-scale row failed it in its old form and is re-posed by D5-6 (below). The D4-63 and W2S-B1 values are read at fixed iterations of a pseudo-time decay (D5-5 item 3: their bars hold, ≤ 2 and ≤ 1 with margins of 4-30×); the L7, L8, L9a and L9b values at a stop or a cap. The changes from the record are round 1's step rule (SOLVER.md 17) to the digits shown, except L9a's (the steadiness now passes) and E-L9a.
- **L7 converged to 1e-6 (D5-5 item 3):** 96 × 96, M 0.01 (scratch `reports/scratch/r2/l7t-*.txt`, three runs side by side on AC): the branch (pairwise step, mirrored wall) asymmetry 0.0110887, |Cd| 0.00112104 (35867 its); without the pairwise step (mirrored wall) 0.0110888, 0.00112116 (35838); without it and with round 1's wall (the scheme of record) 0.0110888, 0.00112116 (35838). The step rule moves the converged values by 1.6e-7 and 1.2e-7 (1e-5 relative, at the 1e-6 convergence level) and the wall by 2e-9: the steady state is unchanged, and the converged values are at (asymmetry) and better than (|Cd|) the record scheme's. The record's 0.01093 / 0.00131 and the branch's 0.01110 / 0.00129 are values at the 1e-4 stop.
- **E-L9a (D5-6; W3S-I1 and W3S-N2, round 3).** The kernel and the oracle agree on the fields as before (e 6.05e-6 against 5.10e-6, tolerance 1e-4) and on the residual's own form (3.18e-6, tolerance 1e-3). The old flux-scale form |r_GPU − r_ref| / r_flux is 1.19e-9 against D4-71's 1e-10 (record 2.46e-12). Isolated (temporary edits, restored): mirroring only layer 1 gives 1.19e-9, only layer 2 gives 2.46e-12, so it is the wall cell's own ρ′ slope (zero with the mirrored ghost). The kernel's wall ghosts are right (the new test: ρ′ and Z bitwise their sources, all 48).
  - *What the old form measures* (critic pass 20's probe `docs/reviews/probes/w3s-el9a-sensitivity.probe.ts.txt`; E-L9a's set-up; each over r_flux; the old wall / the mirror). The residual of record is R(U⁹), the first stage of iteration 10, so these are at U⁹, evaluated by the oracle's code in f64:

    | quantity | what it measures | old wall | mirror |
    |---|---|---|---|
    | the old row, \|r_GPU − r_ref\| | the kernel's arithmetic plus the two states' drift | 2.46e-12 | 1.19e-9 |
    | S1, \|L2 R(U⁹_GPU) − L2 R(U⁹_ref)\| (the GPU's state hi + lo) | the drift alone: the oracle's residual of the GPU's state against that of its own | 1.32e-10 | 1.17e-9 |
    | S2, the same with the GPU's f32 part only | the drift, as the stage kernel reads the state | 3.59e-10 | 1.09e-9 |
    | S3, \|L2 R(fround U⁹_ref) − L2 R(U⁹_ref)\| | the f32 floor: the oracle's own state rounded to f32, no GPU in it | 6.6e-12 | 1.94e-10 |
    | **K2, \|r_GPU − L2 R(U⁹_GPU)\|** | the kernel's residual against the oracle's on the kernel's own state: the row's purpose | 1.35e-10 | **2.20e-11** |

    So the record's 2.46e-12 was a cancellation of the drift and the kernel's arithmetic, each 50-150× larger; with the mirror, rounding the exact state to f32 alone (S3) exceeds 1e-10, so no f32 kernel meets the old form except by luck. Round 2's numbers here (2.0e-9 with the old wall, 4.3e-9 with the mirror, "800× below") were not these: the scratch `reports/scratch/r2/el9a.ts` compared the oracle's f64 run with its own f32-storage run at U¹⁰, not with the GPU's state at U⁹ (W3S-N2), and the restatement proposed from them (|r_GPU − r_ref| ≤ S1) fails at U⁹ (1.19e-9 > 1.17e-9).
  - *The row since D5-6* (`tests/gpu/oracle.test.ts`, the E L9a row): both solvers run 9 iterations, the GPU's U⁹ is read back (`readConserved`), the oracle evaluates its density-residual L2 in f64 (checked on the oracle's own U⁹: equal to its residual of record), and both run the 10th; **K2 ≤ D4-71's 1e-10, unchanged**, with the old form and S3 printed. Round 3 (Dawn, Arc iGPU): K2 **2.202e-11**, the old form 1.187e-9, S3 1.944e-10. Mutant W1g (the kernel's ρ′ extrapolated at the wall, the oracle's mirrored), applied and restored: **K2 1.657e-10, fails**, while the old form passes it at 3.343e-11.
