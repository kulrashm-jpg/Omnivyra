/**
 * Phase-10B — Company Website Backfill (Bucket B only).
 *
 * Backfills companies.website for EXACTLY 3 explicitly-approved records whose
 * website is empty AND whose active-admin email domain matches the audited
 * identity AND whose target equals the audit's canonical website.
 *
 * Safety:
 *   - Allowlist of 3 hard-coded (id, name, domain, website). Nothing else is touchable.
 *   - Per-row optimistic compare-and-set guard (update only if website still == the
 *     captured before-value) ⇒ idempotent + race-safe; rerun updates 0.
 *   - Row-count assertion: exactly 3 eligible, exactly 3 changed, else ABORT/rollback.
 *   - Before/after + rollback SQL emitted.
 *
 * Run:
 *   DRY-RUN: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-company-website.ts
 *   APPLY:   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-company-website.ts --apply
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { normalizeCompanyDomain } from '../lib/shared/domain/companyDomain';

const APPLY = process.argv.includes('--apply');

const APPROVED = [
  { id: '4dae7f7a-b518-4557-b8cb-5c6123ff9658', name: 'Drishiq',                    domain: 'drishiq.com',            website: 'https://www.drishiq.com' },
  { id: '73e5fa6f-822d-4eb5-8c85-42d79b25f394', name: 'Embrosales',                 domain: 'embrosales.in',          website: 'https://www.embrosales.in' },
  { id: '7a606a40-4d8e-4d23-b967-3df0ca4b0c8a', name: 'Unfinished Innovations LLP', domain: 'nothingelsematterz.com', website: 'https://www.nothingelsematterz.com' },
] as const;

const ADMIN_ROLE_PRIORITY: Record<string, number> = { COMPANY_ADMIN: 3, admin: 2, SUPER_ADMIN: 1 };

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

function isEmptyWebsite(website: string | null, id: string): boolean {
  if (website == null) return true;
  const w = website.trim();
  return w === '' || w === id || /^[0-9a-f-]{36}$/i.test(w);
}

async function adminEmailDomain(companyId: string): Promise<string> {
  const { data: roles } = await db
    .from('user_company_roles').select('user_id, role, status')
    .eq('company_id', companyId).eq('status', 'active');
  let best: { user_id: string; pri: number } | null = null;
  for (const r of (roles ?? []) as any[]) {
    const pri = ADMIN_ROLE_PRIORITY[r.role];
    if (pri && (!best || pri > best.pri)) best = { user_id: r.user_id, pri };
  }
  if (!best) return '';
  const { data: u } = await db.from('users').select('email').eq('id', best.user_id).maybeSingle();
  const email = (u as { email?: string } | null)?.email;
  return email ? normalizeCompanyDomain(email) : '';
}

type Eval = {
  rec: typeof APPROVED[number];
  found: boolean;
  beforeWebsite: string | null;
  emailDomain: string;
  guards: { websiteEmpty: boolean; adminMatches: boolean; targetMatches: boolean; nameMatches: boolean };
  eligible: boolean;
};

async function evaluate(): Promise<Eval[]> {
  const out: Eval[] = [];
  for (const rec of APPROVED) {
    const { data: c } = await db.from('companies')
      .select('id, name, website, website_domain, status').eq('id', rec.id).maybeSingle();
    if (!c) {
      out.push({ rec, found: false, beforeWebsite: null, emailDomain: '', guards: { websiteEmpty: false, adminMatches: false, targetMatches: false, nameMatches: false }, eligible: false });
      continue;
    }
    const company = c as any;
    const emailDomain = await adminEmailDomain(rec.id);
    const guards = {
      websiteEmpty:  isEmptyWebsite(company.website, company.id),
      adminMatches:  emailDomain === rec.domain,
      targetMatches: rec.website === `https://www.${rec.domain}`,
      nameMatches:   String(company.name ?? '').trim() === rec.name,
    };
    const eligible = guards.websiteEmpty && guards.adminMatches && guards.targetMatches && guards.nameMatches;
    out.push({ rec, found: true, beforeWebsite: company.website ?? null, emailDomain, guards, eligible });
  }
  return out;
}

(async () => {
  const evals = await evaluate();
  const candidates = evals.filter((e) => e.eligible);
  console.log(`[backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} | eligible candidates: ${candidates.length}/3`);
  for (const e of evals) {
    console.log(`  ${e.rec.name}: found=${e.found} before=${JSON.stringify(e.beforeWebsite)} emailDomain=${e.emailDomain} guards=${JSON.stringify(e.guards)} eligible=${e.eligible}`);
  }

  const applied: { id: string; name: string; before: string | null; after: string }[] = [];
  let assertionOk = candidates.length === 3;
  let changedCount = 0;

  if (APPLY) {
    if (!assertionOk) {
      console.error(`[backfill] ABORT — expected exactly 3 eligible, got ${candidates.length}. No writes performed.`);
    } else {
      for (const e of candidates) {
        let q = db.from('companies').update({ website: e.rec.website }).eq('id', e.rec.id);
        // Optimistic compare-and-set: only if website still == captured before-value.
        q = e.beforeWebsite == null ? q.is('website', null) : q.eq('website', e.beforeWebsite);
        const { data, error } = await q.select('id, website');
        if (error) { console.error(`[backfill] update error ${e.rec.name}: ${error.message}`); continue; }
        if (data && data.length === 1) { applied.push({ id: e.rec.id, name: e.rec.name, before: e.beforeWebsite, after: e.rec.website }); changedCount++; }
      }
      // All-or-nothing: if not exactly 3 changed, compensate (restore) what changed.
      if (changedCount !== 3) {
        console.error(`[backfill] changed ${changedCount} != 3 — ROLLING BACK applied rows…`);
        for (const a of applied) {
          if (a.before == null) await db.from('companies').update({ website: a.before as any }).eq('id', a.id).eq('website', a.after);
          else await db.from('companies').update({ website: a.before }).eq('id', a.id).eq('website', a.after);
        }
        assertionOk = false;
      }
    }
  }

  // Post-apply verification: re-evaluate to confirm idempotency (0 eligible after apply).
  const postEvals = APPLY && assertionOk ? await evaluate() : null;
  const postEligible = postEvals ? postEvals.filter((e) => e.eligible).length : null;

  // ── Report ──────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString();
  const beforeAfter = (rows: Eval[]) =>
    '| company_id | name | admin email domain | before website | after website (proposed) | eligible |\n' +
    '|---|---|---|---|---|---|\n' +
    rows.map((e) => `| ${e.rec.id} | ${e.rec.name} | ${e.emailDomain || '—'} | ${JSON.stringify(e.beforeWebsite)} | ${e.rec.website} | ${e.eligible ? '✅' : '❌'} |`).join('\n') + '\n';

  let md = `# COMPANY_WEBSITE_BACKFILL_REPORT.md\n\n`;
  md += `Phase-10B — Bucket-B website backfill. Scope: exactly 3 approved records.\n\n`;
  md += `- Generated: ${stamp}\n- Mode of this run: **${APPLY ? 'APPLY' : 'DRY-RUN'}**\n`;
  md += `- Eligible candidates: **${candidates.length}/3** (assertion ${candidates.length === 3 ? 'PASS' : 'FAIL'})\n`;
  if (APPLY) md += `- Rows changed: **${changedCount}** (assertion ${changedCount === 3 ? 'PASS' : 'FAIL'})\n`;
  if (postEligible != null) md += `- Idempotency re-check (eligible after apply): **${postEligible}** (expect 0)\n`;
  md += `\n## Candidates — before / after\n\n${beforeAfter(evals)}\n`;
  md += `## Guards (all required true for eligibility)\n\n`;
  md += `| name | websiteEmpty | adminMatches | targetMatches | nameMatches |\n|---|---|---|---|---|\n`;
  for (const e of evals) md += `| ${e.rec.name} | ${e.guards.websiteEmpty} | ${e.guards.adminMatches} | ${e.guards.targetMatches} | ${e.guards.nameMatches} |\n`;
  md += `\n`;

  if (APPLY) {
    md += `## Apply result\n\n`;
    md += assertionOk && changedCount === 3
      ? `✅ Applied 3 updates. Row-count assertion PASS. Idempotency re-check: ${postEligible} eligible remaining (rerun updates 0).\n\n`
      : `❌ NOT applied cleanly (eligible=${candidates.length}, changed=${changedCount}). Any partial change was rolled back. No net mutation.\n\n`;
    md += `### Rollback\n\nIf needed, restore prior values:\n\n\`\`\`sql\n`;
    for (const a of (applied.length ? applied : candidates.map((e) => ({ id: e.rec.id, name: e.rec.name, before: e.beforeWebsite, after: e.rec.website })))) {
      md += a.before == null
        ? `-- ${a.name}\nUPDATE companies SET website = NULL WHERE id = '${a.id}';\n`
        : `-- ${a.name}\nUPDATE companies SET website = '${String(a.before).replace(/'/g, "''")}' WHERE id = '${a.id}';\n`;
    }
    md += `\`\`\`\n\n`;
  } else {
    md += `## Dry-run\n\nNo writes performed. ${candidates.length === 3 ? 'Exactly 3 records would be updated.' : `Expected 3, found ${candidates.length} — apply would ABORT.`}\n\n`;
  }
  md += `## Guarantees\n\n`;
  md += `- Allowlist of 3 ids only; no other record is selectable for write.\n`;
  md += `- Update is guarded by optimistic compare-and-set on the prior website value → idempotent (rerun = 0).\n`;
  md += `- Row-count assertion = 3; any deviation aborts/rolls back with no net change.\n`;
  md += `- Only the \`website\` column is written (in scope). \`website_domain\` is intentionally left untouched.\n`;

  const outPath = path.join(__dirname, '..', 'COMPANY_WEBSITE_BACKFILL_REPORT.md');
  writeFileSync(outPath, md);
  console.log(`[backfill] wrote ${outPath}`);

  // Write rollback SQL on a successful apply.
  if (APPLY && assertionOk && changedCount === 3) {
    let sql = `-- COMPANY_WEBSITE_BACKFILL_ROLLBACK.sql  (generated ${stamp})\n-- Restores the 3 backfilled websites to their prior values.\nBEGIN;\n`;
    for (const a of applied) {
      sql += a.before == null
        ? `UPDATE companies SET website = NULL WHERE id = '${a.id}' AND website = '${a.after}';\n`
        : `UPDATE companies SET website = '${String(a.before).replace(/'/g, "''")}' WHERE id = '${a.id}' AND website = '${a.after}';\n`;
    }
    sql += `COMMIT;\n`;
    writeFileSync(path.join(__dirname, '..', 'COMPANY_WEBSITE_BACKFILL_ROLLBACK.sql'), sql);
    console.log('[backfill] wrote COMPANY_WEBSITE_BACKFILL_ROLLBACK.sql');
  }

  if (APPLY && !(assertionOk && changedCount === 3)) process.exit(1);
})().catch((e) => { console.error('[backfill] FAILED:', e?.message ?? e); process.exit(1); });
