w2/followups-2: DONE, D4-96's follow-ups from critic pass 16 (W2K-I1, W2L-I9, N3, the flow timing row, W2V-I8, the inferno ΔE comment, K4). W2H-I4 and W2H-I1 are left to the part-power round. (from main 664203f; HEAD = the commit that adds this file)

DONE
- ba23dde **W2K-I1:** `spikes/README.md`'s D0-1 checklist has its line back: "Notifications off (Do not disturb), so no toast takes focus. No other window over Chrome. Don't touch the machine until the summary prints". It was recovered from `184680f^`, where 184680f had left a literal `$1`. It sits above D4-73's focus item, with "(apart from the one click into Chrome that the D4-73 item below may need)", so the two items don't contradict each other. No other `$N` artefact is in the tracked text (`git grep '^\$[0-9]$'`).
- **W2L-I9 / D4-96 item 1** (`tests/browser/rotorMotion.test.ts`, `tests/browser/lib/frames.ts`):
  - f413797 (TDD): the `legacyTraa` control runs in every banded pose (the `cutaway` preset's two poses) and must fail in each. With D4-93's band it fails the default pose: the control there is 0.00 at rest / 0.63 moving against a bound of 6.00 (`reports/scratch/f2/rotor-tdd.txt`).
  - dc825f4: the band is the cap pixels only, committed before the run. These are the pixels where the TRAA-off still with the caps differs from one without, with no tile and no ring around them. A band pixel never counts as changed, and a tile's 25 % rule stays of the whole tile (`diff` takes a pixel mask in place of the tile `skip`). Each banded row also reports its counts without the band. The fallback (the default pose out of the moving bound) was stated before the run and wasn't needed.
  - fb6ee53: the result (rotorMotion alone, means of 8, `reports/scratch/f2/rotor-band.txt`), against floor + 6:

    | pose | shipped: rest / moving (excess) | legacyTraa control: rest / moving (excess) | cap pixels |
    |---|---|---|---|
    | cutaway (default) | 9.75 / 12.13 (2.38: passes) | 9.88 / 16.88 (**7.00: fails**) | 3.4 % of the frame |
    | cutawayFanClose | 1.75 / 4.63 (2.88: passes) | 1.38 / 22.75 (21.38: fails) | 6.5 % |

    Without the band: the default pose shipped 30.25 / 37.13 and control 27.50 / 40.63; the close-up 1.75 / 6.50 and 1.50 / 26.88. The exploded, its close-up and hotSection rows are unchanged (4.50 / 5.00, 5.00 / 4.50, 0.00 / 0.13). MARGIN is unchanged. LOOKDEV.md records it.
- **N3 / D4-96 item 3**, a flagged contract text edit:
  - 7f2762a (TDD) and ac010e4: P5's check text in `src/contracts/thresholds.ts` and the PHYSICS.md row now reads "... stepped at 60 Hz, with the matched gas-path solve held; the window is 23 s from ground idle: 3 s at idle, the 1 s ramp, then the take-off lever (D4-96)". "From ground idle" moved out of the ramp's clause into the window.
  - `windowS` (23 s) and `idleS` (3 s) are typed from the text, and `heldFrame.test.ts` reads its 3 s and 20 s from them, the same values as before.
  - No bar changed (137 / 217 evaluations, 16.7 ms).
- **D4-96 item 4, the indicative flow timing row** (`tests/browser/flowViz.test.ts` "[timing] ..."):
  - 7af6d2c (TDD) and fcd24fe: `src/flow/viz/timingRow.ts` has `flowTimingProblems(reading, quiet)` and `quietRun(env)`, which reads `VITE_UI_QUIET` exactly "1", app-ui's N16 flag. A reading over 2 ms fails only when quiet; a non-finite or negative reading fails every run. They are unit-tested with a forced slow value (`tests/unit/flow/viz/timingRow.test.ts`).
  - The browser row writes `timing.json` on every run (quiet, budgetMs, flowMs, pairs, tracers, problems) and asserts `problems` is empty.
  - Shown in Chrome (2658ed9's text; `reports/scratch/f2/mutBrowser.sh SLOW|SLOWQ`, the test file restored after): the tracers reading was forced to the measured value + 3 ms. Without the flag the row passed and recorded `quiet: false, problems: []`; with `VITE_UI_QUIET=1` it failed with "tracers 3.999 ms > 2 ms (quiet run)".
  - The real readings in those two runs (nothing else on the GPU, AC): visuals 0.53 / 0.64 ms, tracers 1.08 / 1.00 ms. The bar is unchanged.
- **W2V-I8:** 531e2f0 (TDD) adds a new browser case. At ground idle on the MOCK, the plane alone, it takes each of p, ρ, T and Mach and finds the share of the footprint in the ambient's own colour band: a pixel whose nearest LUT entry of the quantity's map is within 5 % of the ambient's entry. The bar is ≤ 10 % with the floor and > 30 % with it off, stated before the run; |u| is reported, not gated.
  - On HEAD (273798 px): p 98.0 → 0.5 %, ρ 90.5 → 0.9 %, T 90.5 → 1.0 %, Mach 46.3 → 6.7 % (|u| 54.0 → 13.0 %).
  - **Critic 16's mutant V1** (`flowViz.ts`: `const amb = float(0)`, the T floor about 0 K) **fails it**: T 90.5 → 90.5 %, drawn 100 % (`reports/scratch/f2/i8-V1.txt`).
- 99ccd8c **The inferno ΔE comment** (`src/flow/viz/fields.ts`, W2V-N22), a comment only, in critic 16's numbers:
  - viridis and the diverging map are CIE76 3.4-4.1 (1.5-1.8 JND), CIEDE2000 2.0-4.4, a faint step;
  - inferno at T∞ (±45 K) is CIE76 12.0-13.6 and CIEDE2000 6.6-8.3, a band an eye can see, so T's floor is a display choice that hides it. At idle the T view draws about a tenth of the plane.
  - The PHYSICS.md ledger row and LOOKDEV round 4 said "under two JNDs" too, so they say the same now.
- **K4 / W2K-N1:** d95aabf (TDD) is tests only.
  - `machCut.test.ts`: `{ minMach 0.003, globalMachCut 1 | 1.5 }` gives the uniforms of minMach ≥ 1 given directly, CFL 1.5 and the plain far field.
  - `tests/gpu/oracle.test.ts` "C-cut" (Dawn): the same options on the GPU run row C's plain oracle within 12.2's tolerances: 4.84e-7 / 1.90e-6 / 3.18e-6.
  - The CPU twin W2R-N31: `precondition.test.ts`'s global M_cut case adds `{ minMach 0.01, globalMachCut 1 }` equal to the plain run.
  - **Mutant K4** (the CFL switch from the given minMach) **is killed** by both machCut cases and by C-cut on Dawn: CFL 0.8 against 1.5; with that check removed, e_q after 1 iteration is 0.136 against 1e-5. A4 (the CPU's twin) is killed by the CPU case. Logs: `reports/scratch/f2/mut/`.

NEXT
1. The critic reviews this round (pass 17 or after). Points to judge:
   - W2L-I9: the default pose's control fails by 1.00 tile (7.00 against 6), and its power rests on the measurement being deterministic (GOTCHAS 1).
   - W2V-I8's bar.
   - N3's wording.
2. When app-ui merges main: its `firstSwitch.test.tsx` reads the same `VITE_UI_QUIET` itself. `quietRun` in `src/flow/viz/timingRow.ts` can become the one reader if app-ui wants it (optional).
3. Still open from earlier rounds, untouched here:
   - W2H-I4 / W2H-I1: the part-power round;
   - W2K-N2..N4 and W2L-N15;
   - W2V-N23..N25;
   - the official `--flow` capture and P1 under D4-73 in a quiet window (now with the restored checklist line).

GOTCHAS
1. The rotor measurement is deterministic within its protocol: the same frames each run. In this round the three unbanded rows repeated to the digit across my runs, and the close-up's unbanded counts (1.75 / 6.50) equal the kernel's 02cee6f run. The test:browser gate repeated the banded rows and both controls to the digit too (GATES). Changing the order of the measurements changes the numbers, though: critic 16's probe ran the close-up control after the default pose and got 1.75 / 13.00, against this suite's 0.88 / 13.50 with D4-93's band. Keep the order (shipped poses, then the controls in POSES order) if you compare runs.
2. Vitest 5's browser mode prints a test's console output only when it fails. Records live in files: `test-results/rotorMotion.txt`, `reports/flow/timing.json`, `reports/flow/floor-quantities.txt`.
3. `VITE_UI_QUIET=1` in the process environment reaches `import.meta.env` in the browser tests (shown: the SLOWQ run said "quiet run: gated").
4. In Git Bash, a backtick inside a double-quoted `node -e "..."` is command substitution: it ran a `.ts` path as a shell script (harmless here: a syntax error at line 1), and the text lost the backticked words. Use the Edit tool for Markdown with code spans.
5. A status file written by PowerShell 5's `Set-Content -Encoding utf8` starts with a BOM, so `grep '^DONE'` misses it. `reports/scratch/f2/wait.sh` greps 'DONE exit'.
6. Mesh assets: `npm run mesh:assets` once per worktree (done here, 1 s). The vitest browser API port here was 5201 (`--browser.api.port=5201`). Nothing is left running.

GATES @2658ed9 (all the code; the commit after it adds only this file). Each gate ran detached and alone (`reports/scratch/f2/gates.ps1`, `job.ps1`; logs `reports/scratch/f2/g-*.log`), on AC (BatteryStatus 2 at every start and end), 17:23-17:59 on 2026-10-31.
- typecheck: clean (14 s).
- lint (ESLint `--max-warnings 0` + Prettier): clean (95 s).
- coverage (`--coverage.reportsDirectory=reports/scratch/f2/coverage`), 838 s:
  - 129 files, 2274 passed + 11 expected fail, exit 0 with the per-directory thresholds held;
  - lines 99.53 %, statements 98.55 %, branches 87.90 %, functions 99.48 %;
  - core lines: thermo 100 %, cycle 99.62 %, flow/reference 100 %, geometry 99.59 %, src/flow 99.50 %; `timingRow.ts` and `thresholds.ts` 100 / 100.
- test:mesh: 2 files, 29 passed.
- test:gpu: 12 files, 71 passed (70 + C-cut), 58 s.
  - C-cut 4.84e-7 / 1.90e-6 / 3.18e-6, equal to row C's;
  - C-pre 5.13e-7 / 3.77e-7 / 1.05e-6;
  - E-L5 2.67e-8, E-L9a 2.46e-12, S 5.32e-7 / 4.77e-7 / 7.67e-6.
- test:gpu-ladder: 3 files, 13 passed + 1 expected fail, 317 s.
  - B 1.266e-11 (velocity 1.954e-5);
  - D4-63 on the GPU: (a) 0.7779 / 0.4859, (b) 0.4913;
  - L7 1.779, L8 0.754 %.
- test:browser: 13 files, 42 passed (41 + W2V-I8), exit 0, 438 s, 0 WebGPU errors. It started at 7.46 GB free, once no other vitest-browser process was running: a first start had overlapped main's own `test:browser` and was stopped at once, before it ran a test.
  - The rotor rows equal the single run's above to the digit, banded rows and both controls included.
  - W2V-I8 as above.
  - The timing row, not quiet so recorded only: visuals 0.62 ms, tracers 1.06 ms, P4 off 6.80 / 7.68 / 7.25 ms.
  - `docs/` stayed clean.
