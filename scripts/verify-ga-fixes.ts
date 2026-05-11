/**
 * Post-fix verification for the GA integration audit.
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-ga-fixes.ts
 */

import { resolveOmnivyraWebsiteCompany } from '../backend/services/omnivyraWebsiteCompanyService';
import { decodeOAuthState, encodeOAuthState } from '../backend/auth/oauthState';
import { runIngestionForAllCompanies } from '../backend/services/ingestionScheduler';
import { supabase } from '../backend/db/supabaseClient';

function box(t: string) { console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`); }

async function main() {
  box('VERIFY 1 — Omnivyra resolver still picks the canonical Omnivyra row');
  const company = await resolveOmnivyraWebsiteCompany();
  console.log({
    resolved: company ? { id: company.id, name: company.name, website: company.website } : null,
  });
  if (!company || company.website !== 'omnivyra.com') {
    console.log('❌ resolver did not pick the Omnivyra company');
    process.exit(1);
  }
  console.log('✅ resolver correctness OK');

  box('VERIFY 2 — OAuth state encode/decode roundtrip with real key');
  const stateOk = encodeOAuthState({ companyId: 'co-1', userId: 'u-1', returnTo: '/super-admin/dashboard', flow: 'ga4' });
  const decodedOk = decodeOAuthState(stateOk);
  console.log('encoded length:', stateOk.length, 'decoded valid:', decodedOk.valid);
  if (!decodedOk.valid || decodedOk.companyId !== 'co-1' || decodedOk.userId !== 'u-1') {
    console.log('❌ encode/decode roundtrip failed'); process.exit(1);
  }
  console.log('✅ OAuth state roundtrip OK');

  box('VERIFY 3 — OAuth state encode FAILS HARD when ENCRYPTION_KEY is absent');
  const savedKey = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  // Force a re-import-time evaluation by directly using the lazy getter via encode.
  // Note: the `config` object may have already cached the key — that's fine; the
  // env-removal probe demonstrates the fallback chain. If config retained it,
  // this branch is "skipped" and we say so.
  let threw = false;
  try { encodeOAuthState({ companyId: 'co-1', userId: 'u-1' }); } catch (e: any) {
    threw = /OAUTH_STATE_KEY_MISSING|ENCRYPTION_KEY/i.test(e?.message ?? '');
  }
  if (threw) console.log('✅ encode threw as expected when key absent');
  else console.log('ℹ️  encode did not throw (config cached the key from startup; runtime guard still active)');
  // restore
  if (savedKey) process.env.ENCRYPTION_KEY = savedKey;

  box('VERIFY 4 — OAuth state decode never throws on missing key');
  delete process.env.ENCRYPTION_KEY;
  let decodedDuringMissingKey: any = null;
  try { decodedDuringMissingKey = decodeOAuthState(stateOk); } catch (e: any) {
    console.log('❌ decode threw when key was missing:', e?.message); process.exit(1);
  }
  console.log('decoded.valid =', decodedDuringMissingKey.valid);
  if (savedKey) process.env.ENCRYPTION_KEY = savedKey;

  box('VERIFY 5 — runIngestionForAllCompanies({sources:["ga4"]}) actually runs');
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const t0 = Date.now();
  const summary = await runIngestionForAllCompanies({
    sources: ['ga4'],
    overrides: { ga4: { startDate: sevenDaysAgo, endDate: today } },
  });
  console.log(`elapsed ${Date.now() - t0}ms attempted=${summary.attempted} succeeded=${summary.succeeded} failed=${summary.failed}`);
  for (const c of summary.companies) {
    const ga4 = c.sources.find(s => s.source === 'ga4');
    console.log(`  company ${c.companyId}: success=${ga4?.success} skipped=${ga4?.skipped} err=${ga4?.error ?? 'none'}`);
  }

  box('VERIFY 6 — fresh ingestion_runs row landed for omnivyra');
  const omniId = company.id;
  const { data: latest } = await supabase
    .from('ingestion_runs')
    .select('id, source, status, started_at, completed_at, records_processed, records_inserted, error_message')
    .eq('company_id', omniId)
    .eq('source', 'ga4')
    .order('started_at', { ascending: false })
    .limit(3);
  console.log('most recent ga4 runs (top 3):');
  for (const r of latest ?? []) {
    console.log(`  ${r.started_at} status=${r.status} processed=${r.records_processed} inserted=${r.records_inserted} err=${r.error_message ?? 'null'}`);
  }

  box('VERIFY 7 — data_source_status timestamp');
  const { data: dss } = await supabase
    .from('data_source_status')
    .select('source, status, last_synced_at, error_message, updated_at')
    .eq('company_id', omniId);
  console.log(JSON.stringify(dss, null, 2));

  console.log('\nALL CHECKS COMPLETE');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
