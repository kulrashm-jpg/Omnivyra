import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * Super-Admin pricing management.
 *   GET  → { fx, planPricing }   (current config)
 *   POST → { action: 'fx'|'override'|'plan', ... }  (update)
 *
 * Capability-gated (BILLING_PLAN_MANAGE). Writes config only — no charging.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { requireAdminRateLimit } from '@/backend/services/requestAccessService';
import { BILLING_PLAN_MANAGE } from '@/shared/contracts/security';
import {
  getFxConfig, getPlanPricing, setFxRate, setPriceOverride, setPlanPricing,
} from '@/backend/services/pricingConfigService';
import type { Currency } from '@/lib/billing/currency';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Closure-014 (D): per-route write rate limit (before authorization and any business work).
  if (req.method !== 'GET' && !(await requireAdminRateLimit(req, res, 'rl:super-admin:pricing', 20, 60, { sensitive: true }))) return;

  const guard = await requireCapability(req, res, {
    capability: BILLING_PLAN_MANAGE,
    reason: 'manage pricing configuration',
  });
  if (guard.ok !== true) return;

  if (req.method === 'GET') {
    const [fx, planPricing] = await Promise.all([getFxConfig(), getPlanPricing()]);
    return res.status(200).json({ fx, planPricing });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
    const by = guard.principal.userId;
    try {
      // Item 8 (financial-writes contract; e9): the setters return the database result - supabase-js does NOT throw
      // on a failed write. A pricing change that did not happen must never be reported as saved: this screen is
      // where the owner enters live prices.
      let written: { error?: { message?: string } | null } | null | undefined;
      if (body.action === 'fx') {
        written = await setFxRate(String(body.currency) as Currency, Number(body.rate), by);
      } else if (body.action === 'override') {
        written = await setPriceOverride(String(body.sku), String(body.currency) as Currency, body.amount == null ? null : Number(body.amount), by);
      } else if (body.action === 'plan') {
        written = await setPlanPricing(String(body.plan_key), Number(body.founder_usd), body.regular_usd == null ? null : Number(body.regular_usd), body.active !== false, by);
      } else {
        return res.status(400).json({ error: 'unknown action' });
      }
      if (written?.error) {
        return res.status(500).json({ ok: false, error: 'pricing_write_failed', detail: written.error.message ?? null });
      }
      const [fx, planPricing] = await Promise.all([getFxConfig(), getPlanPricing()]);
      return res.status(200).json({ ok: true, fx, planPricing });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err?.message ?? 'update_failed' });
    }
  }

  return res.status(405).end();
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/pricing' });
