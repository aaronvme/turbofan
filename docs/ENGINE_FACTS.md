# Engine facts (CFM56-7B27-class reference data)

Every figure the model is checked against lives here, with its source. The engine in the app is a *generic CFM56-7B27-class* turbofan: it uses public figures and synthesized blade shapes, not proprietary data, and the UI never uses CFM branding.

Rules (same as meridian's `ALPACA_FACTS.md`):
- Each figure has: value in the source's units, SI value, source (title + URL or document number), and how sure it is (`official` = type certificate data sheet / manufacturer; `published` = reputable secondary source; `estimate` = derived, show the derivation).
- Never invent a figure. If no source exists, write `unknown` and say what the model assumes instead.
- Contradicting sources: list both, say which one the model uses and why.

## Required figures (to be filled by w0/contracts)

- Takeoff thrust (SLS, flat-rated), flat-rating temperature
- Bypass ratio, overall pressure ratio, fan pressure ratio (if published)
- Total airflow at takeoff
- TSFC at takeoff and at cruise
- Fan diameter, fan blade count, stage counts (fan / booster / HPC / HPT / LPT)
- N1 and N2 at 100% (rpm) and their maximum permitted values
- EGT redline (takeoff), EGT limit for start
- Ground-idle N1/N2/EGT, flight-idle N1
- Engine length, dry weight, nacelle maximum diameter
- Start sequence: starter cut-out speed, fuel-on/ignition N2, typical light-off time
- Acceleration requirement: 14 CFR 33.73 text
- Any published HPC variable-stator stages, bleed valves

## Model vs published (updated every wave)

| Figure | Published | Model | Delta | Threshold (PHYSICS.md) |
|---|---|---|---|---|
| (none yet) | | | | |
