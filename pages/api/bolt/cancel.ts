/**
 * POST /api/bolt/cancel
 *
 * Sets `cancel_requested = true` on a running BOLT execution. The
 * pipeline polls the flag between stages and exits cleanly with
 * `status='cancelled'`, releasing its lock and preserving any work
 * that already completed (daily_content_plans / scheduled_posts /
 * campaign rows stay intact — the user can resume later or
 * re-launch from the same Brief).
 *
 * Request:  { run_id: string }
 * Response: 202 { run_id, status: 'cancelling' | 'cancelled' | 'already_terminal' }
 *
 * Frontend contract: keeps surfacing the user-friendly error
 * pipeline. We never expose raw failure messages here either.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const runId = typeof req.body?.run_id === 'string' ? req.body.run_id.trim() : null;
  if (!runId) {
    return res.status(400).json({ error: 'run_id is required' });
  }

  // Resolve the run so we can authz against its company_id without
  // trusting client-supplied companyId.
  const { data: run, error: fetchError } = await supabase
    .from('bolt_execution_runs')
    .select('id, company_id, status, cancel_requested')
    .eq('id', runId)
    .maybeSingle();

  if (fetchError) {
    console.error('[bolt/cancel] fetch failed', { runId, error: fetchError.message });
    return res.status(500).json({ error: 'Failed to look up run' });
  }
  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: (run as { company_id: string }).company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  const status = (run as { status?: string }).status ?? '';
  // No-op for runs that have already terminated. The UI can use this
  // response to refresh state.
  if (['completed', 'failed', 'cancelled', 'aborted', 'partially_completed'].includes(status)) {
    return res.status(202).json({ run_id: runId, status: 'already_terminal', terminal_status: status });
  }

  // Already requested — idempotent return.
  if ((run as { cancel_requested?: boolean }).cancel_requested) {
    return res.status(202).json({ run_id: runId, status: 'cancelling' });
  }

  // Stamp who asked for the cancel — `userId` from the access guard
  // is the authoritative source. Falls back to 'system' when the
  // request is service-to-service.
  const { error: updateError } = await ownedDbTable('bolt_execution_runs')
    .update({
      cancel_requested: true,
      cancel_requested_at: new Date().toISOString(),
      cancel_requested_by: access.userId ? String(access.userId) : 'system',
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  if (updateError) {
    console.error('[bolt/cancel] update failed', { runId, error: updateError.message });
    return res.status(500).json({ error: 'Failed to request cancellation' });
  }

  return res.status(202).json({ run_id: runId, status: 'cancelling' });
}
