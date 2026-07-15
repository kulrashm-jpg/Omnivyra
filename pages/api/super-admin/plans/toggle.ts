import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/super-admin/plans/toggle
 *
 * Activate or deactivate a pricing plan.
 * Deactivating a plan does NOT remove existing org assignments —
 * it prevents new assignments only.
 *
 * Body: { plan_key: string, is_active: boolean }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_PLAN_MANAGE } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Phase 2 mutation gate. Toggling pricing-plan activation affects every
  // tenant's ability to subscribe — gated by BILLING_PLAN_MANAGE which
  // requires phishing-resistant + trusted-device step-up. Bridge / content-
  // architect cookies cannot satisfy.
  const guard = await requireCapability(req, res, {
    capability: BILLING_PLAN_MANAGE,
    reason: 'super-admin toggles pricing plan activation',
  });
  if (guard.ok !== true) return;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/plans/toggle' });
