/**
 * Phase 4 — Community recommendation endpoint.
 *
 *   GET    /api/active-leads/recommendations?companyId=...&status=suggested
 *     List recommendations. Optional status filter.
 *
 *   POST   /api/active-leads/recommendations
 *     Body: { companyId, recommendationId, action: 'approve'|'reject'|'dismiss'|'activate' }
 *     Transition a recommendation. Activation creates a listening_sources
 *     row in 'inactive' state.
 *
 * Auth: MANAGE_LISTENING_CAPABILITIES.
 *
 * Activation does NOT start monitoring. The user must run the source via
 * /api/active-leads/executions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  activateRecommendation,
  approveRecommendation,
  dismissRecommendation,
  listRecommendations,
  rejectRecommendation,
} from '../../../backend/services/communityRecommendationService';
import {
  isRecommendationStatus,
  type RecommendationStatus,
} from '../../../backend/types/communityRecommendation';
import { publishRecommendationLifecycleEvent } from '../../../backend/events/listeningEvents';

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

  const statusFilter = isRecommendationStatus(req.query.status) ? (req.query.status as RecommendationStatus) : undefined;
  try {
    const items = await listRecommendations(companyId, { status: statusFilter });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[recommendations GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load recommendations' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as {
    companyId?: string;
    recommendationId?: string;
    action?: string;
  };
  const companyId = body.companyId || '';
  const recommendationId = body.recommendationId || '';
  const action = body.action || '';
  if (!companyId || !recommendationId) {
    return res.status(400).json({ error: 'companyId and recommendationId required' });
  }
  if (!['approve', 'reject', 'dismiss', 'activate'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve|reject|dismiss|activate' });
  }

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    let updated;
    let listeningSourceId: string | null = null;
    if (action === 'approve') {
      updated = await approveRecommendation(companyId, recommendationId, ctx.userId);
    } else if (action === 'reject') {
      updated = await rejectRecommendation(companyId, recommendationId, ctx.userId);
    } else if (action === 'dismiss') {
      updated = await dismissRecommendation(companyId, recommendationId, ctx.userId);
    } else {
      const result = await activateRecommendation(companyId, recommendationId, ctx.userId);
      updated = result.recommendation;
      listeningSourceId = result.listeningSourceId;
    }

    await publishRecommendationLifecycleEvent({
      type:
        action === 'approve' ? 'recommendation.approved'
        : action === 'reject' ? 'recommendation.rejected'
        : action === 'dismiss' ? 'recommendation.dismissed'
        : 'recommendation.activated',
      organization_id: companyId,
      recommendation_id: updated.id,
      source_type: updated.source_type,
      source_identifier: updated.source_identifier,
      actor_user_id: ctx.userId,
      occurred_at: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true, recommendation: updated, listeningSourceId });
  } catch (err: any) {
    if (err?.name === 'RecommendationTransitionError') {
      return res.status(409).json({ ok: false, reason: 'invalid_transition', detail: err.message });
    }
    console.error('[recommendations POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Recommendation update failed' });
  }
}
