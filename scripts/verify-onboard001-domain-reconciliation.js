#!/usr/bin/env node
/**
 * ONBOARD-001R §7 — company-domain registry reconciliation (READ-ONLY).
 *
 * Verifies the canonical company_domains registry against the legacy
 * companies.website_domain / admin_email_domain columns. Reports:
 *
 *   1. missing_mappings — companies with a legacy domain but NO canonical
 *      company_domains row (the ONBOARD-001 backfill should have covered
 *      these; any remaining are domains claimed by another company).
 *   2. drift — a company whose canonical final_domain disagrees with its
 *      legacy columns (the two registries diverged).
 *   3. duplicates — a final_domain owned by more than one company (ownership
 *      conflict; must be merged manually).
 *   4. orphans — company_domains rows whose company_id no longer exists.
 *
 * Guarantees: SELECT-only (NEVER modifies data), rerunnable, structured
 * actionable output. NO automatic repair.
 *
 * Usage: node scripts/verify-onboard001-domain-reconciliation.js
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loads .env.local if absent).
 * Exit: 0 = reconciled, 1 = action required, 2 = environment error.
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

async function fetchAll(client, table, columns) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const norm = (d) => (d ? String(d).trim().toLowerCase().replace(/^www\./, '') : null);

async function main() {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(JSON.stringify({ status: 'ENV_ERROR', missing: [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean) }, null, 2));
    process.exit(2);
  }

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false } });

  try {
    const [companies, domains] = await Promise.all([
      fetchAll(client, 'companies', 'id, name, website_domain, admin_email_domain'),
      fetchAll(client, 'company_domains', 'id, company_id, final_domain, is_primary, verification_status'),
    ]);

    const companyIds = new Set(companies.map((c) => c.id));
    const domainsByCompany = new Map();
    for (const d of domains) {
      if (!domainsByCompany.has(d.company_id)) domainsByCompany.set(d.company_id, []);
      domainsByCompany.get(d.company_id).push(d);
    }

    // 1. missing mappings
    const missing = companies
      .filter((c) => norm(c.website_domain) || norm(c.admin_email_domain))
      .filter((c) => !domainsByCompany.has(c.id))
      .map((c) => ({ company_id: c.id, name: c.name, legacy_domain: norm(c.website_domain) ?? norm(c.admin_email_domain) }));

    // 2. drift
    const drift = [];
    for (const c of companies) {
      const legacy = norm(c.website_domain) ?? norm(c.admin_email_domain);
      const rows = domainsByCompany.get(c.id) ?? [];
      if (!legacy || rows.length === 0) continue;
      const finals = new Set(rows.map((r) => norm(r.final_domain)));
      if (!finals.has(legacy)) {
        drift.push({ company_id: c.id, name: c.name, legacy_domain: legacy, canonical_domains: [...finals] });
      }
    }

    // 3. duplicate final_domain across companies
    const byFinal = new Map();
    for (const d of domains) {
      const f = norm(d.final_domain);
      if (!f) continue;
      if (!byFinal.has(f)) byFinal.set(f, new Set());
      byFinal.get(f).add(d.company_id);
    }
    const duplicates = [...byFinal.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([final_domain, ids]) => ({ final_domain, company_ids: [...ids] }));

    // 4. orphaned registry rows
    const orphans = domains
      .filter((d) => !companyIds.has(d.company_id))
      .map((d) => ({ id: d.id, company_id: d.company_id, final_domain: norm(d.final_domain) }));

    const actionRequired = missing.length || drift.length || duplicates.length || orphans.length;
    const report = {
      status: actionRequired ? 'ACTION_REQUIRED' : 'RECONCILED',
      checked_at: new Date().toISOString(),
      totals: { companies: companies.length, company_domains: domains.length },
      missing_mappings: { count: missing.length, detail: missing.slice(0, 100),
        action: missing.length ? 'These companies have a legacy domain but no canonical row. Re-run migration 20260714, or their domain is claimed by another company (merge manually).' : 'None.' },
      drift: { count: drift.length, detail: drift.slice(0, 100),
        action: drift.length ? 'Legacy columns and canonical registry disagree — reconcile the intended domain manually.' : 'None.' },
      duplicates: { count: duplicates.length, detail: duplicates.slice(0, 100),
        action: duplicates.length ? 'A domain is owned by multiple companies — merge (pattern: 20260325_fix_duplicate_company_website_domain.sql).' : 'None.' },
      orphans: { count: orphans.length, detail: orphans.slice(0, 100),
        action: orphans.length ? 'Registry rows point at deleted companies — investigate; ON DELETE CASCADE should prevent these.' : 'None.' },
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(actionRequired ? 1 : 0);
  } catch (err) {
    console.error(JSON.stringify({ status: 'ERROR', message: err.message }, null, 2));
    process.exit(2);
  }
}

main();
