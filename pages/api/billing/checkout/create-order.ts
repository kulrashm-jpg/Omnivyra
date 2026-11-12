import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/billing/checkout/create-order   { org_id, package_id }
 *
 * Checkout Phase 1 — top-up order creation via the Payment Orchestrator.
 * Creates a PENDING purchase record and a provider order (Razorpay primary →
 * Cashfree fallback, internal routing). INR only. Test/sandbox.
 *
 * Does NOT allocate credits and does NOT touch the wallet. Records only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../../backend/middleware/withOrgAccess';
import { logger } from '../../../../backend/services/logger';
import { supabase } from '@/backend/db/supabaseClient';
import { resolvePrincipal } from '@/backend/security/IdentityResolver';
import { getFxConfig } from '@/backend/services/pricingConfigService';
import { resolvePrice, CURRENCIES, type Currency } from '@/lib/billing/currency';
import { createOrder as orchestratorCreateOrder } from '@/backend/services/payments/orchestrator';
import { getProviderCredentials, getActiveMode } from '@/backend/services/payments/orchestrator';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  // BILLING-CHECKOUT-SEC-001: bind to the org withOrgAccess AUTHORIZED, not to
  // one re-derived from the body. The wrapper's resolver reads query first, so
  // `?org_id=<own>` with `{"org_id":"<victim>"}` authorized one organization and
  // charged, recorded and ordered against another.
  const organizationId = String((req as any).orgAccess?.orgId ?? '').trim();
  const packageId = String(body.package_id ?? '').trim();
  if (!organizationId) return res.status(400).json({ error: 'org_id is required' });
  if (!packageId) return res.status(400).json({ error: 'package_id is required' });

  let userId: string | null = null;
  try { userId = (await resolvePrincipal(req) as any)?.principal?.userId ?? null; } catch { /* metadata only */ }

  // Resolve the package + INR charge (canonical USD → FX → INR; Phase C).
  const { data: pkg, error: pkgErr } = await supabase
    .from('credit_packages')
    .select('id, credits, price, sku, canonical_usd_price, is_active')
    .eq('id', packageId)
    .maybeSingle();
  // A failed lookup is a server fault, not a bad request: 503, and the database
  // message is logged, never returned to the client.
  if (pkgErr) {
    logger.error('checkout_package_lookup_failed', { organizationId, packageId, message: pkgErr.message });
    return res.status(503).json({ error: 'package_lookup_unavailable', retryable: true });
  }
  if (!pkg || (pkg as any).is_active !== true) return res.status(400).json({ error: 'package_not_available' });

  const credits = Number((pkg as any).credits);
  // Customer-selected charge currency (USD / EUR / INR); defaults to INR.
  const requested = String(body.currency ?? 'INR').toUpperCase();
  const currency: Currency = (CURRENCIES as readonly string[]).includes(requested)
    ? (requested as Currency)
    : 'INR';
  const canonicalUsd = (pkg as any).canonical_usd_price;
  let amount = Number((pkg as any).price); // INR fallback (DB authoritative)
  if (canonicalUsd != null && Number.isFinite(Number(canonicalUsd))) {
    const fx = await getFxConfig();
    amount = resolvePrice(Number(canonicalUsd), currency, fx, (pkg as any).sku ?? undefined);
  } else if (currency !== 'INR') {
    // No canonical USD to convert from → can't price this pack in a non-INR currency.
    return res.status(400).json({ error: 'currency_not_available_for_package' });
  }
  if (!Number.isFinite(credits) || credits <= 0 || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'package_invalid' });
  }

  // M2: the purchase row must record the mode the order is ACTUALLY created in.
  // `getActiveMode()` is the same authority the adapters use to pick credentials
  // and API base URLs, so the row and the provider request cannot disagree.
  // A hardcoded literal here would stamp real live charges as test data.
  const providerMode = getActiveMode();

  // Purchase record — PENDING. No allocation, no wallet change.
  const { data: purchase, error: insErr } = await supabase
    .from('credit_purchases')
    .insert({
      organization_id: organizationId,
      package_id: packageId,
      credits,
      amount_paid: amount,
      currency,
      status: 'pending',
      provider_mode: providerMode,
      fulfillment_status: 'pending',
      provider_payload: { checkout_flow: 'orchestrator_phase1', created_by: userId },
    })
    .select('id')
    .single();
  if (insErr || !purchase) {
    logger.error('checkout_purchase_insert_failed', { organizationId, message: insErr?.message });
    return res.status(500).json({ error: 'purchase_record_failed' });
  }
  const purchaseId = (purchase as any).id as string;

  // Provider order via orchestrator (internal routing + fallback).
  const outcome = await orchestratorCreateOrder({
    currency, amount, reference_id: purchaseId, organization_id: organizationId,
  });

  if (!outcome.order || !outcome.provider) {
    // best-effort: no provider order exists, so nothing can be paid against this
    // row; if the flip fails it stays 'pending' with no provider_order_id and
    // the expiry sweep closes it. The failure is logged, not swallowed.
    const { error: failErr } = await supabase.from('credit_purchases').update({ status: 'failed' }).eq('id', purchaseId);
    if (failErr) logger.error('checkout_purchase_fail_mark_failed', { organizationId, purchaseId, message: failErr.message });
    logger.warn('payment_order_creation_failed', {
      organizationId, purchaseId, providerMode,
      attempts: outcome.attempts.map((a) => ({ provider: a.provider, ok: a.ok })),
    });
    return res.status(502).json({ ok: false, error: 'order_creation_failed', attempts: outcome.attempts });
  }

  // MONEY: the provider order id is how a payment is matched back to this
  // purchase (verify, webhook, provider-authoritative closure). If it is not
  // recorded, a customer could pay an order nothing can fulfil - so refuse to
  // hand the order to the browser (no key_id, no client token) and close the
  // row instead. Exactly one row must move; 0 rows is also a failure.
  const { data: recorded, error: recErr } = await supabase.from('credit_purchases')
    .update({ provider: outcome.provider, provider_order_id: outcome.order.providerOrderId })
    .eq('id', purchaseId)
    .select('id');
  if (recErr || !Array.isArray(recorded) || recorded.length !== 1) {
    logger.error('checkout_provider_order_record_failed', {
      organizationId, purchaseId, provider: outcome.provider,
      providerOrderId: outcome.order.providerOrderId,
      message: recErr?.message ?? `rows=${Array.isArray(recorded) ? recorded.length : 'none'}`,
    });
    // best-effort: the order was never handed out, so it cannot be paid; the
    // pending row is also closed by the expiry sweep if this flip fails.
    const { error: closeErr } = await supabase.from('credit_purchases').update({ status: 'failed' }).eq('id', purchaseId);
    if (closeErr) logger.error('checkout_purchase_fail_mark_failed', { organizationId, purchaseId, message: closeErr.message });
    return res.status(503).json({ ok: false, error: 'order_record_failed', retryable: true });
  }

  const keyId = outcome.provider === 'razorpay' ? getProviderCredentials('razorpay').keyId ?? null : null;

  logger.info('payment_order_created', {
    organizationId, purchaseId, provider: outcome.provider, providerMode, currency,
    providerOrderId: outcome.order.providerOrderId,
  });

  return res.status(201).json({
    ok: true,
    purchase_id: purchaseId,
    provider: outcome.provider,
    provider_order_id: outcome.order.providerOrderId,
    amount,
    amount_subunits: outcome.order.amountSubunits,
    currency,
    key_id: keyId,
    client_token: outcome.order.clientToken ?? null,
    // M3: the browser must NOT infer sandbox vs production from its own
    // environment. The server states the mode and provider SDKs are configured
    // from this value alone.
    provider_mode: providerMode,
    attempts: outcome.attempts,
  });
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/billing/checkout/create-order' });
