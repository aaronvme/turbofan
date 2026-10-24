# Turbofan: rules for every agent

A realistic, interactive CFM56-7B27-class turbofan in the browser: a transient 0-D cycle model (the performance truth), a live 2D axisymmetric + swirl compressible flow solver on WebGPU, and cinematic three.js rendering. Plan: `C:\Users\Aaron\.claude\plans\i-think-jet-engine-noble-glacier.md`. Read it, then this file, then `docs/reviews/LOG.md`, then your branch's handoff.

## Roles and git
- **Builders** work only in their own worktree `C:\Users\Aaron\projects\turbofan\.claude\worktrees\<wave>-<name>` on branch `<wave>/<name>`. Commit often on that branch. **Never merge, rebase onto main, push, or touch another worktree.**
- **The critic** works in `.claude\worktrees\critic` (branch `critic`), reviews read-only, and commits only `docs/reviews/LOG.md` and probe scripts under `docs/reviews/probes/`.
- **The orchestrator** merges into `main` after a critic **MERGE** verdict and green gates, and pushes. Nobody else merges or pushes.
- Commit messages: `<WAVE>-<name>: <what>`; the failing-test commit says `(TDD)`. Write files with LF newlines.

## TDD (always)
1. Write the failing test first and commit it (`(TDD)` in the message).
2. Make it pass with the smallest change. 3. Refactor with the suite green.
- Physics checks import their thresholds from `docs/PHYSICS.md` values (mirrored in `src/contracts/thresholds.ts` once it exists). **Never loosen a threshold to make a test pass.** If one looks wrong, stop and write it in your handoff for an orchestrator decision.
- Every published number a test uses comes from `docs/ENGINE_FACTS.md` with its source. Never invent engine data.
- Tests must be deterministic: no wall-clock time, no unseeded randomness, tolerances stated and justified.

## Gates (run before every handoff; report the numbers)
- `npm test` (unit, Node), `npm run lint` (ESLint `--max-warnings 0` + Prettier check), `npm run typecheck` (tsc strict, `noUncheckedIndexedAccess`), `npm run coverage` (≥ 80% overall, ≥ 90% lines in `src/thermo`, `src/cycle`, `src/flow/reference`, `src/flow/coupling`, `src/geometry`).
- If you touched GPU code: `npm run test:gpu` (Node + Dawn). If you touched render/ui/app: `npm run test:browser` and/or `npm run e2e` (real Chrome).
- `npm run gates` runs typecheck + lint + coverage.
- Logic that can be pure must live in a pure, unit-tested module. `src/render`, `src/ui`, `src/app` are excluded from unit coverage because the browser/e2e suites cover them, not so that logic can hide there.

## Facts files
- `docs/ENGINE_FACTS.md`: engine figures with sources. `docs/GPU_FACTS.md`: WebGPU/three/Dawn/Arc behaviour, **measured**, with the script and date. Move an item from "Researched, NOT verified" to "Measured" only with evidence.
- `docs/PHYSICS.md`: equations, the fidelity ledger (what is simulated vs synthesized), pre-registered thresholds.

## Handoff and STOP-CLEAN
- When done, or when told **STOP-CLEAN**: commit everything (WIP is fine, say so), write `docs/handoffs/<wave>-<name>.md` in the format in `docs/handoffs/README.md`, commit it, and reply with a short summary (status, HEAD commit, gates, next steps). Do not start new work after STOP-CLEAN.

## Browser and GPU
- Chrome is shared through the chrome-devtools MCP: **open your own new page first** and only use that page. Close it when done.
- Never leave a dev server or Chrome process running when you hand off. Use a unique port per worktree (5173 + a small offset you note in the handoff).
- Every GPUDevice gets `device.lost` and `onuncapturederror` handlers that surface errors (never swallow them). Tests destroy their devices in `afterAll`.

## Code
- TypeScript strict, ES modules, SI units inside the simulation (convert at the boundary with `src/engine/units.ts`).
- Match the surrounding code: small modules, comments that explain *why* (physics source, equation number), not what.
- No new dependencies without saying why in the handoff; pin exact versions.
- Never read `.env` or token files; never write personal data (emails, keys) into the repo or logs.
