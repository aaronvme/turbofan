// The A-rows' measured numbers, kept for the handoff's results table: each check appends lines,
// and the file's afterAll writes them to reports/audio/<name>.txt (ignored by git). The lint
// allows no console.log in tests, and a record file outlives the run's scroll-back.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll } from 'vitest';

export function recorder(name: string): (line: string) => void {
  const lines: string[] = [];
  afterAll(() => {
    mkdirSync('reports/audio', { recursive: true });
    writeFileSync(`reports/audio/${name}.txt`, `${lines.join('\n')}\n`);
  });
  return (line: string) => {
    lines.push(line);
  };
}
