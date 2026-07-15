#!/usr/bin/env node
/**
 * F-11 — DB conventions checker (Foundation Batch C). REPORT-ONLY.
 *
 * Counts the two audited anti-patterns across the API + service layers:
 *   1. select('*') / select("*")   — full-row fetches incl. JSONB (B-19)
 *   2. count: 'exact'              — full-scan counts for UI badges (B-26)
 *
 * Batch C ships this as a visibility baseline (`npm run check:db-conventions`).
 * It ALWAYS exits 0 unless DB_CONVENTIONS_STRICT=1, in which case any file
 * NOT on the recorded baseline fails the run — that flip is Wave 2 work.
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['pages/api', 'backend/services', 'backend/db', 'backend/scheduler', 'backend/queue'];
const SELECT_STAR = /\.select\(\s*['"`]\*['"`]/g;
const COUNT_EXACT = /count:\s*['"`]exact['"`]/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) yield full;
  }
}

const perFile = [];
let selectStarTotal = 0;
let countExactTotal = 0;

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8');
    const stars = (src.match(SELECT_STAR) || []).length;
    const exacts = (src.match(COUNT_EXACT) || []).length;
    if (stars || exacts) {
      perFile.push({ file: file.replace(/\\/g, '/'), stars, exacts });
      selectStarTotal += stars;
      countExactTotal += exacts;
    }
  }
}

perFile.sort((a, b) => (b.stars + b.exacts) - (a.stars + a.exacts));

console.log('── DB conventions report (F-11, report-only) ──');
console.log(`select('*') occurrences: ${selectStarTotal} across ${perFile.filter((f) => f.stars).length} files`);
console.log(`count:'exact' occurrences: ${countExactTotal} across ${perFile.filter((f) => f.exacts).length} files`);
console.log('Top 15 offenders:');
for (const f of perFile.slice(0, 15)) {
  console.log(`  ${String(f.stars).padStart(3)} star / ${String(f.exacts).padStart(3)} exact  ${f.file}`);
}

const baselinePath = path.join('scripts', '.db-conventions-baseline.json');
if (process.env.DB_CONVENTIONS_WRITE_BASELINE === '1') {
  fs.writeFileSync(baselinePath, JSON.stringify({ selectStarTotal, countExactTotal, files: perFile }, null, 2));
  console.log(`Baseline written to ${baselinePath}`);
}

if (process.env.DB_CONVENTIONS_STRICT === '1' && fs.existsSync(baselinePath)) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (selectStarTotal > baseline.selectStarTotal || countExactTotal > baseline.countExactTotal) {
    console.error('❌ DB conventions regression: counts exceed the recorded baseline.');
    process.exit(1);
  }
  console.log('✅ No regression vs baseline.');
}
process.exit(0);
