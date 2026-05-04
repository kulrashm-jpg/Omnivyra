
/**
 * DELETE /api/admin/access-requests/delete
 *
 * Super-admin only. Soft-deletes an access request (status â†’ deleted).
 *
 * Body: { requestId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireAdminScope(req, res, 'access-requests:delete');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/access-requests/delete', 'access-requests:delete');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId } = body as { requestId: string };

  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  const { error } = await supabase
    .from('access_requests')
    .update({
      status: 'deleted',
      reviewed_by: ctx.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
