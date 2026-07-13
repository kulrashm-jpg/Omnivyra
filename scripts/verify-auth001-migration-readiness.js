#!/usr/bin/env node
/**
 * AUTH-001R §6 — migration-readiness verifier (READ-ONLY).
 *
 * Checks whether supabase/migrations/20260713_auth001_signup_hardening.sql
 * can be applied cleanly to the target database:
 *
 *   1. companies.website_domain duplicates
 *      — any duplicate group means the guarded unique index will be SKIPPED
 *        (the migration raises a WARNING instead of failing). This report
 *        names each duplicate group so an operator can merge them
 *        (pattern: 20260325_fix_duplicate_company_website_domain.sql).
 *
 *   2. signup_intents duplicate PENDING intents per email
 *      — the migration retires older duplicates to status='expired' itself;
 *        this report shows how many rows that UPDATE will touch.
 *
 *   3. Post-apply verification — after the migration has been applied, rerun
 *      this script: zero duplicates in both sections = the unique indexes
 *      are (or can be) in force.
 *
 * Guarantees: SELECT-only (never mutates data), rerunnable, exit codes:
 *   0 — READY (no blockers; the migration will fully apply)
 *   1 — ACTION REQUIRED (website_domain duplicates exist; index would be skipped)
 *   2 — environmental failure (missing creds / network)
 *
 * Usage: node scripts/verify-auth001-migration-readiness.js
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loads .env.local if absent).
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function groupDuplicates(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const v = row[key];
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
}

async function fetchAll(client, table, columns, filter) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(JSON.stringify({
      status: 'ENV_ERROR',
      missing: [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean),
    }, null, 2));
    process.exit(2);
  }

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false } });

  try {
    // ── 1. companies.website_domain duplicates ────────────────────────────
    const companies = await fetchAll(
      client, 'companies', 'id, name, website_domain',
      (q) => q.not('website_domain', 'is', null),
    );
    const websiteDupGroups = groupDuplicates(companies, 'website_domain');
    const websiteDupDetail = websiteDupGroups.map(([domain, count]) => ({
      website_domain: domain,
      companies: companies
        .filter((c) => c.website_domain === domain)
        .map((c) => ({ id: c.id, name: c.name })),
      count,
    }));

    // ── 2. signup_intents duplicate pending intents ───────────────────────
    const pendingIntents = await fetchAll(
      client, 'signup_intents', 'id, email, created_at',
      (q) => q.eq('status', 'pending'),
    );
    const intentDupGroups = groupDuplicates(pendingIntents, 'email');
    // Rows the migration's UPDATE will retire (all but newest per email).
    const rowsToRetire = intentDupGroups.reduce((sum, [, n]) => sum + (n - 1), 0);

    const ready = websiteDupGroups.length === 0;
    const report = {
      status: ready ? 'READY' : 'ACTION_REQUIRED',
      migration: 'supabase/migrations/20260713_auth001_signup_hardening.sql',
      checked_at: new Date().toISOString(),
      website_domain: {
        companies_with_domain: companies.length,
        duplicate_groups: websiteDupGroups.length,
        detail: websiteDupDetail,
        action: websiteDupGroups.length
          ? 'Merge each duplicate group (pattern: 20260325_fix_duplicate_company_website_domain.sql), then re-run. Until merged, the migration SKIPS idx_companies_website_domain_unique with a WARNING.'
          : 'None — idx_companies_website_domain_unique will be created.',
      },
      signup_intents: {
        pending_rows: pendingIntents.length,
        duplicate_email_groups: intentDupGroups.length,
        rows_migration_will_retire_to_expired: rowsToRetire,
        action: intentDupGroups.length
          ? `Informational — the migration itself retires the ${rowsToRetire} older duplicate(s) to status='expired' (no deletes).`
          : 'None — idx_signup_intents_email_pending_unique will be created.',
      },
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(ready ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ status: 'ERROR', message: err.message }, null, 2));
    process.exit(2);
  }
}

main();
