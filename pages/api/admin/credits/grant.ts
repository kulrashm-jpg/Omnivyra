/**
 * POST /api/admin/credits/grant
 *
 * Super-admin-only endpoint to manually grant additional free credits to an
 * organization after the initial one-time grant. Used as an extension lever
 * when a customer needs more free credits beyond the onboarding allotment.
 *
 * Body:
 *   {
 *     organizationId:  string,
 *     credits:         number,   // positive integer
 *     reason:          string,   // required — human-readable note
 *     reasonType:      one of ADMIN_GRANT_REASON_TYPES
 *     expiryDays?:     number,   // default 14; 0 = no expiry
 *     allowOverLimit?: boolean,  // escalation override for the 3/24h guard
 *     clientKey?:      string,   // caller-supplied idempotency scope
 *     metadata?:       object,
 *   }
 *
 * Auth: Super-admin token via requireAuthenticatedInternalUser + RBAC check.
 * Idempotency: withIdempotency middleware (Idempotency-Key header) + minute-
 *              bucketed ledger key inside grantAdminCreditExtension.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAdminScope,
} from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { recordAdminAudit } from '../../../../backend/services/adminAuditService';
import {
  grantAdminCreditExtension,
  ADMIN_GRANT_REASON_TYPES,
  type AdminGrantResult,
  type AdminGrantReasonType,
} from '../../../../backend/services/creditAdminGrantService';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { logger } from '../../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:credits_grant', 20, 60))) return;

  const ctx = await requireAdminScope(req, res, 'credits:grant');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/credits/grant', 'credits:grant');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const {
    organizationId,
    credits,
    reason,
    reasonType,
    expiryDays,
    allowOverLimit,
    clientKey,
    metadata,
  } = body as {
    organizationId?: string;
    credits?:        number;
    reason?:         string;
    reasonType?:     string;
    expiryDays?:     number;
    allowOverLimit?: boolean;
    clientKey?:      string;
    metadata?:       Record<string, unknown>;
  };

  if (!organizationId || typeof organizationId !== 'string') {
    return res.status(400).json({ error: 'organizationId (string) required' });
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'reason (non-empty string) required' });
  }
  if (!reasonType || !(ADMIN_GRANT_REASON_TYPES as readonly string[]).includes(reasonType)) {
    return res.status(400).json({
      error: `reasonType must be one of: ${ADMIN_GRANT_REASON_TYPES.join(', ')}`,
      code:  'INVALID_REASON_TYPE',
    });
  }
  if (!Number.isInteger(credits) || (credits as number) <= 0) {
    return res.status(400).json({ error: 'credits must be a positive integer' });
  }
  if (expiryDays !== undefined && (!Number.isFinite(expiryDays) || expiryDays < 0)) {
    return res.status(400).json({ error: 'expiryDays must be a non-negative number' });
  }

  let result: AdminGrantResult;
  try {
    result = await grantAdminCreditExtension({
      organizationId,
      credits:     credits as number,
      reason:      reason.trim(),
      reasonType:  reasonType as AdminGrantReasonType,
      actorUserId: ctx.id,
      expiryDays,
      allowOverLimit,
      clientKey,
      metadata,
    });
  } catch (err: any) {
    logger.error('admin_credit_grant_failed', { actor: ctx.id, message: err?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (!result.ok) {
    const failure = result as Extract<AdminGrantResult, { ok: false }>;
    const statusCode =
      failure.code === 'LEDGER_FAILED'         ? 500 :
      failure.code === 'GRANT_LIMIT_EXCEEDED'  ? 429 :
                                                 400;
    return res.status(statusCode).json({ error: failure.error, code: failure.code });
  }

  try {
    await recordAdminAudit({
      actorUserId:    ctx.id,
      action:         'ADMIN_CREDITS_EXTEND_FREE',
      targetType:     'organization',
      targetId:       organizationId,
      metadata:       {
        credits,
        reason,
        reasonType,
        expiresAt: result.expiresAt,
        ...(metadata ?? {}),
      },
      idempotencyKey: result.idempotencyKey,
    });
  } catch (err: any) {
    logger.error('admin_credit_grant_audit_failed', { actor: ctx.id, message: err?.message });
  }
  return res.status(200).json({
    ok:             true,
    credits:        result.credits,
    expiresAt:      result.expiresAt,
    idempotencyKey: result.idempotencyKey,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(withIdempotency(handler, { scope: 'admin-credits-grant', methods: ['POST'] }));
