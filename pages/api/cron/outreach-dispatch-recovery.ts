import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/cron/outreach-dispatch-recovery
 *
 * Hands WS-3 outreach tasks an earlier dispatch returned to `queued` back to
 * the existing per-lead dispatch path, so they are recovered without waiting
 * for an operator to call /api/super-admin/outreach/activate again.
 *
 * Inert unless LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED is exactly `true`. Not
 * scheduled: no vercel.json entry exists for it. Every safety check (approval
 * on record, kill switches, tenant enablement, suppression, contact
 * governance, quota, the compare-and-set claim and the prior-attempt check that
 * never re-sends a possibly delivered message) is the dispatcher's own; see
 * backend/services/leadOutreachRecoverySweep.ts.
 *
 * Protected by CRON_SECRET. Bounded and idempotent — re-running only finds
 * whatever is still queued.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { runOutreachDispatchRecoverySweep } from '../../../backend/services/leadOutreachRecoverySweep';
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/outreach-dispatch-recovery] CRON_SECRET not configured; rejecting');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!bearerTokenMatches(req.headers['authorization'], cronSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runOutreachDispatchRecoverySweep();
    return res.status(200).json({
      success: true,
      ...result,
      message: !result.enabled
        ? 'Outreach dispatch recovery is disabled'
        : result.skipped === 'kill_switch'
          ? 'Lead outreach is globally disabled; nothing was read'
          : `${result.sent} task(s) sent; ${result.unrecoverable} need a human; ${result.leadsDeferred} lead(s) left for a later run`,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Outreach dispatch recovery failed';
    console.error('[cron/outreach-dispatch-recovery]', message);
    return res.status(500).json({ error: message });
  }
}

export default __createApiRoute(handler, { route: '/api/cron/outreach-dispatch-recovery' });
