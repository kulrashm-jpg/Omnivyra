/**
 * POST /api/super-admin/financial-control
 *
 * Phase 2 D — emergency freeze / unfreeze + billing lock / unlock.
 *
 * Body:
 *   {
 *     organizationId: string,
 *     action:         'freeze' | 'unfreeze' | 'lock' | 'unlock',
 *     reason:         string,
 *     metadata?:      object,
 *   }
 *
 * Auth: FINANCE_ADMIN or SUPER_ADMIN.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../backend/services/requestAccessService';
import { isFinanceAdmin } from '../../../backend/services/billing/financeRbacService';
import { applyFinancialControl } from '../../../backend/services/billing/orgFinancialControlService';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:financial-control', 20, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isFinanceAdmin(user.id))) {
    return res.status(403).json({ error: 'FINANCE_ADMIN_REQUIRED' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { organizationId, action, reason, metadata } = body as {
    organizationId?: string;
    action?:         'freeze' | 'unfreeze' | 'lock' | 'unlock';
    reason?:         string;
    metadata?:       Record<string, unknown>;
  };

  if (!organizationId)                          return res.status(400).json({ error: 'organizationId required' });
  if (!['freeze','unfreeze','lock','unlock'].includes(String(action))) {
    return res.status(400).json({ error: "action must be freeze|unfreeze|lock|unlock" });
  }
  if (!reason?.trim())                          return res.status(400).json({ error: 'reason required' });

  const result = await applyFinancialControl({
    organizationId,
    actorUserId: user.id,
    action:      action as 'freeze'|'unfreeze'|'lock'|'unlock',
    reason:      reason.trim(),
    metadata,
  });
  if (!result.ok) return res.status(500).json({ error: result.error });

  await recordAdminAudit({
    actorUserId:    user.id,
    action:         `ADMIN_FINANCIAL_CONTROL_${(action as string).toUpperCase()}`,
    targetType:     'organization',
    targetId:       organizationId,
    metadata:       { action, reason, ...(metadata ?? {}) },
    idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
  });

  return res.status(200).json({ ok: true, state: result.state });
}

export default withIdempotency(handler, { scope: 'admin-financial-control', methods: ['POST'] });
