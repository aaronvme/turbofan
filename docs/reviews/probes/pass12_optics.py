"""Critic pass 12 (w2/flowviz @2cfd469): independent checks of the flow visuals' optics.

Run: python -I docs/reviews/probes/pass12_optics.py
Checks, from the formulas' sources and not from the branch's code:
- Edlen 1966 standard-air refractivity at 550 nm, and K = (n - 1) / 1.225 (the ledger's 2.26e-4);
- grey-body luminance at the glow's metal temperatures against a 1000 lux white Lambert wall;
- the schlieren comment's deflection estimate against its a/f = 500 urad.
"""

import math

H = 6.62607015e-34
C = 299792458.0
KB = 1.380649e-23


def edlen(lam_nm):
    s2 = (1000.0 / lam_nm) ** 2
    return (8342.13 + 2406030.0 / (130.0 - s2) + 15997.0 / (38.9 - s2)) * 1e-8


def planck(lam_m, t):
    return 2 * H * C * C / lam_m**5 / math.expm1(H * C / (lam_m * KB * t))


def g(l, mu, s1, s2):
    t = (l - mu) / (s1 if l < mu else s2)
    return math.exp(-0.5 * t * t)


def ybar(l):
    # CIE 1931 ybar, Wyman-Sloan-Shirley 2013 multi-lobe fit
    return 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1)


def luminance(t):
    return 683.0 * sum(planck(l * 1e-9, t) * 1e-9 * ybar(l) for l in range(360, 831))


n1 = edlen(550.0)
print(f"Edlen n-1 at 550 nm: {n1:.5e}; K = {n1 / 1.225:.4e} m^3/kg (ledger 2.26e-4)")
print(f"Edlen n-1 at 589.3 nm: {edlen(589.3):.5e} (tabulated ~2.7653e-4)")

wall = 1000.0 * 0.8 / math.pi  # 1000 lux on an 80 % white Lambert wall, cd/m^2
print(f"white wall at 1000 lux, albedo 0.8: {wall:.0f} cd/m^2")
for t, eps, what in [
    (750, 0.85, "below Draper"),
    (1000, 0.85, "LPT-ish"),
    (1150, 0.40, "HPT vane (TBC)"),
    (1200, 0.85, "uncooled metal"),
]:
    L = eps * luminance(t)
    print(f"  {what:15s} T {t:4d} K eps {eps:.2f}: {L:.3g} cd/m^2 = {100 * L / wall:.3g} % of the wall")

# the schlieren comment (src/flow/viz/modes.ts SCHLIEREN_RANGE_RAD): K rho_inf (dg / width) x path
est = 2.3e-4 * 1.2 * (0.6 / 0.05) * 0.3
print(f"schlieren comment's estimate: {est:.2e} rad against a/f = 5e-4 rad -> {est / 5e-4:.1f}x the range")
