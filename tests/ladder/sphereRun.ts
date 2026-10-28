// Child-process entry for one L7 sphere run (tests/ladder/cases/l7.ts runs its seven sphere runs
// in parallel this way: sequentially the 96 x 96 pair alone takes most of the ladder's timeout).
// node --import ./tools/mesh/ts-resolve.mjs tests/ladder/sphereRun.ts <mach> <pre 0|1> <n>
// Prints one '@@SPHERE@@' JSON line.
import { SPHERE_CAP, sphere } from './cases/l7.ts';

const [mach, pre, n] = process.argv.slice(2).map(Number) as [number, number, number];
if (![mach, pre, n].every(Number.isFinite)) throw new Error('usage: sphereRun <mach> <pre> <n>');
const r = sphere(mach, pre === 1, mach, 1e-4, SPHERE_CAP, n);
process.stdout.write(`\n@@SPHERE@@${JSON.stringify(r)}\n`);
