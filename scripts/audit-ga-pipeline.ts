/**
 * Full-pipeline audit: OAuth → Property → Ingestion → Canonical → Dashboard.
 *
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/audit-ga-pipeline.ts
 */

import { supabase } from '../backend/db/supabaseClient';
import {
  getGoogleAnalyticsStatus,
  getValidAccessTokenForIntegration,
} from '../backend/services/analyticsIntegrationService';
import { resolveCompanyWebsite } from '../backend/services/ingestionUtils';
import { ingestGa4Data } from '../backend/services/ga4IngestionService';
import { runIngestionForCompany } from '../backend/services/ingestionScheduler';

function box(title: string) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

async function callRunReport(propertyId: string, accessToken: string, dateStart: string, dateEnd: string) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: dateStart, endDate: dateEnd }],
        dimensions: [
          { name: 'date' },
          { name: 'pagePath' },
          { name: 'sessionDefaultChannelGroup' },
          { name: 'deviceCategory' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'engagedSessions' },
        ],
        limit: 50,
      }),
    },
  );
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* */ }
  return { status: res.status, ok: res.ok, body: text, parsed };
}

async function callEventsReport(propertyId: string, accessToken: string, dateStart: string, dateEnd: string) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        dateRanges: [{ startDate: dateStart, endDate: dateEnd }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        limit: 100,
      }),
    },
  );
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* */ }
  return { status: res.status, ok: res.ok, body: text, parsed };
}

