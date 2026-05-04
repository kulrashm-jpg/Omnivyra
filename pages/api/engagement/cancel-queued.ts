import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * POST /api/engagement/cancel-queued
 *
 * Cancels a pending DM (or reply) action that the Chrome extension has not
 * yet claimed. The conversation pane shows queued-but-undelivered actions
 * inline with a Cancel button â€” clicking it routes here. We mark the row
 * 'failed' (status='failed', execution_result.reason='user_cancelled') so:
 *   - The has_pending_outbound_action signal flips off, the inbox stops
 *     showing the thread as "in flight"
 *   - The composer in the conversation pane unlocks for the next attempt
 *   - The same thread can be re-queued without the executor's
 *     idempotency-key dedup gate firing
 *
 * Safety: only the same organization that owns the action can cancel it,
 * and only rows that are still pending+unleased are cancellable. Once the
 * extension has claimed the row (dispatch_lease_id set) we leave it alone
 * â€” it's already in flight to LinkedIn.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

type Body = {
  organization_id?: string;
  action_id?: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as Body;
  const organizationId = (body.organization_id ?? '').trim();
  const actionId = (body.action_id ?? '').trim();

  if (!organizationId) return res.status(400).json({ error: 'organization_id required' });
  if (!actionId) return res.status(400).json({ error: 'action_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  // Only cancel rows that are still queued and unclaimed. Anything claimed
  // by the extension is in-flight; cancelling mid-flight risks the message
  // already being on the wire.
  const { data: updated, error } = await supabase
    .from('community_ai_actions')
    .update({
      status: 'failed',
      execution_result: { source: 'user', reason: 'user_cancelled' },
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
    .is('dispatch_lease_id', null)
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('[engagement/cancel-queued] update failed:', error.message);
    return res.status(500).json({ error: error.message });
  }

  if (!updated) {
    // Either the row doesn't exist, doesn't belong to this org, or is no
    // longer pending+unleased. Treat as conflict so the UI can refresh.
    return res.status(409).json({ error: 'Action is not in a cancellable state', code: 'NOT_CANCELLABLE' });
  }

  return res.status(200).json({ success: true, action_id: updated.id, status: updated.status });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

