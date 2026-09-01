import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PUT /api/billing/profile — CANONICAL lightweight billing-geography capture.
 *
 * This is the canonical write endpoint. Persistence is delegated to
 * billingProfileCaptureService → company_billing_profiles (the single
 * geography-authority table). PUT /api/billing/context delegates to the SAME
 * service, so there is no divergent write path.
 *
 * Captures ONLY geography (country / preferred currency / optional region).
 * Partial, additive, idempotent. Does NOT require full onboarding. NO pricing,
 * NO checkout, NO tax engine. Auth: resolvePrincipal; activeOrgId only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import {
  normalizeBillingGeographyInput,
  captureBillingProfileGeography,
} from '../../../backend/services/billing/payments/billingProfileCaptureService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
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

  /*
   * BILLING-ACTIVE-ORG-AUTHZ-SEC-001 — activeOrgId is a CONTEXT POINTER, not a
   * credential.
   *
   * It is `users.active_company_id` read verbatim: no membership join, no
   * company-status check. AuthenticatedPrincipal documents it as exactly that,
   * and TenantGuard says so in terms — "There is no 'active_company_id'
   * inference." In production 24 of 33 pointers name a company where the user's
   * membership is `inactive`, and 21 of those users can still authenticate, so
   * this was reachable rather than theoretical.
   *
   * requireTenantAccess is the canonical guard and covers BOTH halves the
   * pointer misses: membership must be currently active (STALE_MEMBERSHIP) and
   * the company itself must exist and be active (ORG_NOT_FOUND / ORG_INACTIVE).
   * It reuses the already-resolved principal, so this costs no second identity
   * round-trip, and it must stay AHEAD of captureBillingProfileGeography: that
   * service applies no tenant check of its own, and on a first capture it
   * stamps the CALLER's session email as the organization's billing_email.
   */
  const tenant = await requireTenantAccess(req, res, organizationId);
  if (!tenant) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const normalized = normalizeBillingGeographyInput(body);
  if (!normalized.ok) {
    const fail = normalized as { ok: false; error: string; detail: string };
    return res.status(400).json({ error: fail.error, detail: fail.detail });
  }

  const result = await captureBillingProfileGeography({
    // The AUTHORIZED organization, not the pointer it came from.
    organizationId: tenant.organizationId,
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
export default __createApiRoute(handler, { route: '/api/billing/profile' });
