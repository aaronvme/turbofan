// Runs one ladder case (tests/ladder/cases/<name>.ts) in a plain Node child process and asserts
// its rows. Plain Node with type stripping runs the f64 solver about 3x faster than vitest's module
// runner (1.4 against 4.7 us per cell-iteration, which then degrades to ~17 us after a few hundred
// iterations), so vitest only orchestrates. The case writes reports/ladder/<id>.json.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import type { LadderRow } from './common';

const run = promisify(execFile);

export interface CaseResult {
  readonly id: string;
  readonly rows: readonly LadderRow[];
  readonly extra?: Record<string, unknown>;
}

/** The child's time limit: the ladder's per-test timeout (vitest.ladder.config.ts), 30 min. */
export const CASE_TIMEOUT_MS = 1_800_000;

export async function runCase(name: string, timeoutMs = CASE_TIMEOUT_MS): Promise<CaseResult> {
  const { stdout } = await run(
    process.execPath,
    ['--import', './tools/mesh/ts-resolve.mjs', 'tests/ladder/runCase.ts', name],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
  );
  const line = stdout.split('\n').find((l) => l.startsWith('@@RESULT@@'));
  if (line === undefined) throw new Error(`case ${name} printed no result:\n${stdout}`);
  return JSON.parse(line.slice('@@RESULT@@'.length)) as CaseResult;
}

/** One vitest test per case: every gated row must pass ('reported' rows are printed only). */
export function ladderCase(name: string, title: string): void {
  it(title, async () => {
    const result = await runCase(name);
    for (const row of result.rows) {
      process.stdout.write(
        `[ladder] ${row.id} | ${row.metric} | ${row.threshold} | ${row.value.toPrecision(4)} | ${String(row.pass)}\n`,
      );
    }
    for (const row of result.rows) {
      if (row.pass === 'reported') continue;
      expect(row.pass, `${row.id}: ${row.metric} = ${row.value} (${row.threshold})`).toBe(true);
    }
  });
}
