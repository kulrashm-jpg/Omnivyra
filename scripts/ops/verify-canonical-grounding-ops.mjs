#!/usr/bin/env node
/**
 * verify-canonical-grounding-ops.mjs
 *
 * Read-only operational smoke check for the canonical grounding rollout.
 * Probes the deployment version + the metrics export endpoint and reports a
 * PASS/FAIL readiness summary. Does NOT change anything and does NOT enable
 * any rollout — safe to run against production.
 *
 * Usage:
 *   node scripts/ops/verify-canonical-grounding-ops.mjs [--base https://www.omnivyra.com] [--expect-sha <sha>]
 * Env:
 *   OMNIVYRA_BASE_URL           base URL (default https://www.omnivyra.com)
 *   OBSERVABILITY_EXPORT_TOKEN  if set, the script scrapes metrics and checks series
 *   EXPECT_SHA                  expected deployed commit sha (parity check)
 * Exit code: 0 if all critical checks PASS, 1 otherwise.
 */
const args = process.argv.slice(2);
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const BASE = getArg('--base') || process.env.OMNIVYRA_BASE_URL || 'https://www.omnivyra.com';
const EXPECT_SHA = getArg('--expect-sha') || process.env.EXPECT_SHA || null;
const TOKEN = process.env.OBSERVABILITY_EXPORT_TOKEN || null;

const results = [];
const record = (name, pass, detail, critical = true) => { results.push({ name, pass, detail, critical }); };

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}

async function checkVersion() {
  try {
    const r = await fetchWithTimeout(`${BASE}/api/health/version`);
    if (!r.ok) return record('health.version reachable', false, `http ${r.status}`);
    const j = await r.json();
    record('health.version reachable', true, `env=${j.environment} build=${(j.build || '').slice(0, 8)}`);
    if (EXPECT_SHA) record('deploy parity (sha matches EXPECT_SHA)', j.build === EXPECT_SHA, `${(j.build || '').slice(0, 8)} vs ${EXPECT_SHA.slice(0, 8)}`);
    record('environment is production', j.environment === 'production', j.environment, false);
    return j;
  } catch (e) { return record('health.version reachable', false, e.name || 'error'); }
}

async function checkMetrics() {
  // Unauth probe: 404 = dark (OBSERVABILITY_EXPORT_TOKEN unset) → metrics NOT exposed.
  try {
    const r = await fetchWithTimeout(`${BASE}/api/observability/metrics`);
    if (r.status === 404) return record('metrics endpoint EXPOSED', false, '404 — OBSERVABILITY_EXPORT_TOKEN not set in this env');
    if (r.status === 401) record('metrics endpoint EXPOSED', true, '401 unauth (token IS set) — provide token to scrape');
    else if (r.status === 200) record('metrics endpoint EXPOSED', true, '200 (open — check auth expectations)');
    else record('metrics endpoint EXPOSED', false, `unexpected http ${r.status}`);
  } catch (e) { return record('metrics endpoint EXPOSED', false, e.name || 'error'); }

  if (!TOKEN) { record('canonical_grounding series present', false, 'no OBSERVABILITY_EXPORT_TOKEN provided to scrape', false); return; }
  try {
    const r = await fetchWithTimeout(`${BASE}/api/observability/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return record('canonical_grounding series present', false, `scrape http ${r.status}`);
    const text = await r.text();
    record('canonical_grounding_call present', text.includes('canonical_grounding_call'), 'series scraped');
    const overwrite = /canonical_grounding_shadow\{[^}]*result="overwrote"[^}]*\}\s+(\d+)/.exec(text);
    record('overwrite gate (== 0)', !overwrite || Number(overwrite[1]) === 0, overwrite ? `overwrote=${overwrite[1]}` : 'no overwrite series (0)');
  } catch (e) { record('canonical_grounding series present', false, e.name || 'error'); }
}

(async () => {
  console.log(`\n── Canonical Grounding Ops Verify ──  base=${BASE}\n`);
  await checkVersion();
  await checkMetrics();

  let criticalFail = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : (r.critical ? 'FAIL' : 'WARN');
    if (!r.pass && r.critical) criticalFail++;
    console.log(`  [${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\nRESULT: ${criticalFail === 0 ? 'OK — critical checks passed' : `${criticalFail} critical check(s) FAILED`}\n`);
  process.exit(criticalFail === 0 ? 0 : 1);
})();
