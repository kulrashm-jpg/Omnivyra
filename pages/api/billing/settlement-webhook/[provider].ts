import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/billing/settlement-webhook/[provider] — HIDDEN sandbox settlement
 * webhook ingestion (razorpay | stripe | cashfree | phonepe).
 *
 * SANDBOX/TEST MODE ONLY. This is a settlement-lifecycle FOUNDATION:
 *   - validates provider identity + sandbox (non-live) mode
 *   - runs the signature-validation foundation over the raw body
 *   - delegates to paymentSettlementOrchestrator for normalization, append-only
 *     idempotency recording, and a forward-only state transition
 *
 * It performs NO downstream action — no wallet funding, no credit issuance, no
 * subscription entitlement activation, no invoice generation, no ledger write.
 *
 * PRICING-BLIND: the response carries ONLY normalized lifecycle metadata
 * (status / settlement_state / replayed) — never an amount or plan price.
 *
 * Response contract:
 *   200 — reconciled | duplicate | no_transition | unmatched (no retry)
 *   400 — invalid signature / malformed payload / unknown provider (no retry)
 *   500 — transient failure (provider may retry)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getProviderAdapter, type SupportedProvider } from '../../../../backend/services/billing/payments/paymentProviderAdapter';
import { reconcileSettlementWebhook } from '../../../../backend/services/billing/payments/paymentSettlementOrchestrator';
import { verifyProviderWebhookSignature } from '../../../../backend/services/billing/payments/paymentWebhookVerifier';
import { incrementSettlementMetric } from '../../../../backend/services/billing/payments/settlementMetrics';

// Raw body required for the signature-validation foundation.
export const config = { api: { bodyParser: false } };

const KNOWN_PROVIDERS: SupportedProvider[] = ['razorpay', 'stripe', 'cashfree', 'phonepe'];

function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer | string) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // ── provider identity validation ──────────────────────────────────────────
  const provider = String(req.query.provider ?? '') as SupportedProvider;
  if (!KNOWN_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'unknown_provider' });
  }
  const adapter = getProviderAdapter(provider);
  if (!adapter) {
    return res.status(400).json({ error: 'provider_not_registered', provider });
  }
  // SANDBOX-ONLY enforcement via strict allowlist: this endpoint accepts ONLY
  // adapters that explicitly declare `mode: 'test'`. A live-mode adapter is
  // rejected outright (live settlement activation is a deliberate future
  // step), and 'unknown'-mode adapters (e.g. the Stripe stub at
  // paymentProviderAdapter.ts:136) are also rejected so an operator who
  // provisions a sandbox secret for a stub adapter cannot drive settlement
  // state through this endpoint.
  const mode = adapter.describe().mode;
  if (mode !== 'test') {
    return res.status(400).json({
      error: mode === 'live' ? 'live_settlement_not_activated' : 'settlement_not_activated',
      provider,
      mode,
    });
  }

  // ── raw body + provider-specific sandbox signature verification ──────────
  let rawBody: string;
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'invalid_body' });
  }
  // Per-provider sandbox verification (Razorpay HMAC / Stripe t+v1 / Cashfree /
  // PhonePe X-VERIFY) including replay-window validation. The raw header map is
  // passed verbatim — the verifier selects the headers each scheme needs.
  const sig = verifyProviderWebhookSignature({ provider, rawBody, headers: req.headers });
  if (!sig.ok) {
    // Persistent internal lifecycle metrics — a stale timestamp and a signature
    // failure are counted distinctly (no double-count, no pricing). Best-effort.
    if (sig.reason === 'stale_timestamp') {
      await incrementSettlementMetric('stale_webhook_rejections', 1, { source: 'settlement_webhook' });
      return res.status(400).json({ error: 'stale_webhook', reason: sig.reason });
    }
    await incrementSettlementMetric('signature_verification_failures', 1, { source: 'settlement_webhook' });
    return res.status(400).json({ error: 'invalid_signature', reason: sig.reason });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // ── canonical settlement reconciliation ──────────────────────────────────
  try {
    const result = await reconcileSettlementWebhook({ provider, payload });
    if (!result.ok) {
      const fail = result as { ok: false; status: string; reason: string };
      return res.status(400).json({ error: fail.status, reason: fail.reason });
    }
    // Normalized lifecycle metadata ONLY — no pricing.
    return res.status(200).json({
      status: result.status,
      settlement_state: result.settlement_state,
      replayed: result.replayed,
      signature_mode: sig.mode,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'settlement_processing_failed',
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/billing/settlement-webhook/:provider' });
