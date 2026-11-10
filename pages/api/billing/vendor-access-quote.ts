import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { quoteCentralVendorAccess, STANDARD_CREDIT_RATE_USD } from '@/backend/services/enrichment/centralVendorAccess';
import { authRequestIp } from '../../../backend/auth/requestClientIp';
import { checkRateLimit } from '../../../lib/auth/rateLimit';

/**
 * GET /api/billing/vendor-access-quote. PUBLIC, read-only, like /api/billing/fx.
 *
 * The public pricing page's one mode-B line: "Centralized Apollo access:
 * N Omnivyra credits = 1 Apollo credit". N is computed by the SAME pricing
 * function that charges (vendor cost x 1.5), at the platform's STANDARD credit
 * rate because a public visitor has no organisation. A vendor whose cost is
 * not set in Super Admin is reported unavailable. No tenant data.
 *
 * RATE LIMITED PER IP (GOV-SECURITY review, 2026-11-11): the pricing reads
 * behind it (llm_model_pricing, action_pricing_config) query Postgres on every
 * call - there is no in-process cache - and Cache-Control only helps when a
 * CDN or browser honours it. The limit is checked BEFORE any read, so a
 * scripted client cannot turn anonymous requests into database load.
 */
export const VENDOR_QUOTE_LIMIT = { keyPrefix: 'rl:billing:vendor-access-quote', limit: 30, windowSecs: 60 };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const rl = await checkRateLimit(authRequestIp(req), VENDOR_QUOTE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Try again later.' });
  try {
    const vendors = await quoteCentralVendorAccess(null);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ standardCreditRateUsd: STANDARD_CREDIT_RATE_USD, vendors });
  } catch {
    return res.status(500).json({ error: 'vendor_access_quote_failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/billing/vendor-access-quote' });
