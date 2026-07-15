import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/billing/context
 *
 *   GET — backend-authoritative organization billing context (geography).
 *         Resolves country/currency/region via resolveOrgBillingContext
 *         (precedence: billing_context → company_billing_profiles → none).
 *         Read behavior is UNCHANGED — backward compatible.
 *
 *   PUT — lightweight billing-geography capture. CONSOLIDATED: this now
 *         delegates to the SAME canonical service as PUT /api/billing/profile
 *         (billingProfileCaptureService → company_billing_profiles). It NO
 *         LONGER writes the separate billing_context table — there is exactly
 *         ONE write authority and ONE target table, so no divergent
 *         country/currency persistence and no resolver ambiguity.
 *
 *         The endpoint is kept for backward compatibility (existing callers of
 *         PUT /api/billing/context keep working) but its persistence converges
 *         on the canonical path.
 *
 * PRICING-BLIND. No checkout. Auth: resolvePrincipal; activeOrgId only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import { resolveOrgBillingContext } from '../../../backend/services/billing/payments/orgBillingContextResolver';
import {
  normalizeBillingGeographyInput,
  captureBillingProfileGeography,
} from '../../../backend/services/billing/payments/billingProfileCaptureService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
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

  // ── GET — resolved geography (read path UNCHANGED) ────────────────────────
  if (req.method === 'GET') {
    const ctx = await resolveOrgBillingContext(organizationId);
    return res.status(200).json({
      organization_id: organizationId,
      country: ctx.country,
      currency: ctx.currency,
      region: ctx.region,
      source: ctx.source, // 'billing_context' | 'company_billing_profile' | 'none'
      geography_known: ctx.country !== null,
    });
  }

  // ── PUT — consolidated capture → canonical company_billing_profiles ───────
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const normalized = normalizeBillingGeographyInput(body);
  if (!normalized.ok) {
    const fail = normalized as { ok: false; error: string; detail: string };
    return res.status(400).json({ error: fail.error, detail: fail.detail });
  }

  const result = await captureBillingProfileGeography({
    organizationId,
    sessionEmail: typeof auth.principal.email === 'string' ? auth.principal.email : null,
    geography: normalized.value,
  });

  if (!result.ok) {
    const fail = result as { ok: false; code: string; message?: string };
    const status = (fail.code === 'billing_email_unavailable'
      || fail.code === 'company_billing_profiles_unavailable') ? 409 : 500;
    return res.status(status).json({ error: fail.code, message: fail.message });
  }

  const ctx = result.context;
  return res.status(200).json({
    captured: true,
    organization_id: organizationId,
    country: ctx.country,
    currency: ctx.currency,
    region: ctx.region,
    source: ctx.source,
    geography_known: ctx.country !== null,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/billing/context' });
