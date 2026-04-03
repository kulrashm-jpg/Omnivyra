import type { NextApiRequest, NextApiResponse } from 'next';
import { runReportAutomationCycle } from '@/backend/services/reportAutomationService';
import { config } from '@/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = config.INTERNAL_METRICS_SECRET;
  if (secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const result = await runReportAutomationCycle();
    console.log('[cron/report-automation]', result);
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('[cron/report-automation] fatal error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
