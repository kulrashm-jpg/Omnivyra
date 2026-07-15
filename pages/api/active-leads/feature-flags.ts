import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 8 — Feature flag endpoint.
 *
 *   GET   ?companyId=...
 *   POST  { companyId, action: 'upsert'|'activate'|'revert'|'evaluate', ... }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  activateFlag,
  evaluateFeatureFlag,
  listFeatureFlags,
  revertFlag,
  upsertFeatureFlag,
} from '../../../backend/services/featureFlagService';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

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
    const items = await listFeatureFlags(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[feature-flags GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load feature flags' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['upsert', 'activate', 'revert', 'evaluate'].includes(action)) {
    return res.status(400).json({ error: 'companyId, action ∈ upsert|activate|revert|evaluate required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  if (action !== 'evaluate') {
    const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
    if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
    if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  }
  try {
    if (action === 'upsert') {
      const result = await upsertFeatureFlag({
        organizationId: companyId,
        flagKey: String(body.flagKey ?? ''),
        enabled: body.enabled === true,
        rolloutCohort: typeof body.rolloutCohort === 'string' ? body.rolloutCohort : null,
        rolloutPercent: typeof body.rolloutPercent === 'number' ? body.rolloutPercent : null,
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
        createdBy: ctx.userId,
      });
      return res.status(200).json({ ok: true, flag: result });
    }
    if (action === 'activate') {
      const result = await activateFlag({ organizationId: companyId, flagId: String(body.flagId ?? ''), actorUserId: ctx.userId });
      void publishRealtime({
        organizationId: companyId,
        topic: 'rollout',
        eventName: 'rollout.activated',
        payload: { flag_key: result?.flag_key, version: 1 },
      });
      return res.status(200).json({ ok: true, flag: result });
    }
    if (action === 'revert') {
      const result = await revertFlag({ organizationId: companyId, flagId: String(body.flagId ?? ''), actorUserId: ctx.userId });
      void publishRealtime({
        organizationId: companyId,
        topic: 'rollout',
        eventName: 'rollout.reverted',
        payload: { flag_key: result?.flag_key },
      });
      return res.status(200).json({ ok: true, flag: result });
    }
    const result = await evaluateFeatureFlag({
      organizationId: companyId,
      flagKey: String(body.flagKey ?? ''),
      cohortKey: typeof body.cohortKey === 'string' ? body.cohortKey : null,
      cohortValue: typeof body.cohortValue === 'string' ? body.cohortValue : undefined,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[feature-flags POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Feature flag action failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/feature-flags' });
