/**
 * GET /api/community-ai/strategic-memory
 *
 * Read-only by default. Returns current_snapshot (latest) and trend (from last 3 snapshots).
 * Query: campaign_id (required). Optional: generate=1 to manually create a snapshot (safe-call only).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import {
  getCurrentStrategicMemorySnapshot,
  getStrategicMemoryTrend,
  generateStrategicMemorySnapshot,
} from '../../../backend/services/strategicMemoryService';

function getCampaignId(req: NextApiRequest): string | null {
  const fromQuery = req.query?.campaign_id;
  if (typeof fromQuery === 'string') return fromQuery;
  const fromBody = (req.body as Record<string, unknown> | undefined)?.campaign_id;
  if (typeof fromBody === 'string') return fromBody;
  return null;
}

function shouldGenerate(req: NextApiRequest): boolean {
  const v = req.query?.generate;
  return v === '1' || v === 'true';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaign_id = getCampaignId(req);
  const access = await requireCampaignAccess(req, res, campaign_id ?? '');
  if (!access) return;

  const campaignId = access.campaignId;

  try {
    if (shouldGenerate(req)) {
      await generateStrategicMemorySnapshot(campaignId);
    }

    const [current_snapshot, trend] = await Promise.all([
      getCurrentStrategicMemorySnapshot(campaignId),
      getStrategicMemoryTrend(campaignId),
    ]);

    return res.status(200).json({
      current_snapshot: current_snapshot ?? null,
      trend,
    });
  } catch (error: any) {
    console.error('[strategic-memory]', error?.message);
    return res.status(500).json({ error: 'Failed to load or generate strategic memory' });
  }
}
