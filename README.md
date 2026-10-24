# Turbofan

A realistic, interactive turbofan engine in the browser, modeled on a CFM56-7B27-class two-spool high-bypass engine.

- **Engine model:** a transient 0-D cycle model (component maps, shaft dynamics, FADEC-like control, start sequence, surge) is the source of truth for every number on screen.
- **Airflow:** a live compressible flow solver on a 2D axisymmetric slice with swirl, running on WebGPU. Blade rows are body forces, the combustor is a heat source, and the jet plume is in the domain.
- **Visuals:** three.js r186 WebGPURenderer with physically based materials, cutaway and exploded views, GPU particles, schlieren and heat haze driven by the solved field.
- **Sound:** synthesized from the simulated sources (blade-pass and buzz-saw tones, jet noise).

What is simulated and what is synthesized is listed in [docs/PHYSICS.md](docs/PHYSICS.md).

## Run

```
npm install
npm run dev        # http://localhost:5173 (Chrome with WebGPU)
npm run gates      # typecheck + lint + unit tests with coverage
npm run test:gpu   # WGSL kernels in Node (Dawn)
npm run test:browser
npm run e2e
npm run mutate     # mutation testing on the physics cores
```

## Docs
- [docs/PHYSICS.md](docs/PHYSICS.md): equations, fidelity ledger, pre-registered validation thresholds
- [docs/ENGINE_FACTS.md](docs/ENGINE_FACTS.md): reference engine data with sources
- [docs/GPU_FACTS.md](docs/GPU_FACTS.md): measured WebGPU / three.js / GPU behaviour
- [docs/reviews/LOG.md](docs/reviews/LOG.md): critic findings
- [CLAUDE.md](CLAUDE.md): how the project is built (TDD, worktrees, critic, gates)
