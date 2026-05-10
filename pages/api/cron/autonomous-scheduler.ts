
/**
 * GET /api/cron/autonomous-scheduler
 *
 * Daily cron endpoint for the autonomous campaign scheduler.
 * Protected by CRON_SECRET header.
 *
 * Configure in Vercel cron or Railway cron:
 *   Schedule: 0 6 * * *  (6am daily)
 *   Header:   x-cron-secret: $CRON_SECRET
 *
 * Phase A containment: this handler is gated on
 *   AUTONOMOUS_CRON_ENABLED === 'true'
 * Default OFF — when disabled, the handler returns 200 with a structured
 * skip report and does NOT import or call any autonomous-feature service
 * (those services touch tables that don't exist in production until the
 * Phase B canonical migration lands).
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

const HANDLER_NAME = 'cron/autonomous-scheduler';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[cron/autonomous-scheduler] CRON_SECRET not configured; rejecting request to fail closed');
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const correlationId = mintCronCorrelationId('cron-autosched');

  // Phase A kill-switch — must come BEFORE any autonomous-feature import
  // or DB query. When disabled, no schema is read and no service that
  // assumes the autonomous tables is invoked.
  if (!isAutonomousCronEnabled()) {
    logCronSkipped(HANDLER_NAME, correlationId);
    return res.status(200).json(buildCronSkipReport(HANDLER_NAME, correlationId));
  }

  try {
    // Lazy import — keep the autonomous-feature module out of the
    // module graph for disabled invocations so the file can't be
    // pulled in before the flag check.
    const { supabase } = await import('@/backend/db/supabaseClient');
    const { runAutonomousScheduler } = await import('@/backend/services/autonomousScheduler');

    // One-shot probe: warn if operator enabled the flag without the
    // Phase B migration applied. Continue regardless — the underlying
    // service will surface the real failure.
    await probeAutonomousTables(supabase, HANDLER_NAME, correlationId);

    const result = await runAutonomousScheduler();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level:         'info',
      event:         'cron_completed',
      handler:       HANDLER_NAME,
      correlationId,
      result,
    }));
    return res.status(200).json({ success: true, correlationId, result });
  } catch (err: unknown) {
    logCronFatal(HANDLER_NAME, correlationId, err);
    return res.status(500).json({
      error:         err instanceof Error ? err.message : String(err),
      correlationId,
    });
  }
}
