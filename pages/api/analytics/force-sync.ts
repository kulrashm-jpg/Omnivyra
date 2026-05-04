import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { getActiveProperty } from '../../../backend/services/analyticsIntegrationService';
import { runIngestionForCompany } from '../../../backend/services/ingestionScheduler';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

// 15s upper bound on the synchronous wait. Returning 'started' after this is
// preferable to letting the HTTP request hang for minutes.
const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ status: 'error', error: 'unauthorized' });
  }

  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';
  if (!companyId) {
    return res.status(400).json({ status: 'error', error: 'company_id_required' });
  }
  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  const activeProperty = await getActiveProperty(companyId);
  if (!activeProperty) {
    return res.status(400).json({ status: 'error', error: 'no_active_property' });
  }

  // Note: we deliberately do NOT call saveSelectedProperty here. The active
  // property has already been verified above, and saveSelectedProperty fires
  // its own triggerImmediateGa4Ingestion in the background â€” calling it on
  // top of the explicit fire-and-forget below would race two runs against
  // each other. getActiveProperty is sufficient proof the property is live.

  const requestStart = new Date();

  // Fire-and-forget: the run can legitimately take minutes, so we must not
  // await it. runIngestionForCompany already wraps each source in try/catch
  // and writes status=error to data_source_status on failure, so an unhandled
  // rejection here is impossible â€” but we attach a catch handler defensively
  // so a genuine bug never surfaces as an unhandled rejection on the server.
  void runIngestionForCompany({
    companyId,
    sources: ['ga4'],
    force: true,
    reason: 'manual_force_sync',
  }).catch((err) => {
    console.error('[GA-FORCE-SYNC] background run threw', {
      companyId,
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
      .eq('source', 'ga')
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
      .eq('source', 'ga4')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    sessionsWritten = (lastRun as { records_inserted?: number } | null)?.records_inserted ?? null;
  }

  // TEMP verification log â€” remove once force-sync is observed working in prod.
  console.log('[GA-FORCE-SYNC]', {
    companyId,
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
      sessions_written: sessionsWritten,
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

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

