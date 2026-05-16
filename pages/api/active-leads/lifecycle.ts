/**
 * Phase 6 — Opportunity lifecycle endpoint.
 *
 *   GET    ?companyId=...&opportunityId=...     — history for one opp
 *   GET    ?companyId=...&board=1               — board counts per state
 *   POST   { companyId, opportunityId, to, reasoning }  — transition
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  getLifecycleBoardCounts,
  listLifecycleHistory,
  transitionLifecycle,
  LifecycleTransitionError,
} from '../../../backend/services/opportunityLifecycleService';
import { isLifecycleState } from '../../../backend/types/opportunityLifecycle';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.board === '1' || req.query.board === 'true') {
      const board = await getLifecycleBoardCounts(companyId);
      return res.status(200).json(board);
    }
    const opportunityId = String(req.query.opportunityId ?? '');
    if (!opportunityId) return res.status(400).json({ error: 'opportunityId required' });
    const history = await listLifecycleHistory(companyId, opportunityId);
    return res.status(200).json({ items: history });
  } catch (err: any) {
    console.error('[lifecycle GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load lifecycle' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as { companyId?: string; opportunityId?: string; to?: string; reasoning?: string };
  const companyId = body.companyId || '';
  const opportunityId = body.opportunityId || '';
  if (!companyId || !opportunityId || !isLifecycleState(body.to)) {
    return res.status(400).json({ error: 'companyId, opportunityId, and valid `to` required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const record = await transitionLifecycle({
      organizationId: companyId,
      opportunityFeedItemId: opportunityId,
      to: body.to,
      actorUserId: ctx.userId,
      reasoning: body.reasoning ?? null,
    });
    // Realtime announce — tenant-scoped, best-effort.
    void publishRealtime({
      organizationId: companyId,
      topic: 'lifecycle',
      eventName: 'lifecycle.changed',
      payload: {
        opportunity_feed_item_id: opportunityId,
        from: record.previous_state,
        to: record.state,
        actor_user_id: ctx.userId,
        transitioned_at: record.transitioned_at,
      },
    });
    return res.status(200).json({ ok: true, record });
  } catch (err: any) {
    if (err instanceof LifecycleTransitionError) {
      return res.status(409).json({ ok: false, reason: 'invalid_transition', detail: err.message, from: err.from, to: err.to });
    }
    console.error('[lifecycle POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Lifecycle transition failed' });
  }
}
