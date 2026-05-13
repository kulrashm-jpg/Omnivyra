import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { getActiveProperty, getActiveSearchConsoleProperty } from '../../../backend/services/analyticsIntegrationService';
import { runIngestionForCompany } from '../../../backend/services/ingestionScheduler';
import { buildGscHistoricalBackfillOverride } from '../../../backend/services/gscIngestionService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

// 15s upper bound on the synchronous wait. Returning 'started' after this is
// preferable to letting the HTTP request hang for minutes.
const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ status: 'error', error: 'unauthorized' });
  }

  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  const capability = req.body?.capability === 'google_search_console' || req.body?.capability === 'gsc'
    ? 'google_search_console'
    : 'google_analytics';
  const source = capability === 'google_search_console' ? 'gsc' : 'ga4';
  const statusSource = capability === 'google_search_console' ? 'gsc' : 'ga';
  if (!companyId) {
    return res.status(400).json({ status: 'error', error: 'company_id_required' });
  }
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  const activeProperty = capability === 'google_search_console'
    ? await getActiveSearchConsoleProperty(companyId)
    : await getActiveProperty(companyId);
  if (!activeProperty) {
    return res.status(400).json({
      status: 'error',
      error: capability === 'google_search_console' ? 'no_active_search_console_property' : 'no_active_property',
    });
  }

  // Note: we deliberately do NOT call saveSelectedProperty here. The active
  // property has already been verified above, and saveSelectedProperty fires
  // its own triggerImmediateGa4Ingestion in the background — calling it on
  // top of the explicit fire-and-forget below would race two runs against
  // each other. getActiveProperty is sufficient proof the property is live.

  const requestStart = new Date();

  // Fire-and-forget: the run can legitimately take minutes, so we must not
  // await it. runIngestionForCompany already wraps each source in try/catch
  // and writes status=error to data_source_status on failure, so an unhandled
  // rejection here is impossible — but we attach a catch handler defensively
  // so a genuine bug never surfaces as an unhandled rejection on the server.
  void runIngestionForCompany({
    companyId,
    sources: [source],
    force: true,
    overrides: capability === 'google_search_console'
      ? { gsc: buildGscHistoricalBackfillOverride() }
      : undefined,
    reason: capability === 'google_search_console' ? 'manual_gsc_force_sync' : 'manual_force_sync',
  }).catch((err) => {
    console.error('[ANALYTICS-FORCE-SYNC] background run threw', {
      companyId,
      capability,
      message: err instanceof Error ? err.message : String(err),
    });
  });

  // Poll data_source_status until either:
  //  - status='connected' AND last_synced_at > requestStart  (fresh sync detected)
  //  - status='error'                                        (run failed visibly)
  //  - 15s elapsed                                           (give up, return 'started')
  let observedStatus: 'connected' | 'error' | null = null;
  let lastSyncedAt: string | null = null;
  let lastError: string | null = null;

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from('data_source_status')
      .select('status, last_synced_at, error_message')
      .eq('company_id', companyId)
      .eq('source', statusSource)
      .maybeSingle();

    if (data) {
      const ts = data.last_synced_at ? new Date(data.last_synced_at) : null;
      if (data.status === 'connected' && ts && ts > requestStart) {
        observedStatus = 'connected';
        lastSyncedAt = data.last_synced_at;
        break;
      }
      if (data.status === 'error' && data.error_message) {
        observedStatus = 'error';
        lastError = data.error_message;
        break;
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // If a fresh completed run was observed, look up the row count from the
  // matching ingestion_run for the optional sessions_written field.
  let sessionsWritten: number | null = null;
  if (observedStatus === 'connected') {
    const { data: lastRun } = await supabase
      .from('ingestion_runs')
      .select('records_inserted')
      .eq('company_id', companyId)
      .eq('source', source)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    sessionsWritten = (lastRun as { records_inserted?: number } | null)?.records_inserted ?? null;
  }

  // TEMP verification log — remove once force-sync is observed working in prod.
  console.log('[ANALYTICS-FORCE-SYNC]', {
    companyId,
    capability,
    propertyId: activeProperty.property_id,
    observed_status: observedStatus,
    last_synced_at: lastSyncedAt,
    sessions_written: sessionsWritten,
    elapsed_ms: Date.now() - requestStart.getTime(),
  });

  if (observedStatus === 'connected') {
    return res.status(200).json({
      status: 'synced',
      last_synced_at: lastSyncedAt,
      sessions_written: capability === 'google_analytics' ? sessionsWritten : undefined,
      records_written: sessionsWritten,
    });
  }

  if (observedStatus === 'error') {
    return res.status(500).json({
      status: 'error',
      error: lastError,
    });
  }

  return res.status(202).json({
    status: 'started',
    message: 'Sync in progress',
    sessions_written: null,
  });
}
