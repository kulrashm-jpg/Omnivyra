/**
 * POST /api/billing/checkout-session — HIDDEN checkout-session initiation.
 *
 * The canonical backend entry point for the hidden billing flow to start a
 * provider checkout session. Authenticated-only; backend-authoritative
 * provider governance and geography (no caller geography override accepted).
 *
 * Request body:
 *   provider        — 'razorpay' | 'stripe'
 *   intent_type     — 'subscription' | 'topup'
 *   plan_reference  — required when intent_type='subscription'
 *   topup_reference — required when intent_type='topup'
 *
 * A geography override in the body (country / currency) is REJECTED — the
 * orchestrator derives geography from the canonical org billing context.
 *
 * Hidden-commerce: no public checkout UI, not in navigation, not SEO-exposed.
 * PRICING-BLIND: the response is the normalized session contract — no amount,
 * no plan price, no invoice total. No settlement, no ledger mutation.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import {
  orchestrateCheckoutSession,
  type CheckoutIntentType,
  type OrchestrateCheckoutResult,
} from '../../../backend/services/billing/payments/checkoutSessionOrchestrator';
import type { SupportedProvider } from '../../../backend/services/billing/payments/paymentProviderAdapter';

// Rejection codes that are the caller's fault (4xx) vs a provider fault (502).
const CLIENT_REJECTIONS = new Set([
  'invalid_intent_type', 'invalid_reference', 'unknown_provider',
  'provider_not_governed', 'provider_disabled', 'provider_in_maintenance',
  'provider_geography_unsupported', 'provider_currency_unsupported', 'provider_unavailable',
  // amount-resolution rejections (billingAmountResolver)
  'unknown_reference', 'disabled_reference', 'malformed_reference',
  // provider/currency compatibility
  'provider_currency_incompatible',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = await resolvePrincipal(req);
  if (auth.ok !== true) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  const organizationId = auth.principal.activeOrgId;
  if (!organizationId) {
    return res.status(409).json({ error: 'no_active_organization' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});

  // Geography override is prohibited — geography is backend-authoritative.
  if ('country' in body || 'currency' in body) {
    return res.status(400).json({ error: 'geography_override_prohibited' });
  }

  const provider = String(body.provider ?? '').trim();
  const intentType = String(body.intent_type ?? '').trim() as CheckoutIntentType;
  if (intentType !== 'subscription' && intentType !== 'topup') {
    return res.status(400).json({ error: 'invalid_intent_type', detail: 'subscription | topup' });
  }

  // Exactly the reference matching the intent must be present.
  const planRef  = typeof body.plan_reference  === 'string' ? body.plan_reference.trim()  : '';
  const topupRef = typeof body.topup_reference === 'string' ? body.topup_reference.trim() : '';
  let reference: string;
  if (intentType === 'subscription') {
    if (!planRef)  return res.status(400).json({ error: 'plan_reference_required' });
    if (topupRef)  return res.status(400).json({ error: 'reference_intent_mismatch', detail: 'topup_reference set for subscription intent' });
    reference = planRef;
  } else {
    if (!topupRef) return res.status(400).json({ error: 'topup_reference_required' });
    if (planRef)   return res.status(400).json({ error: 'reference_intent_mismatch', detail: 'plan_reference set for topup intent' });
    reference = topupRef;
  }

  if (!['razorpay', 'stripe', 'cashfree', 'phonepe'].includes(provider)) {
    return res.status(400).json({ error: 'unknown_provider', provider });
  }

  const result: OrchestrateCheckoutResult = await orchestrateCheckoutSession({
    organizationId,
    initiatedByUserId: auth.principal.userId,
    provider: provider as SupportedProvider,
    intentType,
    reference,
  });

  if (!result.ok) {
    const fail = result as { ok: false; code: string; reason: string };
    const status = CLIENT_REJECTIONS.has(fail.code) ? 400 : 502;
    return res.status(status).json({ error: fail.code, reason: fail.reason });
  }

  // Normalized, pricing-blind session contract. `replayed` is true when the
  // session was returned from persistence (idempotent replay) rather than
  // freshly dispatched.
  return res.status(200).json({
    session: result.session,
    idempotency_key: result.idempotency_key,
    replayed: result.replayed,
  });
}
