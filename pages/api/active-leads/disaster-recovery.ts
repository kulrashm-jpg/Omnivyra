import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 10 — Disaster recovery endpoint.
 *
 *   GET    ?companyId=...&plans=1
 *   GET    ?companyId=...&executionId=...
 *   GET    ?companyId=...                              — list executions
 *
 *   POST   { companyId, action:'upsert_plan', id?, planKind, name, description?, orderedSteps, expectedRuntimeMinutes?, boundedBatchSize?, enabled?, metadata? }
 *   POST   { companyId, action:'stage',   planId, metadata? }
 *   POST   { companyId, action:'approve', executionId }
 *   POST   { companyId, action:'execute', executionId }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 * Critical action (`execute`) requires the execution to be in `approved` state,
 * with a separate `approve` call having been made (typically by a different user).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  approveRecovery,
  executeRecovery,
  listDrPlans,
  listRecoveryExecutions,
  stageRecovery,
  upsertDrPlan,
} from '../../../backend/services/disasterRecoveryService';
import {
  DR_EXECUTION_STATUSES,
  DR_PLAN_KINDS,
  type DrExecutionStatus,
  type DrPlanKind,
  type DrStep,
} from '../../../backend/types/disasterRecovery';

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
    if (req.query.plans) {
      const items = await listDrPlans(companyId, {
        planKind: typeof req.query.planKind === 'string' && DR_PLAN_KINDS.includes(req.query.planKind as DrPlanKind) ? (req.query.planKind as DrPlanKind) : undefined,
      });
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listRecoveryExecutions(companyId, {
      planKind: typeof req.query.planKind === 'string' && DR_PLAN_KINDS.includes(req.query.planKind as DrPlanKind) ? (req.query.planKind as DrPlanKind) : undefined,
      status: typeof req.query.status === 'string' && DR_EXECUTION_STATUSES.includes(req.query.status as DrExecutionStatus) ? (req.query.status as DrExecutionStatus) : undefined,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[disaster-recovery GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load DR' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert_plan', 'stage', 'approve', 'execute'].includes(action)) {
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
    if (action === 'upsert_plan') {
      const planKind = DR_PLAN_KINDS.includes(body.planKind as DrPlanKind) ? (body.planKind as DrPlanKind) : null;
      if (!planKind) return res.status(400).json({ error: 'valid planKind required' });
      const plan = await upsertDrPlan({
        organizationId: companyId,
        id: typeof body.id === 'string' ? body.id : undefined,
        planKind,
        name: String(body.name ?? ''),
        description: typeof body.description === 'string' ? body.description : null,
        orderedSteps: Array.isArray(body.orderedSteps) ? (body.orderedSteps as DrStep[]) : [],
        expectedRuntimeMinutes: typeof body.expectedRuntimeMinutes === 'number' ? body.expectedRuntimeMinutes : undefined,
        boundedBatchSize: typeof body.boundedBatchSize === 'number' ? body.boundedBatchSize : undefined,
        ownerUserId: ctx.userId,
        enabled: Boolean(body.enabled),
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, plan });
    }
    if (action === 'stage') {
      const exec = await stageRecovery({
        organizationId: companyId,
        planId: String(body.planId ?? ''),
        initiatedBy: ctx.userId,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      });
      return res.status(200).json({ ok: true, execution: exec });
    }
    if (action === 'approve') {
      const exec = await approveRecovery({
        organizationId: companyId,
        executionId: String(body.executionId ?? ''),
        approverUserId: ctx.userId,
      });
      return res.status(200).json({ ok: true, execution: exec });
    }
    const exec = await executeRecovery({
      organizationId: companyId,
      executionId: String(body.executionId ?? ''),
    });
    return res.status(200).json({ ok: true, execution: exec });
  } catch (err: any) {
    console.error('[disaster-recovery POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'dr_action_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/disaster-recovery' });
