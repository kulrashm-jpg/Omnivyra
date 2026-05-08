/**
 * POST /api/super-admin/free-credits/revoke
 *
 * Operator-driven reversal of a previously-granted free or incentive
 * credit batch. Drains the wallet via the canonical
 * `apply_credit_reservation` RPC's `expire` / `expire_incentive` phase,
 * capped at the available balance — never pushes the wallet negative.
 *
 * Body: {
 *   organizationId:     string,
 *   creditsAmount:      number,
 *   category:           'free' | 'incentive',
 *   reason:             string,
 *   originalGrantKey?:  string,   // optional — derives idempotency key
 * }
 *
 * Auth: BILLING_GRANT_FREE_CREDITS (platform-tier; same gate as the grant
 * counterpart). Step-up policy is the same as for grants.
 *
 * Paid-credit revocation is NOT supported here; a Stripe refund flow with
 * a dedicated 'refund' phase is required and is tracked as a follow-up.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_GRANT_FREE_CREDITS } from '@/shared/contracts/security';
import { revokeCredit, type RevocableCategory } from '@/backend/services/creditRevoke';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    organizationId,
    creditsAmount,
    category,
    reason,
    originalGrantKey,
  } = body as {
    organizationId: string;
    creditsAmount: number;
    category: RevocableCategory;
    reason: string;
    originalGrantKey?: string;
  };

  if (!organizationId) return res.status(400).json({ error: 'organizationId is required' });
  if (!creditsAmount || creditsAmount <= 0) return res.status(400).json({ error: 'creditsAmount must be positive' });
  if (category !== 'free' && category !== 'incentive') {
    return res.status(400).json({ error: 'category must be "free" or "incentive"' });
  }
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: 'reason is required' });
  }

  const guard = await requireCapability(req, res, {
    capability: BILLING_GRANT_FREE_CREDITS,
    reason: `super-admin revokes ${creditsAmount} ${category} credits from org`,
    resourceId: organizationId,
  });
  if (guard.ok !== true) return;

  const result = await revokeCredit({
    orgId:                       organizationId,
    amount:                      creditsAmount,
    category,
    performedBy:                 guard.principal.userId,
    reason,
    originalGrantIdempotencyKey: originalGrantKey,
  });

  if (result.success !== true) {
    const status =
      result.reason === 'INVALID_AMOUNT'        ? 400 :
      result.reason === 'NO_WALLET'             ? 404 :
      result.reason === 'INSUFFICIENT_BALANCE'  ? 409 :
      500;
    return res.status(status).json({ ok: false, code: result.reason, detail: result.detail });
  }

  return res.status(200).json({
    ok:             true,
    revoked:        result.revoked,
    requested:      result.requested,
    idempotencyKey: result.idempotencyKey,
    transactionId:  result.transactionId,
  });
}
