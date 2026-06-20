/**
 * GET /api/billing/fx — public read of the live FX config (rates + market
 * overrides) for multi-currency DISPLAY. Read-only; falls back to defaults
 * pre-migration. Charge currency is INR regardless of display.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getFxConfig } from '@/backend/services/pricingConfigService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const fx = await getFxConfig();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(fx);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'fx_failed' });
  }
}
