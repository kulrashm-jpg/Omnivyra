import type { NextApiRequest, NextApiResponse } from 'next';
import { ingestPerformanceData } from '../../../backend/services/performanceIngestionService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platform, contentAssetId, metrics, capturedAt } = req.body || {};
    if (!platform || !contentAssetId || !metrics) {
      return res.status(400).json({ error: 'platform, contentAssetId, metrics are required' });
    }
    await ingestPerformanceData({ platform, contentAssetId, metrics, capturedAt });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to ingest performance' });
  }
}
