import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_PURCHASE } from '@/shared/contracts/security';
import { createRazorpayStagingCreditOrder } from '@/backend/services/payments/razorpayStagingService';
import { getMonetizationControlMode } from '@/backend/services/monetizationOpsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const organizationId = String(body?.organization_id ?? '').trim();
  const packageId = String(body?.package_id ?? '').trim();
  if (!organizationId) return res.status(400).json({ error: 'organization_id is required' });
  if (!packageId) return res.status(400).json({ error: 'package_id is required' });

  const guard = await requireCapability(req, res, {
    capability: BILLING_PURCHASE,
    reason: 'create staging Razorpay credit order',
    resourceId: organizationId,
    organizationId,
  });
  if (guard.ok !== true) return;

  try {
    const order = await createRazorpayStagingCreditOrder({
      organizationId,
      packageId,
      requestedBy: guard.principal.userId,
    });
    return res.status(201).json({
      ok: true,
      mode: 'test',
      exposure: getMonetizationControlMode().externalBetaEnabled ? 'external_beta' : 'internal_staging_only',
      purchase_id: order.purchaseId,
      organization_id: order.organizationId,
      package_id: order.packageId,
      credits: order.credits,
      amount: order.amount,
      amount_subunits: order.amountSubunits,
      currency: order.currency,
      razorpay_order_id: order.providerOrderId,
      razorpay_key_id: order.keyId,
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/razorpay/create-staging-order' });
