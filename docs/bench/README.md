# Recorded benchmark files

Written by `spikes/bench/run.ts` (see `spikes/README.md`) and `npm run gpu:info`. Each file is kept byte for byte as recorded; Prettier ignores this folder. Annotations go here, never into the files. The facts drawn from them are in `docs/GPU_FACTS.md`.

## Official (D0-1), run by the orchestrator

| file | run | annotation | facts |
|---|---|---|---|
| `throughput-2026-10-25-2218-official.json` | 2026-10-25 22:18-22:47, Balanced plan and mode, AC, no agents, 019683d, fixed order | **Result `80k-16x8` is INVALID (D2-8):** Chrome's rAF dropped to ~1 Hz about 52 s into it (the window lost focus or was covered). Its runs 1-2 have ~60 frames each, every delta ~1016 ms; its aggregate (4.8 it/s, 1.33 ms/it, frame p50 1016 ms, 0 long frames) is not a measurement of the kernel. `pageHiddenMs: 0` there, because Playwright's switches keep an occluded window "visible" (W0G-I1). Every other row is valid. The tile ranking within each grid is confounded by the fixed run order (W0G-I2): 16x8 is the default tile, not a measured best. | M34 |
| `worker-2026-10-25-2247-official.json` | 2026-10-25 22:47-23:06, same conditions | All rows valid. `gitDirty: true` only because the throughput JSON above was untracked at the time (W0G-N2). "Long frames" there are relative to each run's median, which is 16.7 ms in every run, i.e. 1.5 display intervals. The caveats of D2-9 apply: fixed 3 it/frame, React development build. | M35 |

Both were written by the harness before the W0G-I1/I2 fixes. Files written since carry `gate`, `order` and `conditions.display`, and mark an invalid configuration with `validity.valid: false` and `aggregate: null`.

## Indicative, contaminated (D0-1): `--quick` runs by builders

| file | annotation | facts |
|---|---|---|
| `throughput-2026-10-24-quick.json` | the previous builder's single 130k-16x8 run (0795d0a); power plan and mode not recorded | M30 |
| `throughput-2026-10-24-2133-quick.json` | a game used 63% of the GPU (`gpuBusyBefore`); 130k-16x8 ran at 1 Hz for two runs (occlusion) | M31 |
| `throughput-2026-10-24-2140-quick.json` | the M30 table; CPU 46-66% (other agents) | M30 |
| `throughput-2026-10-24-2153-quick.json` | second sweep at low CPU load (3% before); a different tile ranking | M30 |
| `throughput-2026-10-24-2154-quick.json`, `-2155-`, `-2156-` | single configurations run alone (`--only`): 130k-16x8 (2154, 2155), 130k-8x8 (2156) | M30 |
| `worker-2026-10-24-2125-quick.json` | CPU 46% before, power mode Balanced (the other quick runs: Best performance); M29 reports a game on the GPU during it, which its `gpuBusyBefore` does not show | M29 |
| `worker-2026-10-24-2141-quick.json` | the M29 table and the COOP/COEP probe | M13, M27-M29 |
| `worker-2026-10-24-2152-quick.json` | a rerun at lower CPU load (13% before) | M29 |
| `dawn-adapter-2026-10-24.json` | `npm run gpu:info` output | M1 |
