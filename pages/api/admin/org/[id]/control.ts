/**
 * POST /api/admin/org/:id/control
 *
 * Super-admin-only. Sets per-org runtime controls via applyOrgControl.
 *
 * Body (any combination):
 *   {
 *     block?:              boolean,   // flip is_blocked
 *     blocked_reason?:     string,    // required when block=true
 *     daily_credit_limit?: number|null,// null = remove limit
 *     high_risk?:          boolean,   // flip is_high_risk
 *     high_risk_reason?:   string,
 *     notes?:              string
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAdminScope,
} from '../../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { recordAdminAudit } from '../../../../../backend/services/adminAuditService';
import { applyOrgControl } from '../../../../../backend/services/orgControlService';
import { withIdempotency } from '../../../../../backend/middleware/withIdempotency';
import { logger } from '../../../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:org_ctrl', 30, 60))) return;

  const ctx = await requireAdminScope(req, res, 'org:control');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/org/[id]/control', 'org:control');
  }
  const user = ctx;

  const orgId = String(req.query.id ?? '').trim();
  if (!orgId) return res.status(400).json({ error: 'org id required' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const {
    block,
    blocked_reason,
    daily_credit_limit,
    high_risk,
    high_risk_reason,
    notes,
  } = body as {
    block?:              boolean;
    blocked_reason?:     string;
    daily_credit_limit?: number | null;
    high_risk?:          boolean;
    high_risk_reason?:   string;
    notes?:              string;
  };

  if (block === undefined && daily_credit_limit === undefined && high_risk === undefined && notes === undefined) {
    return res.status(400).json({ error: 'At least one control field required' });
  }
  if (block === true && (!blocked_reason || !blocked_reason.trim())) {
    return res.status(400).json({ error: 'blocked_reason required when block=true' });
  }
  if (daily_credit_limit !== undefined && daily_credit_limit !== null) {
    if (!Number.isInteger(daily_credit_limit) || daily_credit_limit <= 0) {
      return res.status(400).json({ error: 'daily_credit_limit must be a positive integer or null' });
    }
  }

  try {
    await applyOrgControl({
      organizationId:   orgId,
      block,
      blockedReason:    blocked_reason,
      dailyCreditLimit: daily_credit_limit,
      highRisk:         high_risk,
      highRiskReason:   high_risk_reason,
      notes,
      actorUserId:      user.id,
    });
  } catch (err: any) {
    logger.error('admin_org_control_apply_failed', { orgId, message: err?.message });
    return res.status(500).json({ error: err?.message ?? 'Apply failed' });
  }

  await recordAdminAudit({
    actorUserId: user.id,
    action:      'ADMIN_ORG_CONTROL_UPDATE',
    targetType:  'organization',
    targetId:    orgId,
    metadata:    { block, blocked_reason, daily_credit_limit, high_risk, high_risk_reason, notes },
    idempotencyKey: `${orgId}:${new Date().toISOString().slice(0, 16)}`,
  });

  return res.status(200).json({ ok: true, organization_id: orgId });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
