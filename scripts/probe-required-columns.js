#!/usr/bin/env node
/**
 * Probe required columns directly via PostgREST.
 *
 * scripts/verify-schema-parity.js queries information_schema.columns which
 * Supabase doesn't expose by default. This script probes each REQUIRED
 * column by SELECTing it with limit=0 — if the column exists, the query
 * returns []; if it doesn't, PostgREST returns a column-not-found error.
 *
 * Read-only. Single GET per column. No mutation.
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.trim().replace(/^["']|["']$/g, '');
  }
}

// Required columns sourced from scripts/verify-schema-parity.js manifest.
// Each entry probed by SELECT <column> FROM <table> LIMIT 0.
const REQUIRED = [
  // 20260725
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'lock_owner',          migration: '20260725' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'lock_acquired_at',    migration: '20260725' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'lock_expires_at',     migration: '20260725' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'heartbeat_at',        migration: '20260725' },
  { severity: 'WARN',     table: 'bolt_execution_runs', column: 'cancel_requested',    migration: '20260725' },
  { severity: 'BLOCKING', table: 'scheduled_posts',     column: 'idempotency_key',     migration: '20260725' },
  // 20260515 (pre-existing error-instrumentation; not strictly part of this rollout but in REQUIRED set)
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'raw_error_message',   migration: '20260515' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'error_stack',         migration: '20260515' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'failed_stage',        migration: '20260515' },
  // 20260726
  { severity: 'BLOCKING', table: 'queue_jobs',          column: 'result_data',         migration: '20260726' },
  { severity: 'BLOCKING', table: 'queue_jobs',          column: 'error_code',          migration: '20260726' },
  // 20260727
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'abandonment_reason',      migration: '20260727' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'abandonment_detected_at', migration: '20260727' },
];

async function probeColumn(url, key, table, column) {
  const u = `${url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(column)}&limit=0`;
  try {
    const res = await fetch(u, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    if (res.ok) return { exists: true };
    const body = await res.text();
    // PostgREST error shape: { code: '42703' (column does not exist), message: '...' }
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* leave as text */ }
    if (parsed && parsed.code === '42703') return { exists: false, reason: parsed.message };
    if (res.status === 404) return { exists: false, reason: 'table_not_found' };
    return { exists: false, reason: parsed?.message ?? body.slice(0, 200) };
  } catch (e) {
    return { exists: false, reason: `network_error: ${e.message}` };
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }

  const missing = [];
  const present = [];
  for (const req of REQUIRED) {
    const result = await probeColumn(url, key, req.table, req.column);
    if (result.exists) {
      present.push(req);
    } else {
      missing.push({ ...req, reason: result.reason });
    }
  }

  // Group by migration so the output mirrors the rollout narrative.
  const byMigration = {};
  for (const req of REQUIRED) {
    byMigration[req.migration] = byMigration[req.migration] || { present: 0, missing: 0, columns: [] };
  }
  for (const p of present) {
    byMigration[p.migration].present++;
    byMigration[p.migration].columns.push({ status: 'ok', table: p.table, column: p.column });
  }
  for (const m of missing) {
    byMigration[m.migration].missing++;
    byMigration[m.migration].columns.push({ status: 'MISSING', table: m.table, column: m.column, reason: m.reason });
  }

  console.log('\n── COLUMN PROBE RESULTS ──');
  for (const [mig, info] of Object.entries(byMigration)) {
    const verdict = info.missing === 0 ? '✓ APPLIED' : '✗ INCOMPLETE';
    console.log(`\n[${mig}] ${verdict} (${info.present}/${info.present + info.missing} columns present)`);
    for (const c of info.columns) {
      const mark = c.status === 'ok' ? '  ✓' : '  ✗';
      console.log(`${mark} ${c.table}.${c.column}${c.reason ? '  — ' + c.reason : ''}`);
    }
  }

  console.log('\n── SUMMARY ──');
  console.log(JSON.stringify({
    checked: REQUIRED.length,
    present: present.length,
    missing: missing.length,
    blocking_missing: missing.filter((m) => m.severity === 'BLOCKING').length,
    warn_missing: missing.filter((m) => m.severity === 'WARN').length,
  }, null, 2));

  process.exit(missing.filter((m) => m.severity === 'BLOCKING').length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(2);
});
