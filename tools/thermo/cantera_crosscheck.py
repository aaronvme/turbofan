"""Independent cross-check of src/thermo (T1, T3; decision D3-5) with Cantera.

Not part of the npm test suite: the TypeScript tests carry the numbers this script printed
(tests/unit/thermo/gas.test.ts, "Cantera cross-check"). Rerun it only to refresh them:

    python -m venv <a venv outside the repo>
    <venv>/Scripts/python -I -m pip install --only-binary=:all: cantera==3.2.0
    <venv>/Scripts/python -I tools/thermo/cantera_crosscheck.py

Why it is independent of the model: src/thermo uses the GRI-Mech 3.0 NASA-7 fits (N2 valid
from 300 K only) and the test's T1/T3 references are the NIST-JANAF tables. This script uses
Cantera's own thermo database nasa_gas.yaml (the NASA Glenn / CEA species data, as converted
by the Shepherd SDT toolbox, N2 valid from 200 K), forms the frozen ideal mixture itself, and
gets the stoichiometric product composition from Cantera's chemical equilibrium of the
stoichiometric C12H23 / dry-air mixture at 1000 K (complete combustion to within 1e-5 there),
not from the model's mole fractions. It also reports the equilibrium (dissociating) cp at
2000 K, which the model's frozen composition leaves out (PHYSICS.md fidelity note).
"""

import cantera as ct

SPECIES = ["N2", "O2", "Ar", "CO2", "H2O"]
# U.S. Standard Atmosphere 1976, dry air, the four species above 1e-4 (renormalised by Cantera)
AIR = {"N2": 0.78084, "O2": 0.209476, "Ar": 0.00934, "CO2": 0.000314}
FUEL = "Jet-A(g)"  # C12H23, the CEA Jet-A formula


def load(names):
    all_species = {s.name: s for s in ct.Species.list_from_file("nasa_gas.yaml")}
    return ct.Solution(thermo="ideal-gas", species=[all_species[n] for n in names])


def main():
    print(f"cantera {ct.__version__}")
    air = load(SPECIES)
    for t in (200.0, 250.0, 288.15, 300.0, 500.0, 1000.0, 1500.0):
        air.TPX = t, ct.one_atm, AIR
        print(f"air cp {t:7.2f} K: {air.cp_mass:9.3f} J/(kg K)  gamma {air.cp_mass / air.cv_mass:.5f}")

    burn = load(SPECIES + [FUEL])
    burn.set_equivalence_ratio(1.0, {FUEL: 1.0}, AIR)
    far = burn.mass_fraction_dict()[FUEL] / (1 - burn.mass_fraction_dict()[FUEL])
    print(f"stoichiometric FAR {far:.6f}")
    burn.TP = 1000.0, ct.one_atm
    burn.equilibrate("TP")
    x = {s: burn.mole_fraction_dict().get(s, 0.0) for s in SPECIES + [FUEL]}
    print("products (equilibrium at 1000 K): " + ", ".join(f"{s} {v:.6f}" for s, v in x.items()))
    frozen = {s: v for s, v in x.items() if s in SPECIES}
    prod = load(SPECIES)
    for t in (1000.0, 1500.0, 2000.0):
        prod.TPX = t, ct.one_atm, frozen
        print(f"products frozen cp {t:6.0f} K: {prod.cp_mass:9.3f} J/(kg K)")

    # dissociation (information only): CO2, H2O and O2 split into CO, H2, OH, O, H. NO is left
    # out: thermal NO forms on a kinetic time scale far longer than the gas spends in the engine,
    # so its equilibrium shift would overstate the effective cp
    full = ct.Solution(
        thermo="ideal-gas",
        species=[
            s
            for s in ct.Species.list_from_file("nasa_gas.yaml")
            if s.name in ("N2", "O2", "Ar", "CO2", "H2O", "CO", "H2", "OH", "O", "H")
        ],
    )

    def frozen_and_equilibrium(t, p, x):
        full.TPX = t, p, x
        cp_frozen = full.cp_mass
        full.equilibrate("TP")
        h1 = full.enthalpy_mass
        full.TP = t + 0.5, p
        full.equilibrate("TP")
        return cp_frozen, (full.enthalpy_mass - h1) / 0.5

    f, e = frozen_and_equilibrium(2000.0, ct.one_atm, frozen)
    print(f"stoichiometric products, 2000 K, 1 atm: frozen cp {f:9.3f}, equilibrium cp {e:9.3f} J/(kg K)")
    # the cycle's hottest gas: combustor exit at SLS takeoff (T4 about 1641 K, P4 about 2.8 MPa,
    # FAR about 0.0245): complete-combustion products of that lean mixture
    lean = load(SPECIES + [FUEL])
    lean.TPX = 300.0, ct.one_atm, AIR
    y_air = lean.Y
    fuel_far = 0.0245
    lean.TPY = 300.0, ct.one_atm, {**dict(zip(lean.species_names, y_air / (1 + fuel_far))), FUEL: fuel_far / (1 + fuel_far)}
    lean.TP = 1000.0, ct.one_atm
    lean.equilibrate("TP")
    x_lean = {s: v for s, v in lean.mole_fraction_dict().items() if s in SPECIES}
    f, e = frozen_and_equilibrium(1641.0, 2.8e6, x_lean)
    print(f"FAR 0.0245 products, 1641 K, 2.8 MPa: frozen cp {f:9.3f}, equilibrium cp {e:9.3f} J/(kg K) ({100 * (e / f - 1):.3f} %)")


if __name__ == "__main__":
    main()