async function main() {
  const result: any = {};

  box('STEP 0 — locate connected GA4 integration');
  const { data: integrations } = await supabase
    .from('analytics_integrations')
    .select('id, company_id, status, updated_at')
    .eq('provider', 'GA4');

  if (!integrations || integrations.length === 0) {
    console.log('NO GA4 integrations exist'); process.exit(0);
  }
  for (const row of integrations) {
    console.log(`integration_id=${row.id} company_id=${row.company_id} status=${row.status}`);
  }

  const integration = integrations[0];
  const companyId = integration.company_id;
  console.log(`\n→ auditing company_id=${companyId}`);

  box('STEP 0b — connection status (active property + token)');
  const status = await getGoogleAnalyticsStatus(companyId);
  console.log({
    integration_id: status.integration?.id,
    integration_status: status.integration?.status,
    activeProperty: status.activeProperty
      ? { id: status.activeProperty.property_id, name: status.activeProperty.property_name, is_active: status.activeProperty.is_active }
      : null,
    ready: status.ready,
    tokenValid: status.tokenValid,
    tokenExpiresAt: status.tokenExpiresAt,
    propertiesCount: status.propertiesCount,
  });
  if (!status.activeProperty) {
    console.log('❌ no active property — ingestion cannot run');
    process.exit(0);
  }

  const propertyId = status.activeProperty.property_id;

  box('STEP 0c — company website (prerequisite for canonical writes)');
  const { data: companyRow } = await supabase
    .from('companies')
    .select('id, name, website, website_domain')
    .eq('id', companyId)
    .single();
  console.log({ company: companyRow });
  const resolvedWebsite = await resolveCompanyWebsite(companyId);
  console.log('resolveCompanyWebsite =>', resolvedWebsite);
  if (!resolvedWebsite) {
    console.log('🚨 company has no website/website_domain — ingestGa4Data WILL throw "No website configured"');
  }

  box('STEP 1 — ingestion trigger evidence (ingestion_runs)');
  const { data: runs } = await supabase
    .from('ingestion_runs')
    .select('id, source, status, started_at, completed_at, error_message, idempotency_key, processed_count, inserted_count')
    .eq('company_id', companyId)
    .eq('source', 'ga4')
    .order('started_at', { ascending: false })
    .limit(10);
  console.log(`ga4 ingestion_runs found: ${runs?.length ?? 0}`);
  for (const r of runs ?? []) {
    console.log(`  ${r.started_at} status=${r.status} processed=${r.processed_count} inserted=${r.inserted_count} err=${r.error_message ? r.error_message.slice(0, 200) : 'null'}`);
  }
  result.step1 = {
    ingestion_trigger_called: (runs?.length ?? 0) > 0,
    ingestion_function_executed: (runs?.length ?? 0) > 0,
  };

  box('STEP 2 — most recent error message from ingestion runs');
  const lastFailed = (runs ?? []).find((r) => r.status === 'failed');
  result.step2 = {
    error_logged: Boolean(lastFailed),
    error_message: lastFailed?.error_message ?? null,
  };
  console.log(result.step2);

  box('STEP 3 — live GA Data API runReport (sessions report)');
  const accessToken = await getValidAccessTokenForIntegration(integration.id);
  if (!accessToken) {
    console.log('❌ no valid access token'); process.exit(0);
  }
  console.log(`access_token len=${accessToken.length}`);
  const dateStart = '7daysAgo';
  const dateEnd = 'today';
  const sessionsReport = await callRunReport(propertyId, accessToken, dateStart, dateEnd);
  console.log('HTTP', sessionsReport.status, sessionsReport.ok ? 'ok' : 'FAIL');
  if (!sessionsReport.ok) {
    console.log('body:', sessionsReport.body.slice(0, 800));
  } else {
    const rows = sessionsReport.parsed?.rows ?? [];
    console.log('rowCount =', sessionsReport.parsed?.rowCount ?? 'n/a', 'rows.length =', rows.length);
    console.log('sample (first 3):');
    for (const r of rows.slice(0, 3)) {
      console.log('   dims=', r.dimensionValues?.map((d: any) => d.value), 'metrics=', r.metricValues?.map((m: any) => m.value));
    }
  }

  const eventsReport = await callEventsReport(propertyId, accessToken, dateStart, dateEnd);
  console.log('\nevents report HTTP', eventsReport.status);
  const eventsRows = eventsReport.parsed?.rows ?? [];
  console.log('events rowCount =', eventsReport.parsed?.rowCount ?? 'n/a');
  for (const r of eventsRows.slice(0, 5)) {
    console.log('   eventName=', r.dimensionValues?.[0]?.value, 'count=', r.metricValues?.[0]?.value);
  }

  result.step3 = {
    api_called: true,
    property_id_used: propertyId,
    date_range: `${dateStart}..${dateEnd}`,
    response: {
      rows_count: sessionsReport.parsed?.rowCount ?? 0,
      sample: (sessionsReport.parsed?.rows ?? []).slice(0, 3),
    },
  };

  box('STEP 4 — invoke ingestGa4Data() directly and capture transformation');
  let directIngestionOutput: any = null;
  let directIngestionError: any = null;
  try {
    directIngestionOutput = await ingestGa4Data({ companyId });
    console.log('ingestGa4Data result:', directIngestionOutput);
  } catch (err) {
    directIngestionError = err instanceof Error ? { message: err.message, stack: err.stack } : String(err);
    console.error('❌ ingestGa4Data threw:', directIngestionError);
  }
  result.step4 = {
    rows_received: directIngestionOutput?.sessionsProcessed ?? 0,
    rows_after_processing: directIngestionOutput?.sessionsInserted ?? 0,
    direct_error: directIngestionError?.message ?? null,
  };

  box('STEP 5 — canonical table counts (this company)');
  const tables = ['canonical_sessions', 'canonical_events', 'canonical_page_views', 'canonical_conversions', 'canonical_pages', 'canonical_users'];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('id', { count: 'exact', head: true }).eq('company_id', companyId);
    counts[t] = count ?? 0;
    if (error) counts[t] = -1;
    console.log(`  ${t.padEnd(28)} = ${count ?? 'err: ' + error?.message}`);
  }
  result.step5 = {
    canonical_events_count: counts.canonical_events,
    canonical_sessions_count: counts.canonical_sessions,
    canonical_page_views_count: counts.canonical_page_views,
    canonical_conversions_count: counts.canonical_conversions,
    writes_successful: counts.canonical_sessions > 0 || counts.canonical_events > 0,
  };

  box('STEP 6 — sync status (data_source_status)');
  const { data: dataSourceStatus } = await supabase
    .from('data_source_status')
    .select('*')
    .eq('company_id', companyId);
  console.log(JSON.stringify(dataSourceStatus, null, 2));
  const gaStatusRow = (dataSourceStatus ?? []).find((r: any) => r.source === 'ga' || r.source === 'ga4');
  result.step6 = {
    last_synced_at: gaStatusRow?.last_synced_at ?? null,
    status: gaStatusRow?.status ?? null,
    last_error: gaStatusRow?.error_message ?? null,
  };

  box('STEP 7 — dashboard read (behaviorAnalyticsService-style queries)');
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const sessionQ = await supabase.from('canonical_sessions').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).gte('started_at', since);
  const eventQ = await supabase.from('canonical_events').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).gte('event_timestamp', since);
  console.log('sessions(30d) =', sessionQ.count ?? 'err', sessionQ.error?.message ?? '');
  console.log('events(30d)   =', eventQ.count ?? 'err', eventQ.error?.message ?? '');
  result.step7 = {
    query_executed: !sessionQ.error && !eventQ.error,
    result_counts: {
      sessions: sessionQ.count ?? 0,
      events: eventQ.count ?? 0,
    },
    query_errors: { sessions: sessionQ.error?.message ?? null, events: eventQ.error?.message ?? null },
  };

  box('STEP 8 — failure point');
  let failure_stage = 'unknown';
  let root_cause = '';
  let fix_required = '';

  if (!resolvedWebsite) {
    failure_stage = 'ingestion';
    root_cause = `companies.website / website_domain is not set for company ${companyId}. ingestGa4Data() throws "No website configured for company ..." before any canonical write.`;
    fix_required = `UPDATE companies SET website='https://www.omnivyra.com' WHERE id='${companyId}';`;
  } else if (!sessionsReport.ok) {
    failure_stage = 'api';
    root_cause = `Google Data API returned HTTP ${sessionsReport.status}. body=${sessionsReport.body.slice(0, 400)}`;
    fix_required = sessionsReport.parsed?.error?.status === 'PERMISSION_DENIED'
      ? 'Enable analyticsdata.googleapis.com in the GCP project that owns the OAuth client.'
      : 'Inspect Google API error and remediate.';
  } else if ((sessionsReport.parsed?.rowCount ?? 0) === 0 && (eventsReport.parsed?.rowCount ?? 0) === 0) {
    failure_stage = 'api';
    root_cause = 'GA Data API returned 0 rows for last 7 days. Realtime data has not yet propagated to GA reporting (GA4 standard reports lag ~24h).';
    fix_required = 'Wait ~24h for GA4 to materialize today\'s data, OR connect a property that has historical data.';
  } else if (directIngestionError) {
    failure_stage = 'ingestion';
    root_cause = directIngestionError.message;
    fix_required = 'Inspect directIngestionError stack and fix.';
  } else if (counts.canonical_events === 0 && counts.canonical_sessions === 0) {
    failure_stage = 'db_write';
    root_cause = 'API returned rows and ingestion ran, but canonical_* tables are empty for this company.';
    fix_required = 'Inspect ingestGa4Data return value vs DB state — likely RPC omnivyra_upsert_behavioral_analytics or upsert error swallowed.';
  } else if (!gaStatusRow?.last_synced_at) {
    failure_stage = 'status_update';
    root_cause = 'data_source_status.last_synced_at is null — UI reads it as "Not synced yet".';
    fix_required = 'Verify setDataSourceStatus completed; it runs at end of scheduler success path.';
  } else if (result.step7.result_counts.sessions === 0 && counts.canonical_sessions > 0) {
    failure_stage = 'dashboard_read';
    root_cause = 'canonical_sessions has rows, but the 30d window query returns 0. Likely started_at is older than the window.';
    fix_required = 'Check canonical_sessions.started_at distribution — Date(sessionDate) may be defaulting to today vs actual date.';
  } else {
    failure_stage = 'none';
    root_cause = 'pipeline appears healthy';
  }

  result.step8 = { failure_stage, root_cause, fix_required };

  box('FINAL JSON');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
