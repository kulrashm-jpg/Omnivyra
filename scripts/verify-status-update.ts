/**
 * Triggers a real scheduler-driven ingestion for the connected company and
 * verifies that data_source_status + ingestion_runs reflect the result.
 *
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-status-update.ts
 */

import { createServiceRoleMigrationProxy } from '../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { runIngestionForCompany } from '../backend/services/ingestionScheduler';

async function main() {
  const { data: integrations } = await supabase
    .from('analytics_integrations').select('company_id').eq('provider', 'GA4').limit(1);
  if (!integrations?.length) { console.log('no integration'); return; }
  const companyId = integrations[0].company_id;
  console.log('triggering ga4 scheduler run for company =', companyId);

  const t0 = Date.now();
  const summary = await runIngestionForCompany({ companyId, sources: ['ga4'] });
  console.log(`ran in ${(Date.now() - t0) / 1000}s`);
  console.log('summary.sources:', JSON.stringify(summary.sources, null, 2));
  console.log('summary.ready  :', summary.ready);

  const { data: dss } = await supabase
    .from('data_source_status').select('*')
    .eq('company_id', companyId).eq('source', 'ga');
  console.log('\ndata_source_status (source=ga):');
  console.log(JSON.stringify(dss, null, 2));

  const { data: runs } = await supabase
    .from('ingestion_runs').select('id, status, started_at, completed_at, error_message, processed_count, inserted_count')
    .eq('company_id', companyId).eq('source', 'ga4')
    .order('started_at', { ascending: false }).limit(3);
  console.log('\ningestion_runs (most recent ga4):');
  console.log(JSON.stringify(runs, null, 2));

  const dssRow = dss?.[0];
  const lastRun = runs?.[0];
  console.log('\n=== verification ===');
  console.log(JSON.stringify({
    status_update_integrated:
      Boolean(dssRow) &&
      ['connected', 'error'].includes(dssRow.status) &&
      (dssRow.status === 'connected' ? Boolean(dssRow.last_synced_at) : true) &&
      (dssRow.status === 'error' ? Boolean(dssRow.error_message) : dssRow.error_message === null),
    ui_sync_state_correct: Boolean(lastRun?.completed_at) && lastRun.status === 'completed',
    data_source_status: dssRow,
    last_run_status: lastRun?.status,
    last_run_completed_at: lastRun?.completed_at,
  }, null, 2));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
