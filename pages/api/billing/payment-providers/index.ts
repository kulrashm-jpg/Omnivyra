import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/billing/payment-providers
 *
 * Backend-authoritative checkout-provider discovery. The (hidden) billing
 * shell calls this to learn which payment providers are available/visible —
 * the frontend NEVER hardcodes providers or decides availability.
 *
 * Query params (all optional):
 *   country  — ISO-3166-1 alpha-2; filters geography-restricted providers
 *   currency — ISO-4217; filters currency-restricted providers
 *
 * Returns the resolved provider lists + supported methods + a recommendation
 * placeholder. PRICING-BLIND by construction — the resolver carries no price
 * data and this handler adds none. Disabled and maintenance-mode providers
 * are excluded by the resolver.
 *
 * Auth: any authenticated session (resolvePrincipal). The provider LIST is not
 * org-sensitive — resolveAvailableProviders takes no organization. But the
 * geography used to tailor it IS read from the caller's organization, so that
 * organization is authorized first (BILLING-ACTIVE-ORG-AUTHZ-SEC-001); when it
 * cannot be, the route falls back to the conservative geography-unknown filter
 * rather than failing. An unauthenticated caller gets 401.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { assertTenantAccess } from '../../../../backend/security/TenantGuard';
import { resolveAvailableProviders } from '../../../../backend/services/billing/payments/paymentProviderPolicyResolver';
import { resolveOrgBillingContext } from '../../../../backend/services/billing/payments/orgBillingContextResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = await resolvePrincipal(req);
  if (auth.ok !== true) {
    return res.status(401).json({ error: 'not_authenticated' });
  }

  // Explicit query params act as an override. When absent, the endpoint
  // resolves the org's billing context server-side — backend-authoritative.
  const qpCountry = typeof req.query.country === 'string' ? req.query.country : null;
  const qpCurrency = typeof req.query.currency === 'string' ? req.query.currency : null;

  let country = qpCountry;
  let currency = qpCurrency;
  let geographyKnown: boolean | undefined;

  if (!qpCountry && !qpCurrency) {
    /*
     * BILLING-ACTIVE-ORG-AUTHZ-SEC-001 — this route is treated differently from
     * its three siblings, deliberately.
     *
     * The provider list itself is NOT org-scoped: resolveAvailableProviders
     * takes no organization and reads global governance config. The only
     * tenant-sensitive act here is reading THIS organization's billing_context
     * and company_billing_profiles to tailor the geography — and activeOrgId
     * cannot authorize that, for the reasons set out in billing/profile.ts.
     *
     * So the org is authorized before it is used, but a failure is NOT an error
     * response: it degrades to exactly the state this route already handles when
     * a caller has no active organization at all — geography unknown, and the
     * resolver's conservative filter excludes geography-restricted providers.
     * assertTenantAccess is used rather than requireTenantAccess precisely
     * because it returns a verdict instead of writing one, which is what makes
     * that fallback expressible. Denying outright would be a behaviour
     * regression on a resource that is not the caller's tenant data.
     */
    const orgAccess = await assertTenantAccess({
      userId: auth.principal.userId,
      supabaseUid: auth.principal.supabaseUid,
      organizationId: auth.principal.activeOrgId,
    });
    const authorizedOrgId = orgAccess.ok === true ? orgAccess.access.organizationId : null;
    const orgCtx = await resolveOrgBillingContext(authorizedOrgId);
    country = orgCtx.country;
    currency = orgCtx.currency;
    geographyKnown = orgCtx.country !== null;
  }

  const resolved = await resolveAvailableProviders({ country, currency, geographyKnown });

  // Pricing-blind response: ONLY governance + rendering metadata. No amounts,
  // no plan prices, no totals — the resolver types carry none and we add none.
  return res.status(200).json({
    source: resolved.source, // 'db' | 'compiled_default'
    available: resolved.available.map((p) => ({
      provider: p.provider,
      visible_in_checkout: p.visible_in_checkout,
      subscriptions_enabled: p.subscriptions_enabled,
      topups_enabled: p.topups_enabled,
      supported_payment_methods: p.supported_payment_methods,
      supported_countries: p.supported_countries,
      supported_currencies: p.supported_currencies,
      sandbox_mode: p.sandbox_mode,
      priority: p.priority,
    })),
    visible: resolved.visible.map((p) => ({
      provider: p.provider,
      subscriptions_enabled: p.subscriptions_enabled,
      topups_enabled: p.topups_enabled,
      supported_payment_methods: p.supported_payment_methods,
      sandbox_mode: p.sandbox_mode,
      priority: p.priority,
    })),
    supported_methods: resolved.supported_methods,
    recommended: resolved.recommended, // always null — routing not implemented
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/billing/payment-providers' });
