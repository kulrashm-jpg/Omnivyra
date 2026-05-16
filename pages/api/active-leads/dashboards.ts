/**
 * Phase 8 — Strategic dashboards endpoint.
 *
 *   GET ?companyId=...&windowHours=720
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getStrategicDashboardTiles } from '../../../backend/services/strategicDashboardsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const windowHours = typeof req.query.windowHours === 'string' ? Number(req.query.windowHours) : undefined;
  try {
    const tiles = await getStrategicDashboardTiles(
      companyId,
      Number.isFinite(windowHours) ? Math.max(1, Math.min(24 * 365, Number(windowHours))) : undefined,
    );
    return res.status(200).json({ tiles, total: tiles.length });
  } catch (err: any) {
    console.error('[dashboards GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load dashboards' });
  }
}
