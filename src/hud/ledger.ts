// The "What's simulated" panel reads the fidelity ledger itself (docs/PHYSICS.md section 1), so
// the app can never claim more than the ledger does: this parses its Markdown table.

export type LedgerKind = 'simulated' | 'derived' | 'synthesized' | 'representative' | 'other';

export interface LedgerRow {
  readonly thing: string;
  /** The status cell as written (Markdown stripped). */
  readonly status: string;
  readonly kind: LedgerKind;
  /** True when the status admits a gap ("known gap", "known fail", "not modeled", "flagged"). */
  readonly caveat: boolean;
  readonly source: string;
}

/** Bold, code and link markup removed; whitespace collapsed. */
export function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ledgerKind(status: string): LedgerKind {
  const s = status.toLowerCase();
  if (s.startsWith('simulated')) return 'simulated';
  if (s.startsWith('derived')) return 'derived';
  if (s.startsWith('synthesized')) return 'synthesized';
  if (s.startsWith('representative')) return 'representative';
  return 'other';
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** The rows of the first table under the "Fidelity ledger" heading. */
export function parseFidelityLedger(markdown: string): LedgerRow[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#+\s+(\d+\.\s*)?fidelity ledger\s*$/i.test(l));
  if (start < 0) throw new Error('no "Fidelity ledger" heading');
  const rows: LedgerRow[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#+\s/.test(line)) break;
    if (!line.trim().startsWith('|')) {
      if (inTable) break;
      continue;
    }
    const cells = splitRow(line);
    if (!inTable) {
      inTable = true; // the header row
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const [thing = '', status = '', source = ''] = cells.map(stripMarkdown);
    rows.push({
      thing,
      status,
      kind: ledgerKind(status),
      caveat: /known gap|known fail|not modeled|flagged|assumption/i.test(status),
      source,
    });
  }
  if (rows.length === 0) throw new Error('the fidelity ledger has no rows');
  return rows;
}
