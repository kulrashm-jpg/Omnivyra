/**
 * Phase 5/6 — Nightly Company Identity Drift Audit (TELEMETRY ONLY, READ-ONLY).
 *
 * Reads all companies, runs checkCompanyIdentityDrift on each, emits a
 * COMPANY_IDENTITY_DRIFT_WARNING per drifted company, and writes a summary.
 * No writes, no updates, no fixes.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/company-identity-drift-audit.ts
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  checkCompanyIdentityDrift,
  emitCompanyIdentityDriftWarning,
  type CompanyIdentityDriftReason,
} from '../backend/services/companyIdentityDriftService';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

async function pageAll(): Promise<any[]> {
  const out: any[] = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db.from('companies')
      .select('id, name, website, website_domain, admin_email_domain, status')
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  const companies = await pageAll();
  const reasonCounts: Record<string, number> = {};
  const drifted: { id: string; name: string; reasons: CompanyIdentityDriftReason[] }[] = [];

  for (const c of companies) {
    const r = checkCompanyIdentityDrift(c);
    if (r.hasDrift) {
      emitCompanyIdentityDriftWarning(r); // structured telemetry event per drifted company
      drifted.push({ id: r.companyId, name: r.companyName, reasons: r.driftReasons });
      for (const reason of r.driftReasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }

  const totalCompanies = companies.length;
  const driftedCompanies = drifted.length;
  const healthyCompanies = totalCompanies - driftedCompanies;

  // ── Phase 6 alerting: WARNING only when driftedCompanies > 0 (no paging/blocking) ──
  if (driftedCompanies > 0) {
    console.warn(`WARNING: Company identity drift detected — ${driftedCompanies}/${totalCompanies} companies.`);
    for (const d of drifted) console.warn(`  - ${d.id} | ${d.name} | ${d.reasons.join(', ')}`);
  } else {
    console.log(`OK: no company identity drift (${totalCompanies} companies).`);
  }

  const REASONS: CompanyIdentityDriftReason[] = [
    'MISSING_ADMIN_EMAIL_DOMAIN', 'MISSING_WEBSITE_DOMAIN', 'MISSING_WEBSITE',
    'DOMAIN_MISMATCH', 'INVALID_WEBSITE_DOMAIN', 'INVALID_WEBSITE_FORMAT',
  ];
  const stamp = new Date().toISOString();
  let md = `# COMPANY_IDENTITY_DRIFT_SUMMARY\n\nTelemetry-only nightly audit. READ-ONLY — no writes. Generated ${stamp}.\n\n`;
  md += `## Metrics\n\n| metric | value |\n|---|---|\n`;
  md += `| totalCompanies | ${totalCompanies} |\n| healthyCompanies | ${healthyCompanies} |\n| driftedCompanies | ${driftedCompanies} |\n\n`;
  md += `## driftReasonCounts\n\n| reason | count |\n|---|---|\n`;
  for (const reason of REASONS) md += `| ${reason} | ${reasonCounts[reason] ?? 0} |\n`;
  md += `\n## Drifted companies\n\n`;
  md += drifted.length === 0 ? '_none_\n' : (
    '| company_id | name | driftReasons |\n|---|---|---|\n' +
    drifted.map((d) => `| ${d.id} | ${String(d.name).replace(/\|/g, '\\|')} | ${d.reasons.join(', ')} |`).join('\n') + '\n'
  );

  writeFileSync(path.join(__dirname, '..', 'COMPANY_IDENTITY_DRIFT_SUMMARY.md'), md);
  console.log(`\n[drift-audit] total=${totalCompanies} healthy=${healthyCompanies} drifted=${driftedCompanies}`);
  console.log('[drift-audit] reasonCounts:', reasonCounts);
})().catch((e) => { console.error('[drift-audit] FAILED:', e?.message ?? e); process.exit(1); });
