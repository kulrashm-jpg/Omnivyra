#!/usr/bin/env node
/**
 * W5-8 — bundle budget gate. Run AFTER `next build`:
 *
 *   node scripts/check-bundle-budget.js                 → report (always exit 0)
 *   BUNDLE_BUDGET_WRITE_BASELINE=1 node scripts/...     → record current sizes
 *   BUNDLE_BUDGET_STRICT=1 node scripts/...             → fail if any tracked
 *     route's first-load JS grew >10% (or >25 KB) over the recorded baseline
 *
 * Measures per-route first-load JS = shared chunks + route chunks from
 * .next/build-manifest.json, byte sizes from disk. Same ratchet culture as
 * check:db-conventions / the tenant-authz gate: report first, strict later.
 */
const fs = require('fs');
const path = require('path');

const NEXT_DIR = '.next';
const BASELINE = path.join('scripts', '.bundle-budget-baseline.json');
const GROWTH_PCT = Number(process.env.BUNDLE_BUDGET_GROWTH_PCT || 10);
const GROWTH_KB = Number(process.env.BUNDLE_BUDGET_GROWTH_KB || 25);

// The audit's five heaviest routes + the app shell — the tracked set.
const TRACKED = ['/_app', '/activity-workspace', '/analytics', '/dashboard', '/scheduler', '/reports/view/[reportId]'];

function fail(msg) { console.error(msg); process.exit(process.env.BUNDLE_BUDGET_STRICT === '1' ? 1 : 0); }

const manifestPath = path.join(NEXT_DIR, 'build-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.log('check-bundle-budget: no .next/build-manifest.json — run `npm run build` first. Skipping (exit 0).');
  process.exit(0);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function routeBytes(route) {
  const files = new Set([...(manifest.pages?.['/_app'] ?? []), ...(manifest.pages?.[route] ?? [])]);
  let bytes = 0;
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(NEXT_DIR, f);
    try { bytes += fs.statSync(p).size; } catch { /* chunk pruned */ }
  }
  return bytes;
}

const current = {};
for (const route of TRACKED) {
  if (route !== '/_app' && !manifest.pages?.[route]) continue; // route absent in this build
  current[route] = routeBytes(route);
}

console.log('── W5-8 bundle budget report (first-load JS, bytes) ──');
for (const [route, bytes] of Object.entries(current)) {
  console.log(`  ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${route}`);
}

if (process.env.BUNDLE_BUDGET_WRITE_BASELINE === '1') {
  fs.writeFileSync(BASELINE, JSON.stringify({ recordedAt: new Date().toISOString(), routes: current }, null, 2));
  console.log(`Baseline written to ${BASELINE}`);
  process.exit(0);
}

if (fs.existsSync(BASELINE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).routes ?? {};
  const regressions = [];
  for (const [route, bytes] of Object.entries(current)) {
    const before = base[route];
    if (!before) continue;
    const deltaPct = ((bytes - before) / before) * 100;
    const deltaKb = (bytes - before) / 1024;
    const mark = deltaPct >= GROWTH_PCT || deltaKb >= GROWTH_KB ? ' ❌' : deltaPct <= -1 ? ' ✅' : '';
    console.log(`  Δ ${deltaPct.toFixed(1).padStart(6)}%  ${route}${mark}`);
    if (deltaPct >= GROWTH_PCT || deltaKb >= GROWTH_KB) regressions.push(route);
  }
  if (regressions.length) {
    fail(`❌ Bundle budget exceeded on: ${regressions.join(', ')} (> ${GROWTH_PCT}% or > ${GROWTH_KB} KB growth). ` +
         'Fix the regression or deliberately re-baseline with BUNDLE_BUDGET_WRITE_BASELINE=1.');
  } else {
    console.log('✅ All tracked routes within budget.');
  }
} else {
  console.log('No baseline recorded yet — run with BUNDLE_BUDGET_WRITE_BASELINE=1 after a clean build.');
}
process.exit(0);
