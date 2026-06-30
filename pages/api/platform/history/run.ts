import type { NextApiRequest, NextApiResponse } from 'next';
import { runManualSnapshot } from '../../../../backend/services/platformIntelligence/history/platformSnapshotScheduler';

/**
 * POST /api/platform/history/run — runs the platform snapshot job for one company.
 * Service-role protected via the PLATFORM_HISTORY_RUN_SECRET header (cron/back-office only).
 * Composes every registered plugin once (shared context) and persists the batch.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const secret = process.env.PLATFORM_HISTORY_RUN_SECRET;
  const provided = req.headers['x-platform-run-key'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'service-role authorization required' });

  const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id.trim() : '';
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  try {
    const result = await runManualSnapshot(companyId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Snapshot job failed' });
  }
}
