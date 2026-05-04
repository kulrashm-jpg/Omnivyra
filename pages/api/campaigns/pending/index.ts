import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET /api/campaigns/pending?company_id=
 *
 * List pending autonomous campaigns awaiting human approval.
 *
 * Auth: requireAuth + requireCompanyAccess
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAuth, requireCompanyAccess } from '@/backend/middleware/authMiddleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const companyId = req.query.company_id as string;

  const allowed = await requireCompanyAccess(auth.user.id, companyId, res);
  if (!allowed) return;

  const { data, error } = await supabase
    .from('pending_campaigns')
    .select('id, company_id, campaign_plan, generation_meta, status, expires_at, created_at')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[campaigns/pending]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(200).json({ success: true, data: data ?? [] });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

