// W2R-N11: `npm run test:ladder` starts by clearing reports/ladder/*.json, so the directory holds
// only the reports of the run of record (a stale report of a renamed or removed case once sat
// beside the current one). Running a single ladder file clears the others too.
import { existsSync, readdirSync, unlinkSync } from 'node:fs';

export default function setup(): void {
  const dir = 'reports/ladder';
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) unlinkSync(`${dir}/${f}`);
}
