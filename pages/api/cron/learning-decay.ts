// AUTH EXEMPT: cron endpoint uses cron-specific authorization

/**
 * GET /api/cron/learning-decay
 *
 * Daily cron â€” applies time-decay to campaign_learnings and seeds
 * global patterns if the table is empty.
 *
 * Schedule: 0 2 * * *  (2am daily)
 * Header:   Authorization: Bearer $CRON_SECRET
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runLearningDecay } from '@/backend/services/learningDecayService';
import { seedGlobalPatterns } from '@/backend/services/globalPatternService';
import { assertCronAuthorized, rejectCronUnauthorized } from '@/backend/utils/cronAuthGuard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    assertCronAuthorized(req);
  } catch (error) {
    if (rejectCronUnauthorized(res, error)) return;
    throw error;
  }

  try {
    const [decayResult, seededCount] = await Promise.all([
      runLearningDecay(),
      seedGlobalPatterns(),
    ]);

    console.log('[cron/learning-decay]', { decayResult, seededCount });
    return res.status(200).json({ success: true, decay: decayResult, patterns_seeded: seededCount });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

