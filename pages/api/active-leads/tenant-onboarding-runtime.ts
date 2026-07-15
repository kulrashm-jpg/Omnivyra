import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 11 — Tenant onboarding runtime endpoint.
 *
 *   GET    ?companyId=...                       — list stages + aggregate readiness
 *
 *   POST   { companyId, stageKind, status?, readinessScore?, evidence?, progressionExplanation?, metadata? }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  computeAggregateReadiness,
  listStages,
  updateStage,
} from '../../../backend/services/tenantOnboardingRuntimeService';
import {
  TENANT_ONBOARDING_RUNTIME_STAGES,
  TENANT_ONBOARDING_RUNTIME_STATUSES,
  type TenantOnboardingRuntimeStageKind,
  type TenantOnboardingRuntimeStatus,
} from '../../../backend/types/tenantOnboardingRuntime';

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
    const [items, aggregate] = await Promise.all([
      listStages(companyId),
      computeAggregateReadiness(companyId),
    ]);
    return res.status(200).json({ items, total: items.length, aggregate });
  } catch (err: any) {
    console.error('[tenant-onboarding-runtime GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load tenant onboarding runtime' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const stageKind = TENANT_ONBOARDING_RUNTIME_STAGES.includes(body.stageKind as TenantOnboardingRuntimeStageKind) ? (body.stageKind as TenantOnboardingRuntimeStageKind) : null;
  if (!companyId || !stageKind) return res.status(400).json({ error: 'companyId and valid stageKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const stage = await updateStage({
      organizationId: companyId,
      stageKind,
      status: typeof body.status === 'string' && TENANT_ONBOARDING_RUNTIME_STATUSES.includes(body.status as TenantOnboardingRuntimeStatus) ? (body.status as TenantOnboardingRuntimeStatus) : undefined,
      readinessScore: typeof body.readinessScore === 'number' ? body.readinessScore : undefined,
      evidence: (body.evidence as Record<string, unknown>) ?? undefined,
      progressionExplanation: typeof body.progressionExplanation === 'string' ? body.progressionExplanation : undefined,
      acknowledgedBy: ctx.userId,
      metadata: (body.metadata as Record<string, unknown>) ?? undefined,
    });
    return res.status(200).json({ ok: true, stage });
  } catch (err: any) {
    console.error('[tenant-onboarding-runtime POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'tenant_onboarding_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/tenant-onboarding-runtime' });
