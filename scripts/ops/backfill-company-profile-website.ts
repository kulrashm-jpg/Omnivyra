/**
 * Backfill company_profiles.website_url from companies.website where the profile
 * copy is missing — the canonical-website propagation gap (companies.website set,
 * company_profiles.website_url NULL) that trapped onboarding on a read-only
 * "No canonical website" field.
 *
 * SAFETY:
 *   - Read-only by default; pass --apply to write.
 *   - Updates ONLY rows where company_profiles.website_url IS NULL (never overwrites).
 *   - Skips companies.website values that are not a real http(s) URL (e.g. the
 *     companyId placeholder setup-company writes when no canonical website exists).
 *   - Does not touch domain ownership, forwarding, uniqueness, credits, or policy.
 *
 *   node -r ts-node/register scripts/ops/backfill-company-profile-website.ts           # dry-run
 *   node -r ts-node/register scripts/ops/backfill-company-profile-website.ts --apply   # write
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sb = createClient(url, key, { auth: { persistSession: false } });
const isRealUrl = (w?: string | null): boolean => /^https?:\/\//i.test(String(w || '').trim());

async function main(): Promise<void> {
  const { data: profs, error } = await sb.from('company_profiles').select('company_id, website_url');
  if (error) throw new Error(`read company_profiles: ${error.message}`);
  const nullIds = (profs || []).filter((p) => !String(p.website_url || '').trim()).map((p) => p.company_id);

  const targets: Array<{ id: string; website: string }> = [];
  for (let i = 0; i < nullIds.length; i += 200) {
    const { data: cos, error: ce } = await sb.from('companies').select('id, website').in('id', nullIds.slice(i, i + 200));
    if (ce) throw new Error(`read companies: ${ce.message}`);
    (cos || []).forEach((c) => { if (isRealUrl(c.website)) targets.push({ id: c.id, website: String(c.website).trim() }); });
  }

  console.log(`[backfill] profiles=${(profs || []).length} null_website=${nullIds.length} backfillable=${targets.length} mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  for (const t of targets) console.log(`  ${apply ? 'UPDATE' : 'would update'} ${t.id} -> ${t.website}`);
  if (!apply) { console.log('[backfill] dry-run only. Re-run with --apply to write.'); return; }

  let ok = 0, fail = 0;
  for (const t of targets) {
    const { error: ue } = await sb
      .from('company_profiles')
      .update({ website_url: t.website, updated_at: new Date().toISOString() })
      .eq('company_id', t.id)
      .is('website_url', null); // guard: only when still NULL — never overwrite
    if (ue) { fail++; console.error(`  FAILED ${t.id}: ${ue.message}`); } else ok++;
  }
  console.log(`[backfill] applied ok=${ok} fail=${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
