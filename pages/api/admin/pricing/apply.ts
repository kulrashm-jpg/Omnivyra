/**
 * POST /api/admin/pricing/apply
 *
 * Promotes a pending pricing_adjustment_queue row to an active
 * action_pricing_config row. Super-admin only.
 *
 * Body:  { adjustment_id: string }
 *
 * Flow:
 *   1. Validate the queue row exists AND status='pending'
 *   2. Write new active row via applyActionPricingChange (versioned)
 *   3. Mark queue row status='applied' + reviewed_by + reviewed_at + applied_at
 *   4. Mark any OTHER pending rows for the same (action, model) as 'superseded'
 *
 * Audited via admin_audit_log.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAdminScope,
} from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { applyActionPricingChange } from '../../../../backend/services/actionPricingApplyService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { logger } from '../../../../backend/services/logger';

async function pricingApplyHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:pricing_apply', 20, 60))) return;

  const ctx = await requireAdminScope(req, res, 'pricing:apply');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/pricing/apply', 'pricing:apply');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const adjustmentId = typeof body.adjustment_id === 'string' ? body.adjustment_id.trim() : '';
  if (!adjustmentId) {
    return res.status(400).json({ error: 'adjustment_id (string) required' });
  }

  // ── 1. Load the queue row + validate state ─────────────────────────────
  const { data: row, error: loadErr } = await supabase
    .from('pricing_adjustment_queue')
    .select('id, action_key, model_name, current_multiplier, proposed_multiplier, margin_percent, reason, status, source_week')
    .eq('id', adjustmentId)
    .maybeSingle();

  if (loadErr) {
    logger.error('admin_pricing_apply_load_failed', { message: loadErr.message });
    return res.status(500).json({ error: 'Failed to load adjustment', code: 'LOAD_FAILED' });
  }
  if (!row) {
    return res.status(404).json({ error: 'Adjustment not found', code: 'NOT_FOUND' });
  }
  const queueRow = row as {
    id: string;
    action_key: string;
    model_name: string | null;
    current_multiplier: number;
    proposed_multiplier: number;
    margin_percent: number | null;
    reason: string;
    status: string;
    source_week: string | null;
  };
  if (queueRow.status !== 'pending') {
    return res.status(409).json({
      error: `Adjustment is '${queueRow.status}', not 'pending'`,
      code:  'INVALID_STATE',
    });
  }

  // ── 2. Apply via the shared helper ─────────────────────────────────────
  let newPricingRowId: string;
  try {
    const result = await applyActionPricingChange({
      actionKey:      queueRow.action_key,
      costMultiplier: Number(queueRow.proposed_multiplier),
      notes:          `Applied from queue ${queueRow.id}: ${queueRow.reason}`,
    });
    newPricingRowId = result.id;
  } catch (err: any) {
    logger.error('admin_pricing_apply_write_failed', { message: err?.message });
    return res.status(500).json({ error: err?.message ?? 'Apply failed', code: 'APPLY_FAILED' });
  }

  // ── 3. Mark the chosen queue row as applied ────────────────────────────
  const now = new Date().toISOString();
  const { error: markErr } = await supabase
    .from('pricing_adjustment_queue')
    .update({
      status:              'applied',
      reviewed_by_user_id: ctx.id,
      reviewed_at:         now,
      applied_at:          now,
    })
    .eq('id', queueRow.id)
    .eq('status', 'pending');  // concurrency guard

  if (markErr) {
    // Pricing row was written; queue row couldn't be updated. Log and continue.
    logger.error('admin_pricing_apply_mark_failed', { id: queueRow.id, message: markErr.message });
  }

  // ── 4. Supersede any other pending proposals for same (action, model) ──
  await supabase
    .from('pricing_adjustment_queue')
    .update({
      status:              'superseded',
      reviewed_by_user_id: ctx.id,
      reviewed_at:         now,
    })
    .eq('action_key', queueRow.action_key)
    .is('model_name', queueRow.model_name)   // null-safe match
    .eq('status', 'pending')
    .neq('id', queueRow.id);

  // ── 5. Audit trail ─────────────────────────────────────────────────────
  await recordAdminAudit({
    actorUserId: ctx.id,
    action:      'ADMIN_PRICING_APPLY_QUEUED',
    targetType:  'action_pricing_config',
    targetId:    newPricingRowId,
    metadata: {
      queue_id:            queueRow.id,
      action_key:          queueRow.action_key,
      model_name:          queueRow.model_name,
      current_multiplier:  queueRow.current_multiplier,
      proposed_multiplier: queueRow.proposed_multiplier,
      source_week:         queueRow.source_week,
    },
    idempotencyKey: queueRow.id,
  });

  return res.status(200).json({
    ok:                 true,
    queue_id:           queueRow.id,
    new_pricing_row_id: newPricingRowId,
    action_key:         queueRow.action_key,
    model_name:         queueRow.model_name,
    new_multiplier:     queueRow.proposed_multiplier,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(withIdempotency(pricingApplyHandler, { scope: 'admin-pricing-apply', methods: ['POST'] }));
