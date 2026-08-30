import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/billing/checkout/close   { org_id, purchase_id, reason }
 *
 * M5 (P1) — let the browser report that a checkout failed or was cancelled so
 * the pending purchase row is closed server-side instead of lingering forever.
 *
 * This endpoint CANNOT grant credits and CANNOT force a failure. It is a
 * *request* to close, not an instruction: `closePurchaseFromClient` asks the
 * provider for the authoritative outcome first, so
 *
 *   client says failed + provider says paid  → the purchase is FULFILLED
 *   client says failed + provider says unpaid → the purchase is closed
 *   client says failed + provider unreachable → nothing changes (retried later)
 *
 * A completed purchase is never downgraded; a second call is a no-op.
 *
 * Auth: withOrgAccess tenant guard, plus an explicit ownership re-check inside
 * the service so an id from another org reports not_found rather than existing.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../../backend/middleware/withOrgAccess';
import { closePurchaseFromClient } from '@/backend/services/billing/purchaseClosureService';

const ALLOWED_REASONS = ['client_reported_failure', 'client_cancelled'] as const;
type AllowedReason = (typeof ALLOWED_REASONS)[number];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  // ORGACCESS-BINDING-SEC-001: bind to the org withOrgAccess AUTHORIZED, not to
  // one re-derived from the body. The wrapper's resolver reads query first, so
  // `?org_id=<own>` with `{"org_id":"<victim>"}` authorized one organization
  // while closePurchaseFromClient scoped its ownership check — and therefore the
  // payment-state mutation — to another. A body identifier may still be sent for
  // compatibility; it can no longer redirect the operation.
  const organizationId = String((req as any).orgAccess?.orgId ?? '').trim();
  const purchaseId = String(body.purchase_id ?? '').trim();
  const rawReason = String(body.reason ?? 'client_reported_failure').trim();

  if (!organizationId || !purchaseId) {
    return res.status(400).json({ error: 'org_id and purchase_id are required' });
  }
  // Reason is an allow-list, never free text: it is persisted and drives the
  // reopen decision later.
  if (!(ALLOWED_REASONS as readonly string[]).includes(rawReason)) {
    return res.status(400).json({ error: 'invalid_reason' });
  }

  // Deliberately ignores any provider/payment id in the body — the client is
  // not a source of provider references. The service reads the stored
  // provider_order_id and asks the provider itself.
  const outcome = await closePurchaseFromClient({
    purchaseId,
    organizationId,
    reason: rawReason as AllowedReason,
  });

  if (outcome.action === 'not_found') {
    return res.status(404).json({ ok: false, error: 'purchase_not_found' });
  }

  return res.status(200).json({
    ok: true,
    purchase_id: outcome.purchaseId,
    action: outcome.action,
    detail: outcome.detail ?? null,
  });
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/billing/checkout/close' });
