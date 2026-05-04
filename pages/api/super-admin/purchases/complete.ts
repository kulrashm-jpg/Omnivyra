
/**
 * POST /api/super-admin/purchases/complete
 *
 * Called by the payment gateway webhook (or manually by super admin) to
 * mark a credit purchase as completed and credit the organization.
 *
 * Body: { purchase_id: string, reference_id?: string }
 *
 * Also handles:
 *   action = 'fail' â€” marks the purchase as failed without crediting.
 *   action = 'create' â€” creates a new pending purchase record (for testing
 *                        or manual offline purchases).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { isContentArchitectSession } from '../../../../backend/services/contentArchitectService';
import { completePurchase, failPurchase } from '../../../../backend/services/purchaseService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isContentArchitectSession(req)) {
    const ctx = await requireAdminScope(req, res, 'credits:grant');
    if (!ctx) return;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ADMIN_SCOPE]', '/api/super-admin/purchases/complete', 'credits:grant');
    }
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { action = 'complete', purchase_id, reference_id } = body as {
    action?: 'complete' | 'fail' | 'create';
    purchase_id?: string;
    reference_id?: string;
    // create fields
    organization_id?: string;
    package_id?: string;
    plan_id?: string;
    credits?: number;
    amount_paid?: number;
    currency?: string;
  };

  // â”€â”€ action = 'create': create a pending purchase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (action === 'create') {
    const { organization_id, package_id, plan_id, credits, amount_paid = 0, currency = 'USD' } = body;
    if (!organization_id) return res.status(400).json({ error: 'organization_id is required' });
    if (!credits || credits <= 0) return res.status(400).json({ error: 'credits must be positive' });
    if (!package_id && !plan_id) return res.status(400).json({ error: 'package_id or plan_id is required' });

    const sb = supabase;
    const { data, error } = await sb
      .from('credit_purchases')
      .insert({
        organization_id,
        package_id: package_id ?? null,
        plan_id:    plan_id ?? null,
        credits,
        amount_paid,
        currency,
        status: 'pending',
        reference_id: reference_id ?? null,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, purchase_id: data.id });
  }

  // â”€â”€ action = 'fail': mark purchase failed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (action === 'fail') {
    if (!purchase_id) return res.status(400).json({ error: 'purchase_id is required' });
    await failPurchase(purchase_id, reference_id);
    return res.status(200).json({ success: true, purchase_id, status: 'failed' });
  }

  // â”€â”€ action = 'complete': complete purchase and credit org â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!purchase_id) return res.status(400).json({ error: 'purchase_id is required' });

  const result = await completePurchase(purchase_id, reference_id);

  if (!result.success) {
    const failResult = result as Extract<typeof result, { success: false }>;
    const statusCode = failResult.reason === 'not_found' ? 404
                     : failResult.reason === 'already_failed' ? 409
                     : 500;
    return res.status(statusCode).json({ error: failResult.reason, detail: failResult.detail });
  }

  return res.status(200).json({
    success:        true,
    purchase_id:    result.purchaseId,
    credits_granted: result.creditsGranted,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
