import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_PURCHASE } from '@/shared/contracts/security';
import { verifyAndFulfillRazorpayStagingPayment } from '@/backend/services/payments/razorpayStagingService';
import { getMonetizationControlMode } from '@/backend/services/monetizationOpsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const orderId = String(body?.razorpay_order_id ?? body?.order_id ?? '').trim();
  const paymentId = String(body?.razorpay_payment_id ?? body?.payment_id ?? '').trim();
  const signature = String(body?.razorpay_signature ?? body?.signature ?? '').trim();
  const organizationId = typeof body?.organization_id === 'string' ? body.organization_id : null;
  if (!orderId) return res.status(400).json({ error: 'razorpay_order_id is required' });
  if (!paymentId) return res.status(400).json({ error: 'razorpay_payment_id is required' });
  if (!signature) return res.status(400).json({ error: 'razorpay_signature is required' });

  const guard = await requireCapability(req, res, {
    capability: BILLING_PURCHASE,
    reason: 'verify staging Razorpay payment',
    resourceId: orderId,
    organizationId,
  });
  if (guard.ok !== true) return;

  const outcome = await verifyAndFulfillRazorpayStagingPayment({
    orderId,
    paymentId,
    signature,
    expectedOrganizationId: organizationId,
    requestedBy: guard.principal.userId,
  });

  const exposure = getMonetizationControlMode().externalBetaEnabled ? 'external_beta' : 'internal_staging_only';
  if (outcome.status === 'processed') return res.status(200).json({ ok: true, mode: 'test', exposure, ...outcome });
  return res.status(400).json({ ok: false, mode: 'test', exposure, ...outcome });
}
