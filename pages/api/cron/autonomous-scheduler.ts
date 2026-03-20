/**
 * GET /api/cron/autonomous-scheduler
 *
 * Daily cron endpoint for the autonomous campaign scheduler.
 * Protected by CRON_SECRET header.
 *
 * Configure in Vercel cron or Railway cron:
 *   Schedule: 0 6 * * *  (6am daily)
 *   Header:   x-cron-secret: $CRON_SECRET
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runAutonomousScheduler } from '@/backend/services/autonomousScheduler';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const result = await runAutonomousScheduler();
    console.log('[cron/autonomous-scheduler]', result);
    return res.status(200).json({ success: true, result });
  } catch (err: unknown) {
    console.error('[cron/autonomous-scheduler] fatal error', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
