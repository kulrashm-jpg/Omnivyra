// Extract the runbook's read-only preflight queries (section 3.2 and 3.3) verbatim into
// one psql script wrapped in a READ ONLY transaction that is rolled back.
//   node scripts/release/runbook-preflight-build.js <runbook.md> <out.sql>
const fs = require('fs');
const [runbook, outFile] = process.argv.slice(2);
const md = fs.readFileSync(runbook, 'utf8').split('\n');
const start = md.findIndex((l) => l.startsWith('### 3.2'));
const end = md.findIndex((l, i) => i > start && l.startsWith('### 3.4'));
if (start < 0 || end < 0) throw new Error('preflight sections not found');

const out = [
  '-- Omnivyra release gate: READ-ONLY production preflight, extracted verbatim from',
  '-- docs/release/orchestration-engine-adapters-migration-runbook.md (sections 3.2, 3.3).',
  '-- Catalog reads and aggregate counts only. Run with: psql -X -f preflight.sql',
  '\\set ON_ERROR_STOP on',
  'BEGIN TRANSACTION READ ONLY;',
  "SET LOCAL statement_timeout = '30s';",
  "SET LOCAL lock_timeout = '2s';",
];
let inBlock = false;
let label = '';
let n = 0;
for (let i = start; i < end; i++) {
  const line = md[i];
  const m = /^\*\*(P[0-9]+[a-z]?(?: \/ P[0-9]+[a-z]?)?)[:.]/.exec(line);
  if (m) label = m[1];
  if (line.startsWith('### 3.3')) label = '3.3 (is 20261127000000 already in production?)';
  if (line.startsWith('```sql')) { inBlock = true; n++; out.push('', `\\echo '=== ${label} ==='`); continue; }
  if (inBlock && line.startsWith('```')) { inBlock = false; continue; }
  if (inBlock) out.push(line);
}
out.push('', 'ROLLBACK;', '');
fs.writeFileSync(outFile, out.join('\n'));
console.log(`sql blocks: ${n}`);
