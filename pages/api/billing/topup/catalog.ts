import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/billing/topup/catalog
 *
 * Returns the top-up catalog (single source of truth — `lib/billing/topupCatalog.ts`)
 * so the UI never hardcodes packs. Read-only; no auth-sensitive data.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { TOPUP_PACKS } from '@/lib/billing/topupCatalog';

function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    packs: TOPUP_PACKS.map((p) => ({
      id: p.id,
      credits: p.credits,
      price: p.price,
      currency: p.currency,
      label: p.label,
    })),
    note: 'Top-up credits are consumed after monthly plan credits and never expire.',
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/billing/topup/catalog' });
