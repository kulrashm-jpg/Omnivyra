import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/cron/engagement-dispatch-recovery
 *
 * Releases dispatch reservations held by browser-mode engagement actions that
 * no extension ever claimed.
 *
 * A browser send is queued purely by its community_ai_actions row
 * (status='pending' + execution_mode='browser'), and the bulk in-flight guard
 * refuses a new dispatch while one exists — preferring a delayed reply over a
 * duplicate external message. Without this sweep, a row the extension never
 * picks up holds that reservation forever and the thread can never be replied
 * to in bulk again.
 *
 * Only rows that were NEVER claimed are touched (dispatch_lease_id and
 * dispatch_acknowledged_at both NULL), because only then is it provable that no
 * platform call occurred. Claimed-but-unreported rows have unknown delivery
 * state and are deliberately left for an operator.
 *
 * This does NOT mark anything delivered: no engagement_messages row, no
 * platform_message_id, no author_self. It releases a reservation only.
 *
 * Protected by CRON_SECRET. Idempotent and bounded — re-running scans whatever
 * has since become stale. Mirrors the sweep-stuck-publishing pattern.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  recoverAbandonedBrowserDispatches,
} from '../../../backend/services/engagementDispatchRecoveryService';

const BATCH_SIZE = 100;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[cron/engagement-dispatch-recovery] CRON_SECRET not configured; rejecting');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await recoverAbandonedBrowserDispatches({ batchSize: BATCH_SIZE });
    return res.status(200).json({
      success: true,
      ...result,
      message:
        result.released > 0
          ? `${result.released} dispatch reservation(s) expired — no messages were sent`
          : 'No abandoned dispatch reservations',
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Dispatch recovery failed';
    console.error('[cron/engagement-dispatch-recovery]', message);
    return res.status(500).json({ error: message });
  }
}

export default __createApiRoute(handler, { route: '/api/cron/engagement-dispatch-recovery' });
