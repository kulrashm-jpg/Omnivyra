/**
 * Super-Admin pricing management.
 *   GET  → { fx, planPricing }   (current config)
 *   POST → { action: 'fx'|'override'|'plan', ... }  (update)
 *
 * Capability-gated (BILLING_PURCHASE). Writes config only — no charging.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_PURCHASE } from '@/shared/contracts/security';
import {
  getFxConfig, getPlanPricing, setFxRate, setPriceOverride, setPlanPricing,
} from '@/backend/services/pricingConfigService';
import type { Currency } from '@/lib/billing/currency';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const guard = await requireCapability(req, res, {
    capability: BILLING_PURCHASE,
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
      if (body.action === 'fx') {
        await setFxRate(String(body.currency) as Currency, Number(body.rate), by);
      } else if (body.action === 'override') {
        await setPriceOverride(String(body.sku), String(body.currency) as Currency, body.amount == null ? null : Number(body.amount), by);
      } else if (body.action === 'plan') {
        await setPlanPricing(String(body.plan_key), Number(body.founder_usd), body.regular_usd == null ? null : Number(body.regular_usd), body.active !== false, by);
      } else {
        return res.status(400).json({ error: 'unknown action' });
      }
      const [fx, planPricing] = await Promise.all([getFxConfig(), getPlanPricing()]);
      return res.status(200).json({ ok: true, fx, planPricing });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err?.message ?? 'update_failed' });
    }
  }

  return res.status(405).end();
}
