/**
 * POST /api/rpa/cancel
 *
 * Cooperative cancellation. Stamps `community_ai_actions.cancel_requested_at`
 * on the target row; the RPA runner polls this column between steps and
 * aborts gracefully. The row status is NOT changed here — the runner
 * writes the final `failed(CANCELLED)` via the central executor pipeline,
 * which keeps the trigger invariant satisfied.
 *
 * Body: { action_id: string, organization_id?: string, reason?: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as { action_id?: string; organization_id?: string; reason?: string };
    const actionId = (body.action_id ?? '').toString().trim();
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;

    if (!actionId) return res.status(400).json({ error: 'action_id required' });
    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    // Tenant scope + existence check before stamping.
    const { data: action } = await supabase
      .from('community_ai_actions')
      .select('id, organization_id, status, execution_mode, cancel_requested_at')
      .eq('id', actionId)
      .maybeSingle();
    if (!action) return res.status(404).json({ error: 'ACTION_NOT_FOUND' });
    if (action.organization_id !== organizationId) {
      return res.status(403).json({ error: 'TENANT_SCOPE_VIOLATION' });
    }

    // Already terminal: nothing to cancel.
    if (['executed', 'sent_unverified', 'failed', 'skipped', 'blocked'].includes(action.status || '')) {
      return res.status(200).json({ success: true, already_terminal: true, status: action.status });
    }

    // Idempotent: if cancel_requested_at is already set, return early.
    if ((action as any).cancel_requested_at) {
      return res.status(200).json({ success: true, idempotent: true });
    }

    const { error: updateErr } = await supabase
      .from('community_ai_actions')
      .update({
        cancel_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', actionId);

    if (updateErr) {
      return res.status(500).json({ error: 'CANCEL_MARK_FAILED', message: updateErr.message });
    }

    return res.status(200).json({
      success: true,
      action_id: actionId,
      cancel_requested_at: new Date().toISOString(),
      reason: body.reason ?? null,
    });
  } catch (err) {
    console.error('[rpa/cancel]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Cancel failed' });
  }
}
