// D0-1 GPU timing protocol (docs/reviews/LOG.md): on AC power, nothing else running, Chrome in
// the foreground, 10 s warm-up, then the median of 3 runs of 60 s. `--quick` keeps the shape
// (warm-up + 3 runs) but takes ~5 s per configuration; its numbers are only indicative.

export interface Protocol {
  readonly name: 'official' | 'quick';
  readonly warmupMs: number;
  readonly runMs: number;
  readonly runs: number;
}

export const OFFICIAL: Protocol = { name: 'official', warmupMs: 10_000, runMs: 60_000, runs: 3 };
export const QUICK: Protocol = { name: 'quick', warmupMs: 2_000, runMs: 1_000, runs: 3 };

export const DEFAULT_PORT = 5181;

export function protocolLabel(p: Protocol): string {
  return p.name === 'quick'
    ? 'indicative, contaminated (D0-1): --quick run'
    : 'official (D0-1): 10 s warm-up, median of 3 x 60 s';
}

export interface BenchArgs {
  readonly protocol: Protocol;
  /** Configuration ids to run, or null for all. */
  readonly only: readonly string[] | null;
  readonly port: number;
}

export function parseBenchArgs(argv: readonly string[]): BenchArgs {
  let protocol = OFFICIAL;
  let only: string[] | null = null;
  let port = DEFAULT_PORT;
  for (const arg of argv) {
    if (arg === '--quick') {
      protocol = QUICK;
    } else if (arg.startsWith('--only=')) {
      only = arg
        .slice('--only='.length)
        .split(',')
        .filter((s) => s.length > 0);
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
      if (!Number.isInteger(port) || port <= 0) throw new Error(`bad --port value in ${arg}`);
    } else {
      throw new Error(`unknown argument ${arg} (expected --quick, --only=a,b, --port=N)`);
    }
  }
  return { protocol, only, port };
}
