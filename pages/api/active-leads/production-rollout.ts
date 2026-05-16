/**
 * Phase 11 — Production rollout endpoint.
 *
 *   GET    ?companyId=...
 *   GET    ?companyId=...&planId=...&stages=1
 *
 *   POST   { companyId, action:'create', planName, rolloutKind, description?, orderedStages, dependencyMetadata?, boundedBatchSize?, metadata? }
 *   POST   { companyId, action:'approve', planId }
 *   POST   { companyId, action:'execute', planId, expectedStageIndex, checkpointPayload? }
 *   POST   { companyId, action:'fail',    planId, stageIndex, failureReason }
 *   POST   { companyId, action:'rollback', planId }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  approveRolloutPlan,
  createRolloutPlan,
  executeNextStage,
  failStage,
  listRolloutPlans,
  listRolloutStages,
  rollbackPlan,
} from '../../../backend/services/productionRolloutService';
import {
  ROLLOUT_KINDS,
  ROLLOUT_PLAN_STATUSES,
  type RolloutKind,
  type RolloutPlanStatus,
  type RolloutStage,
} from '../../../backend/types/productionRollout';

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
    if (req.query.planId && req.query.stages) {
      const items = await listRolloutStages(companyId, String(req.query.planId));
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listRolloutPlans(companyId, {
      rolloutKind: typeof req.query.rolloutKind === 'string' && ROLLOUT_KINDS.includes(req.query.rolloutKind as RolloutKind) ? (req.query.rolloutKind as RolloutKind) : undefined,
      status: typeof req.query.status === 'string' && ROLLOUT_PLAN_STATUSES.includes(req.query.status as RolloutPlanStatus) ? (req.query.status as RolloutPlanStatus) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[production-rollout GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load rollout state' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['create', 'approve', 'execute', 'fail', 'rollback'].includes(action)) {
    return res.status(400).json({ error: 'companyId and valid action required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'create') {
      const rolloutKind = ROLLOUT_KINDS.includes(body.rolloutKind as RolloutKind) ? (body.rolloutKind as RolloutKind) : null;
      if (!rolloutKind) return res.status(400).json({ error: 'valid rolloutKind required' });
      const plan = await createRolloutPlan({
        organizationId: companyId,
        planName: String(body.planName ?? ''),
        rolloutKind,
        description: typeof body.description === 'string' ? body.description : null,
        orderedStages: Array.isArray(body.orderedStages) ? (body.orderedStages as RolloutStage[]) : [],
        dependencyMetadata: (body.dependencyMetadata as Record<string, unknown>) ?? {},
        boundedBatchSize: typeof body.boundedBatchSize === 'number' ? body.boundedBatchSize : undefined,
        ownerUserId: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, plan });
    }
    if (action === 'approve') {
      const plan = await approveRolloutPlan({ organizationId: companyId, planId: String(body.planId ?? ''), approverUserId: ctx.userId });
      return res.status(200).json({ ok: true, plan });
    }
    if (action === 'execute') {
      const stage = await executeNextStage({
        organizationId: companyId,
        planId: String(body.planId ?? ''),
        expectedStageIndex: Number(body.expectedStageIndex ?? -1),
        verifiedBy: ctx.userId,
        checkpointPayload: (body.checkpointPayload as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, stage });
    }
    if (action === 'fail') {
      const stage = await failStage({
        organizationId: companyId,
        planId: String(body.planId ?? ''),
        stageIndex: Number(body.stageIndex ?? -1),
        failureReason: String(body.failureReason ?? 'unspecified'),
        actorUserId: ctx.userId,
      });
      return res.status(200).json({ ok: true, stage });
    }
    const plan = await rollbackPlan({ organizationId: companyId, planId: String(body.planId ?? ''), actorUserId: ctx.userId });
    return res.status(200).json({ ok: true, plan });
  } catch (err: any) {
    console.error('[production-rollout POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'rollout_action_failed' });
  }
}
