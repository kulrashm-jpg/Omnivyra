/**
 * POST /api/admin/credits/unfreeze
 *
 * Reverse the emergency freeze on an organization. Restores billing access.
 *
 * Body: { organizationId: string, reason: string, metadata?: object }
 * Auth: FINANCE_ADMIN.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../backend/services/requestAccessService';
import { isFinanceAdmin } from '../../../../backend/services/billing/financeRbacService';
import { applyFinancialControl } from '../../../../backend/services/billing/orgFinancialControlService';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { billingOk, billingFail } from '../../../../backend/services/billing/billingApiResponse';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:credits_unfreeze', 20, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAdmin(user.id))) return res.status(403).json({ error: 'FINANCE_ADMIN_REQUIRED' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { organizationId, reason, metadata } = body as {
    organizationId?: string;
    reason?:         string;
    metadata?:       Record<string, unknown>;
  };
  if (!organizationId)            return res.status(400).json({ error: 'organizationId required' });
  if (!reason?.trim())            return res.status(400).json({ error: 'reason required' });

  const result = await applyFinancialControl({
    organizationId,
    actorUserId: user.id,
    action:      'unfreeze',
    reason:      reason.trim(),
    metadata,
  });
  if (!result.ok) return billingFail(res, 500, { rawMessage: result.error, legacyCode: 'UNFREEZE_FAILED' });

  await recordAdminAudit({
    actorUserId:    user.id,
    action:         'ADMIN_CREDITS_UNFREEZE',
    targetType:     'organization',
    targetId:       organizationId,
    metadata:       { reason, ...(metadata ?? {}) },
    idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
  });

  return billingOk(res, 200, {
    status: 'succeeded',
    message: 'Billing unfrozen successfully.',
    legacy: { state: result.state },
  });
}

export default withIdempotency(handler, { scope: 'admin-credits-unfreeze', methods: ['POST'] });
