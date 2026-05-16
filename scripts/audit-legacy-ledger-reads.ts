/**
 * Legacy Ledger Read Auditor
 *
 * Greps backend/ + pages/ + scripts/ for `.from('usage_events')` and
 * `.from('credit_usage_log')` outside a hard-coded allow-list, and exits
 * non-zero if any are found. Use in CI to prevent drift back to the old
 * ledger tables from the analytics read path.
 *
 * Allow-list:
 *   - backend/services/usageLedgerService.ts        (writer)
 *   - backend/services/creditExecutionService.ts    (trackUsage→credit_usage_log, reservation state machine)
 *   - backend/services/usageTrackingService.ts      (writer for credit_usage_log)
 *   - scripts/operator/db/backfill-unified-transactions.ts      (historical backfill reader)
 *
 * Usage:  npx ts-node scripts/audit-legacy-ledger-reads.ts
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['backend', 'pages', 'scripts'];
const EXT = new Set(['.ts', '.tsx']);

const ALLOW_LIST = new Set([
  'backend/services/usageLedgerService.ts',
  'backend/services/creditExecutionService.ts',
  'backend/services/usageTrackingService.ts',
  'scripts/operator/db/backfill-unified-transactions.ts',
  'scripts/audit-legacy-ledger-reads.ts',  // this file (contains the pattern in strings)
]);

const PATTERNS: Array<{ re: RegExp; table: string }> = [
  { re: /\.from\(\s*['"`]usage_events['"`]\s*\)/g,     table: 'usage_events' },
  { re: /\.from\(\s*['"`]credit_usage_log['"`]\s*\)/g, table: 'credit_usage_log' },
];

interface Finding {
  file: string;
  line: number;
  table: string;
  snippet: string;
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile() && EXT.has(full.slice(full.lastIndexOf('.')))) {
      yield full;
    }
  }
}

function toRelPosix(p: string): string {
  return relative(ROOT, p).split(sep).join('/');
}

function auditFile(absPath: string): Finding[] {
  const rel = toRelPosix(absPath);
  if (ALLOW_LIST.has(rel)) return [];

  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return [];
  }

  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  for (const { re, table } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      re.lastIndex = 0;
      if (re.test(line)) {
        findings.push({
          file:    rel,
          line:    i + 1,
          table,
          snippet: line.trim().slice(0, 200),
        });
      }
    }
  }
  return findings;
}

function main(): void {
  const findings: Finding[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    for (const file of walk(abs)) {
      findings.push(...auditFile(file));
    }
  }

  if (findings.length === 0) {
    console.log('[audit-legacy-ledger-reads] OK — no forbidden legacy-ledger reads detected.');
    process.exit(0);
  }

  console.error(`[audit-legacy-ledger-reads] FAIL — ${findings.length} forbidden legacy-ledger read(s) detected:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} (${f.table})`);
    console.error(`      ${f.snippet}`);
  }
  console.error(
    '\nIf this is analytics code, migrate to unified_transactions / org_economics_view.',
  );
  console.error(
    'If this is a writer or the backfill script, add its path to ALLOW_LIST in scripts/audit-legacy-ledger-reads.ts.',
  );
  process.exit(1);
}

main();
