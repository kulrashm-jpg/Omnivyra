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
import { getProviderCredentials } from '@/backend/services/payments/orchestrator';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const organizationId = String(body.org_id ?? body.organization_id ?? '').trim();
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
  if (pkgErr) return res.status(400).json({ error: `package_lookup_failed:${pkgErr.message}` });
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
      provider_mode: 'test',
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
    await supabase.from('credit_purchases').update({ status: 'failed' }).eq('id', purchaseId);
    return res.status(502).json({ ok: false, error: 'order_creation_failed', attempts: outcome.attempts });
  }

  await supabase.from('credit_purchases')
    .update({ provider: outcome.provider, provider_order_id: outcome.order.providerOrderId })
    .eq('id', purchaseId);

  const keyId = outcome.provider === 'razorpay' ? getProviderCredentials('razorpay').keyId ?? null : null;

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
    attempts: outcome.attempts,
  });
}

export default withOrgAccess(handler);
