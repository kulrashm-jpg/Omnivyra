import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/cron/learning-decay
 *
 * Daily cron — applies time-decay to campaign_autonomous_learnings and
 * seeds global patterns if the table is empty.
 *
 * Schedule: 0 2 * * *  (2am daily)
 * Header:   x-cron-secret: $CRON_SECRET
 *
 * Phase A containment: gated on AUTONOMOUS_CRON_ENABLED === 'true'
 * (default OFF). When disabled, no learningDecayService /
 * globalPatternService import or call occurs — those services target
 * tables that don't exist in production until Phase B.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  isAutonomousCronEnabled,
  mintCronCorrelationId,
  buildCronSkipReport,
  logCronSkipped,
  logCronFatal,
  probeAutonomousTables,
} from '@/backend/services/autonomousFeatureFlag';

const HANDLER_NAME = 'cron/learning-decay';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[cron/learning-decay] CRON_SECRET not configured; rejecting request to fail closed');
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const correlationId = mintCronCorrelationId('cron-decay');

  if (!isAutonomousCronEnabled()) {
    logCronSkipped(HANDLER_NAME, correlationId);
    return res.status(200).json(buildCronSkipReport(HANDLER_NAME, correlationId));
  }

  try {
    const { supabase } = await import('@/backend/db/supabaseClient');
    const { runLearningDecay } = await import('@/backend/services/learningDecayService');
    const { seedGlobalPatterns } = await import('@/backend/services/globalPatternService');

    await probeAutonomousTables(supabase, HANDLER_NAME, correlationId);

    const [decayResult, seededCount] = await Promise.all([
      runLearningDecay(),
      seedGlobalPatterns(),
    ]);

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level:           'info',
      event:           'cron_completed',
      handler:         HANDLER_NAME,
      correlationId,
      decay:           decayResult,
      patterns_seeded: seededCount,
    }));
    return res.status(200).json({ success: true, correlationId, decay: decayResult, patterns_seeded: seededCount });
  } catch (err: unknown) {
    logCronFatal(HANDLER_NAME, correlationId, err);
    return res.status(500).json({
      error:         err instanceof Error ? err.message : String(err),
      correlationId,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/learning-decay' });
