/**
 * Phase-10C — Real Company Identity Backfill (FINAL).
 *
 * Atomically sets companies.website + companies.website_domain for EXACTLY 3
 * approved companies, using ONLY values established by prior audits. Maintains
 * identity consistency: both columns are written together (never one without
 * the other). No discovery, no probing, no inference.
 *
 * Modes:
 *   (default) DRY-RUN          → writes PHASE10C_DRY_RUN.md
 *   --apply                    → writes PHASE10C_EXECUTION_REPORT.md + PHASE10C_ROLLBACK.sql
 *   --idempotency              → console-only re-check (no file write)
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-company-identity-10c.ts
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-company-identity-10c.ts --apply
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-company-identity-10c.ts --idempotency
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const IDEMPOTENCY = process.argv.includes('--idempotency');

const APPROVED = [
  { id: '4dae7f7a-b518-4557-b8cb-5c6123ff9658', name: 'Drishiq',                    website: 'https://www.drishiq.com',            websiteDomain: 'drishiq.com',            adminDomain: 'drishiq.com' },
  { id: '73e5fa6f-822d-4eb5-8c85-42d79b25f394', name: 'Embrosales',                 website: 'https://www.embrosales.in',          websiteDomain: 'embrosales.in',          adminDomain: 'embrosales.in' },
  { id: '7a606a40-4d8e-4d23-b967-3df0ca4b0c8a', name: 'Unfinished Innovations LLP', website: 'https://www.nothingelsematterz.com', websiteDomain: 'nothingelsematterz.com', adminDomain: 'nothingelsematterz.com' },
] as const;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

type Eval = {
  rec: typeof APPROVED[number]; found: boolean;
  cur: { website: string | null; website_domain: string | null; admin_email_domain: string | null; name: string | null };
  guards: { idMatch: boolean; nameMatch: boolean; websiteNull: boolean; websiteDomainNull: boolean; adminMatch: boolean };
  eligible: boolean;
};

async function evaluate(): Promise<Eval[]> {
  const out: Eval[] = [];
  for (const rec of APPROVED) {
    const { data } = await db.from('companies')
      .select('id, name, website, website_domain, admin_email_domain').eq('id', rec.id).maybeSingle();
    const c = data as any;
    const cur = { website: c?.website ?? null, website_domain: c?.website_domain ?? null, admin_email_domain: c?.admin_email_domain ?? null, name: c?.name ?? null };
    const guards = {
      idMatch:           !!c && c.id === rec.id,
      nameMatch:         String(cur.name ?? '') === rec.name,
      websiteNull:       cur.website == null,
      websiteDomainNull: cur.website_domain == null,
      adminMatch:        String(cur.admin_email_domain ?? '').toLowerCase().trim() === rec.adminDomain,
    };
    const eligible = !!c && Object.values(guards).every(Boolean);
    out.push({ rec, found: !!c, cur, guards, eligible });
  }
  return out;
}

const stamp = () => { try { return new Date().toISOString(); } catch { return 'n/a'; } };

function guardTable(evals: Eval[]): string {
  let s = `| name | idMatch | nameMatch | websiteNull | websiteDomainNull | adminMatch | eligible |\n|---|---|---|---|---|---|---|\n`;
  for (const e of evals) s += `| ${e.rec.name} | ${e.guards.idMatch} | ${e.guards.nameMatch} | ${e.guards.websiteNull} | ${e.guards.websiteDomainNull} | ${e.guards.adminMatch} | ${e.eligible} |\n`;
  return s;
}
function beforeAfter(evals: Eval[]): string {
  let s = `| company_id | name | current website | current website_domain | target website | target website_domain |\n|---|---|---|---|---|---|\n`;
  for (const e of evals) s += `| ${e.rec.id} | ${e.rec.name} | ${JSON.stringify(e.cur.website)} | ${JSON.stringify(e.cur.website_domain)} | ${e.rec.website} | ${e.rec.websiteDomain} |\n`;
  return s;
}

(async () => {
  const evals = await evaluate();
  const eligible = evals.filter((e) => e.eligible);
  console.log(`[10C] mode=${APPLY ? 'APPLY' : IDEMPOTENCY ? 'IDEMPOTENCY' : 'DRY-RUN'} | eligible: ${eligible.length}/3`);
  for (const e of evals) console.log(`  ${e.rec.name}: eligible=${e.eligible} guards=${JSON.stringify(e.guards)} cur=${JSON.stringify(e.cur)}`);

  // ── IDEMPOTENCY re-check (console only) ───────────────────────────────────
  if (IDEMPOTENCY) {
    console.log(`[10C] idempotency: ${eligible.length} eligible rows, ${eligible.length} updates required (expected 0)`);
    process.exit(eligible.length === 0 ? 0 : 2);
  }

  // ── DRY-RUN ───────────────────────────────────────────────────────────────
  if (!APPLY) {
    let md = `# PHASE10C_DRY_RUN.md\n\nReal company identity backfill — dry-run (no writes). Generated ${stamp()}.\n\n`;
    md += `- Eligible rows: **${eligible.length}/3** (assertion ${eligible.length === 3 ? 'PASS' : 'FAIL'})\n\n`;
    md += `## Current → target\n\n${beforeAfter(evals)}\n## Guard results (all must be true)\n\n${guardTable(evals)}\n`;
    md += eligible.length === 3
      ? `\n✅ All 3 eligible. Apply would update 3 rows × 2 columns = 6 column writes.\n`
      : `\n❌ Not all eligible — apply would ABORT (no writes).\n`;
    writeFileSync(path.join(__dirname, '..', 'PHASE10C_DRY_RUN.md'), md);
    console.log('[10C] wrote PHASE10C_DRY_RUN.md');
    return;
  }

  // ── APPLY ─────────────────────────────────────────────────────────────────
  if (eligible.length !== 3) {
    console.error(`[10C] ABORT — expected 3 eligible, got ${eligible.length}. No writes.`);
    process.exit(1);
  }

  let changed = 0;
  for (const e of eligible) {
    // Atomic per row: both columns set together, guarded on BOTH still NULL.
    const { data, error } = await db.from('companies')
      .update({ website: e.rec.website, website_domain: e.rec.websiteDomain })
      .eq('id', e.rec.id).is('website', null).is('website_domain', null)
      .select('id, website, website_domain');
    if (error) { console.error(`[10C] update error ${e.rec.name}: ${error.message}`); continue; }
    if (data && data.length === 1) changed++;
  }

  // Post-apply validation: re-read and confirm EXACT target values.
  const post = await evaluate();
  const validated = APPROVED.every((rec) => {
    const e = post.find((p) => p.rec.id === rec.id)!;
    return e.cur.website === rec.website && e.cur.website_domain === rec.websiteDomain;
  });
  const postEligible = post.filter((e) => e.eligible).length;
  const ok = changed === 3 && validated && postEligible === 0;

  let md = `# PHASE10C_EXECUTION_REPORT.md\n\nReal company identity backfill — APPLIED. Generated ${stamp()}.\n\n`;
  md += `- Rows updated: **${changed}** (expected 3 → ${changed === 3 ? 'PASS' : 'FAIL'})\n`;
  md += `- Column writes: **${changed * 2}** (expected 6 → ${changed * 2 === 6 ? 'PASS' : 'FAIL'})\n`;
  md += `- Post-apply exact-value validation: **${validated ? 'PASS' : 'FAIL'}**\n`;
  md += `- Idempotency (eligible after apply): **${postEligible}** (expected 0 → ${postEligible === 0 ? 'PASS' : 'FAIL'})\n`;
  md += `- Overall: **${ok ? '✅ SUCCESS' : '❌ FAILURE'}**\n\n`;
  md += `## Before / after\n\n| company_id | name | before website | before website_domain | after website | after website_domain |\n|---|---|---|---|---|---|\n`;
  for (const rec of APPROVED) {
    const pre = evals.find((e) => e.rec.id === rec.id)!;
    const pst = post.find((e) => e.rec.id === rec.id)!;
    md += `| ${rec.id} | ${rec.name} | ${JSON.stringify(pre.cur.website)} | ${JSON.stringify(pre.cur.website_domain)} | ${JSON.stringify(pst.cur.website)} | ${JSON.stringify(pst.cur.website_domain)} |\n`;
  }
  md += `\n## Guards applied (pre-apply)\n\n${guardTable(evals)}\n`;
  md += `## Consistency invariant\n\nBoth columns written atomically per row — no row left with website≠NULL∧website_domain=NULL or vice-versa.\n\n`;
  md += `## Rollback\n\nSee PHASE10C_ROLLBACK.sql (guarded; restores both columns to NULL only if current == Phase10C values).\n`;
  writeFileSync(path.join(__dirname, '..', 'PHASE10C_EXECUTION_REPORT.md'), md);
  console.log('[10C] wrote PHASE10C_EXECUTION_REPORT.md');

  let sql = `-- PHASE10C_ROLLBACK.sql  (generated ${stamp()})\n`;
  sql += `-- Restores website + website_domain to NULL for the 3 Phase-10C companies,\n-- ONLY if current values still equal the Phase-10C backfill values.\nBEGIN;\n`;
  for (const rec of APPROVED) {
    sql += `UPDATE companies SET website = NULL, website_domain = NULL\n`;
    sql += `  WHERE id = '${rec.id}' AND website = '${rec.website}' AND website_domain = '${rec.websiteDomain}';\n`;
  }
  sql += `COMMIT;\n`;
  writeFileSync(path.join(__dirname, '..', 'PHASE10C_ROLLBACK.sql'), sql);
  console.log('[10C] wrote PHASE10C_ROLLBACK.sql');

  if (!ok) process.exit(1);
})().catch((e) => { console.error('[10C] FAILED:', e?.message ?? e); process.exit(1); });
