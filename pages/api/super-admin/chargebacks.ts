/**
 * POST /api/super-admin/chargebacks
 *
 * Super-admin-only endpoint to reverse a completed credit purchase. Used when
 * the payment processor reports a chargeback or when a refund is approved.
 *
 * Effect: debits the org's paid balance, writes a compensating ledger row
 * (tx_type='deduction', paid_delta=-credits), and marks the purchase as
 * 'refunded'.
 *
 * Body:
 *   {
 *     purchaseId: string,   // credit_purchases.id
 *     reason?:    string,   // human-readable note
 *   }
 *
 * Auth:        super-admin via requireAdminScope('credits:grant')
 * Idempotency: withIdempotency middleware enforces Idempotency-Key header,
 *              which is forwarded to refundPurchase for ledger-level dedup.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAdminScope,
} from '../../../backend/services/requestAccessService';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import { refundPurchase, type RefundResult } from '../../../backend/services/purchaseService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { logger } from '../../../backend/services/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:super_admin:chargebacks', 20, 60))) return;

  const ctx = await requireAdminScope(req, res, 'credits:grant');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/chargebacks', 'credits:grant');
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { purchaseId, reason } = body as { purchaseId?: string; reason?: string };

  if (!purchaseId || typeof purchaseId !== 'string') {
    return res.status(400).json({ error: 'purchaseId (string) required' });
  }

  const idempotencyKey = String(req.headers['idempotency-key'] ?? '');
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header required' });
  }

  try {
    const result = await refundPurchase({
      purchaseId,
      performedBy:    ctx.id,
      idempotencyKey,
      reason:         reason?.trim() || undefined,
    });

    if (!result.success) {
      const failure = result as Extract<RefundResult, { success: false }>;
      const statusCode =
        failure.reason === 'not_found'                  ? 404 :
        failure.reason === 'not_completed'              ? 409 :
        failure.reason === 'insufficient_paid_balance'  ? 409 :
        failure.reason === 'ledger_failed'              ? 500 :
                                                          400;
      return res.status(statusCode).json({
        error:            failure.reason,
        detail:           failure.detail,
        availableCredits: failure.availableCredits,
      });
    }

    try {
      await recordAdminAudit({
        actorUserId:    ctx.id,
        action:         'ADMIN_PURCHASE_REFUND',
        targetType:     'credit_purchase',
        targetId:       purchaseId,
        metadata: {
          creditsRefunded: result.creditsRefunded,
          reason:          reason ?? null,
          alreadyRefunded: result.alreadyRefunded ?? false,
        },
        idempotencyKey,
      });
    } catch (auditErr: any) {
      logger.error('admin_chargeback_audit_failed', { actor: ctx.id, message: auditErr?.message });
    }

    return res.status(200).json({
      ok:              true,
      purchaseId:      result.purchaseId,
      creditsRefunded: result.creditsRefunded,
      alreadyRefunded: result.alreadyRefunded ?? false,
    });
  } catch (err: any) {
    logger.error('admin_chargeback_failed', { actor: ctx.id, message: err?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withIdempotency(handler, { scope: 'super-admin-chargebacks', methods: ['POST'] });
