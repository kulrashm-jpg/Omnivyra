
/**
 * POST /api/super-admin/credit-cost-config/update
 *
 * Update the credit cost for one or more actions.
 * Changes take effect immediately — no caching between DB and the
 * getCreditCost() function in creditDeductionService.
 *
 * Body: { updates: Array<{ action_type: string; credits: number; description?: string; smart_dedup_seconds?: number }> }
 *
 * GET /api/super-admin/credit-cost-config/update
 * Returns all current action costs from DB.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_MANAGE } from '../../../../shared/contracts/security';

type UpdateEntry = {
  action_type: string;
  credits: number;
  description?: string;
  smart_dedup_seconds?: number;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:credit-cost-config', 20, 60))) return;

  // Wave 2C-C: capability + step-up gate. billing.manage covers credit
  // cost configuration. Both GET (read config) and POST (mutate) flow
  // through the same capability — viewing platform pricing tunables is
  // also super-admin scope.
  const guard = await requireCapability(req, res, {
    capability: BILLING_MANAGE,
    reason: `super-admin ${req.method === 'GET' ? 'reads' : 'updates'} credit cost config`,
  });
  if (guard.ok !== true) return;
  const admin = guard.principal;

  // ── GET: return all current costs ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('credit_cost_config')
      .select('action_type, credits, category, description, smart_dedup_seconds, updated_at')
      .order('category')
      .order('action_type');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ costs: data });
  }

  // ── POST: update one or more action costs ──────────────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const updates: UpdateEntry[] = Array.isArray(body.updates) ? body.updates : [body];

    if (!updates.length) return res.status(400).json({ error: 'updates array is required' });

    const results: { action_type: string; ok: boolean; error?: string }[] = [];
    const now = new Date().toISOString();

    for (const entry of updates) {
      const { action_type, credits, description, smart_dedup_seconds } = entry;

      if (!action_type) { results.push({ action_type: '?', ok: false, error: 'action_type required' }); continue; }
      if (credits == null || credits < 0) { results.push({ action_type, ok: false, error: 'credits must be >= 0' }); continue; }

      const patch: Record<string, any> = { credits, updated_at: now };
      if (description      !== undefined) patch.description        = description;
      if (smart_dedup_seconds !== undefined) patch.smart_dedup_seconds = smart_dedup_seconds;

      const { error } = await supabase
        .from('credit_cost_config')
        .update(patch)
        .eq('action_type', action_type);

      results.push({ action_type, ok: !error, error: error?.message });
    }

    const failures = results.filter(r => !r.ok);
    if (failures.length > 0 && failures.length === results.length) {
      return res.status(500).json({ error: 'All updates failed', results });
    }

    await recordAdminAudit({
      actorUserId: admin.userId,
      action: 'SUPER_ADMIN_CREDIT_COST_CONFIG_UPDATE',
      targetType: 'credit_cost_config',
      metadata: { results },
      idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
    });
    return res.status(200).json({ success: true, results });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withIdempotency(handler, { scope: 'super-admin-credit-cost-config', methods: ['POST'] });
