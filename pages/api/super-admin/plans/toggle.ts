
/**
 * POST /api/super-admin/plans/toggle
 *
 * Activate or deactivate a pricing plan.
 * Deactivating a plan does NOT remove existing org assignments â€”
 * it prevents new assignments only.
 *
 * Body: { plan_key: string, is_active: boolean }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { isContentArchitectSession } from '../../../../backend/services/contentArchitectService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isContentArchitectSession(req)) {
    const ctx = await requireAdminScope(req, res, 'plans:toggle');
    if (!ctx) return;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ADMIN_SCOPE]', '/api/super-admin/plans/toggle', 'plans:toggle');
    }
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { plan_key, is_active } = body as { plan_key: string; is_active: boolean };

  if (!plan_key) return res.status(400).json({ error: 'plan_key is required' });
  if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be a boolean' });

  try {
    const { data: plan, error: fetchErr } = await supabase
      .from('pricing_plans')
      .select('id, name')
      .eq('plan_key', plan_key)
      .maybeSingle();

    if (fetchErr || !plan) return res.status(404).json({ error: 'Plan not found' });

    const { error: updateErr } = await supabase
      .from('pricing_plans')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', plan.id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({ success: true, plan_key, is_active });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
