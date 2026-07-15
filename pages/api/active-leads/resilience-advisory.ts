import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 12 — Resilience advisory planning endpoint.
 *
 *   GET  ?companyId=...&planKind=...&status=...
 *   POST { companyId, action:'generate',  planKind, triggerSummary, boundedBatchSize?, metadata? }
 *   POST { companyId, action:'transition', planId, newStatus }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  generateAdvisoryPlan,
  listAdvisoryPlans,
  transitionAdvisoryStatus,
} from '../../../backend/services/resilienceAdvisoryService';
import {
  RESILIENCE_ADVISORY_PLAN_KINDS,
  RESILIENCE_ADVISORY_STATUSES,
  type ResilienceAdvisoryPlanKind,
  type ResilienceAdvisoryStatus,
} from '../../../backend/types/resilienceAdvisory';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const items = await listAdvisoryPlans(companyId, {
      planKind: typeof req.query.planKind === 'string' && RESILIENCE_ADVISORY_PLAN_KINDS.includes(req.query.planKind as ResilienceAdvisoryPlanKind) ? (req.query.planKind as ResilienceAdvisoryPlanKind) : undefined,
      status: typeof req.query.status === 'string' && RESILIENCE_ADVISORY_STATUSES.includes(req.query.status as ResilienceAdvisoryStatus) ? (req.query.status as ResilienceAdvisoryStatus) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[resilience-advisory GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load advisory plans' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['generate', 'transition'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ generate|transition required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'generate') {
      const planKind = RESILIENCE_ADVISORY_PLAN_KINDS.includes(body.planKind as ResilienceAdvisoryPlanKind) ? (body.planKind as ResilienceAdvisoryPlanKind) : null;
      if (!planKind) return res.status(400).json({ error: 'valid planKind required' });
      const plan = await generateAdvisoryPlan({
        organizationId: companyId,
        planKind,
        triggerSummary: String(body.triggerSummary ?? 'operator-triggered'),
        boundedBatchSize: typeof body.boundedBatchSize === 'number' ? body.boundedBatchSize : undefined,
        generatedBy: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, plan });
    }
    const newStatus = body.newStatus === 'acknowledged' || body.newStatus === 'superseded' || body.newStatus === 'expired' ? (body.newStatus as 'acknowledged' | 'superseded' | 'expired') : null;
    if (!newStatus) return res.status(400).json({ error: 'newStatus must be acknowledged|superseded|expired' });
    const plan = await transitionAdvisoryStatus({
      organizationId: companyId,
      planId: String(body.planId ?? ''),
      newStatus,
      actorUserId: ctx.userId,
    });
    return res.status(200).json({ ok: true, plan });
  } catch (err: any) {
    console.error('[resilience-advisory POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'advisory_action_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/resilience-advisory' });
