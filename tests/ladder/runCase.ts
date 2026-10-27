// Child-process entry of the ladder (see spawn.ts): node --import ./tools/mesh/ts-resolve.mjs
// tests/ladder/runCase.ts <case>. Prints the result as one '@@RESULT@@' JSON line.
import { report } from './common.ts';

const name = process.argv[2] ?? '';
if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad case name ${name}`);
const mod = (await import(`./cases/${name}.ts`)) as {
  run: () =>
    Promise<{ id: string; rows: []; extra?: Record<string, unknown> }> | { id: string; rows: [] };
};
const result = await mod.run();
report(result.id, result.rows, 'extra' in result ? result.extra : {});
process.stdout.write(`\n@@RESULT@@${JSON.stringify(result)}\n`);
