/**
 * GET /api/governance/replay-event
 * Stage 24 — Deterministic governance replay. Read-only.
 * RBAC: COMPANY_ADMIN minimum.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import {
  replayGovernanceEvent,
  ReplayNotSupportedError,
} from '../../../backend/services/GovernanceReplayService';
import { tryConsumeReplayToken } from '../../../backend/services/GovernanceRateLimiter';
import { supabase } from '../../../backend/db/supabaseClient';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const eventId = (req.query.eventId as string)?.trim?.();
  if (!eventId) {
    return res.status(400).json({ error: 'eventId is required' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const strict = String(req.query.strict || '').toLowerCase() === 'true';

  const rbac = (req as any).rbac;
  if (!rbac?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: event } = await supabase
    .from('campaign_governance_events')
    .select('company_id')
    .eq('id', eventId)
    .maybeSingle();

  if (!event || (event as any).company_id !== companyId) {
    return res.status(404).json({ error: 'Event not found' });
  }

  if (!tryConsumeReplayToken(companyId)) {
    return res.status(429).json({
      code: 'REPLAY_RATE_LIMITED',
      message: 'Replay rate limit exceeded (20 per minute per company)',
    });
  }

  try {
    const result = await replayGovernanceEvent(eventId);
    if (strict && (!result.policyHashMatch || !result.statusMatch)) {
      return res.status(409).json({
        code: 'REPLAY_INTEGRITY_FAILED',
        message: 'Replay integrity check failed in strict mode',
        result,
      });
    }
    return res.status(200).json({ result });
  } catch (err: any) {
    if (err instanceof ReplayNotSupportedError) {
      if ((err as any).code === 'POLICY_HASH_MISMATCH') {
        if (strict) {
          return res.status(409).json({
            code: 'REPLAY_INTEGRITY_FAILED',
            message: 'Replay integrity check failed in strict mode (policy hash mismatch)',
          });
        }
        return res.status(409).json({
          code: 'POLICY_VERSION_MISMATCH',
          message: 'Current governance policy differs from event policy',
        });
      }
      return res.status(422).json({
        code: 'REPLAY_NOT_SUPPORTED',
        message: err.message ?? 'Replay not supported',
      });
    }
    console.error('[governance/replay-event]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
