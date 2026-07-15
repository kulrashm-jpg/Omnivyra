import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/webhooks/payments/:provider   (razorpay | cashfree)
 *
 * Checkout Phase 1 — provider webhooks via the Payment Orchestrator.
 * Verifies signature + records the event ONLY (payment success / failure /
 * provider reference / amount / currency / organization land in the recorded
 * payload). NO credit allocation, NO wallet change, NO billing action.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { handleWebhook } from '@/backend/services/payments/orchestrator';
import type { PaymentProviderId } from '@/backend/services/payments/orchestrator';
import { logger } from '@/backend/services/logger';
import { supabase } from '@/backend/db/supabaseClient';
import { completePurchase } from '@/backend/services/purchaseService';
import { generateTopupInvoice } from '@/backend/services/billing/topupInvoiceService';

function safeParse(s: string): any {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

/** Extract (order_id, payment_id) from a SUCCESS webhook, else null. */
function extractSuccess(provider: PaymentProviderId, evt: any): { orderId: string; paymentId: string } | null {
  if (provider === 'razorpay') {
    if (evt?.event !== 'payment.captured') return null;
    const e = evt?.payload?.payment?.entity ?? {};
    return e.order_id ? { orderId: String(e.order_id), paymentId: String(e.id ?? '') } : null;
  }
  // cashfree
  if (!String(evt?.type ?? '').toUpperCase().includes('SUCCESS')) return null;
  const orderId = evt?.data?.order?.order_id;
  return orderId ? { orderId: String(orderId), paymentId: String(evt?.data?.payment?.cf_payment_id ?? '') } : null;
}

// Raw body required for signature verification.
export const config = { api: { bodyParser: false } };

function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const provider = String(req.query.provider ?? '').trim() as PaymentProviderId;
  if (provider !== 'razorpay' && provider !== 'cashfree') return res.status(404).json({ error: 'unknown_provider' });

  try {
    const raw = await readRawBody(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v ?? '');

    const result = await handleWebhook(provider, raw, headers);
    if (!result.verified) return res.status(401).json({ ok: false, error: 'signature_invalid' });

    // On a verified SUCCESS event → allocate via the idempotent fulfillment
    // (top-up paid pool). Duplicate webhooks / verify races resolve to one grant.
    let allocated = false;
    const success = extractSuccess(provider, safeParse(raw));
    if (success) {
      const { data: purchase } = await supabase
        .from('credit_purchases')
        .select('id')
        .eq('provider_order_id', success.orderId)
        .maybeSingle();
      if (purchase) {
        const fulfillment = await completePurchase((purchase as any).id, success.paymentId || undefined);
        allocated = fulfillment.success;
        if (fulfillment.success) {
          try { await generateTopupInvoice((purchase as any).id); } catch { /* best-effort */ }
        }
      }
    }

    return res.status(200).json({ ok: true, recorded: result.recorded, event_id: result.eventId, event_type: result.eventType, allocated });
  } catch (err: any) {
    logger.error('checkout_webhook_failed', { provider, message: err?.message ?? 'unknown' });
    return res.status(500).json({ ok: false, error: 'webhook_error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/webhooks/payments/:provider' });
