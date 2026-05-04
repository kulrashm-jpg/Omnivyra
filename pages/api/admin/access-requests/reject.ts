
/**
 * POST /api/admin/access-requests/reject
 *
 * Super-admin only. Rejects an access request with a required reason.
 *
 * Body: { requestId: string, reason: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireAdminScope(req, res, 'access-requests:reject');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/access-requests/reject', 'access-requests:reject');
  }

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
      reviewed_by: ctx.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', requestId);

  return res.status(200).json({ success: true, requestId });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
