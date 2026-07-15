import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/admin/access-requests/reject
 *
 * Super-admin only. Rejects an access request with a required reason.
 *
 * Body: { requestId: string, reason: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_REVOKE } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Reject is the access-grant counterpart; gate with IDENTITY_ADMIN_REVOKE
  // (step-up required). Drops the dead profiles.is_super_admin lookup.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_REVOKE,
    reason: 'access request reject',
  });
  if (guard.ok !== true) return;
  const user = { id: guard.principal.userId };

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId, reason } = body as { requestId: string; reason: string };

  if (!requestId || !reason) return res.status(400).json({ error: 'requestId and reason are required' });

  const { data: request } = await supabase
    .from('access_requests')
    .select('id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) return res.status(404).json({ error: 'Access request not found' });
  if (request.status !== 'pending') return res.status(409).json({ error: `Request is already ${request.status}` });

  await supabase
    .from('access_requests')
    .update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', requestId);

  return res.status(200).json({ success: true, requestId });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/access-requests/reject' });
