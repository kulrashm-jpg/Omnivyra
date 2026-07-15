import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 7 — Governance policy endpoint.
 *
 *   GET    ?companyId=...                                — list policies
 *   GET    ?companyId=...&policyKey=...&status=active    — filtered list
 *   GET    ?companyId=...&events=1                       — enforcement events
 *   POST   { companyId, policyKey, body, rationale }     — create draft
 *   PATCH  { companyId, policyId, action: activate|archive }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  activatePolicyDraft,
  archivePolicy,
  createPolicyDraft,
  listPoliciesForOrg,
} from '../../../backend/services/governancePolicyService';
import { listEnforcementEvents } from '../../../backend/services/governanceEnforcementService';
import {
  GOVERNANCE_POLICY_KEYS,
  GOVERNANCE_POLICY_STATUSES,
  type GovernancePolicyKey,
  type GovernancePolicyStatus,
} from '../../../backend/types/governancePolicy';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'PATCH') return handlePatch(req, res);
  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.events === '1' || req.query.events === 'true') {
      const items = await listEnforcementEvents(companyId);
      return res.status(200).json({ items, total: items.length });
    }
    const policyKey = typeof req.query.policyKey === 'string' && GOVERNANCE_POLICY_KEYS.includes(req.query.policyKey as GovernancePolicyKey)
      ? (req.query.policyKey as GovernancePolicyKey)
      : undefined;
    const status = typeof req.query.status === 'string' && GOVERNANCE_POLICY_STATUSES.includes(req.query.status as GovernancePolicyStatus)
      ? (req.query.status as GovernancePolicyStatus)
      : undefined;
    const items = await listPoliciesForOrg(companyId, { policyKey, status });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[governance GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load policies' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const policyKey = body.policyKey as GovernancePolicyKey;
  if (!companyId || !GOVERNANCE_POLICY_KEYS.includes(policyKey)) {
    return res.status(400).json({ error: 'companyId and valid policyKey required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const result = await createPolicyDraft({
      organizationId: companyId,
      policyKey,
      body: (body.body ?? {}) as Record<string, unknown>,
      rationale: typeof body.rationale === 'string' ? body.rationale : null,
      createdBy: ctx.userId,
    });
    void publishRealtime({
      organizationId: companyId,
      topic: 'governance' as never,
      eventName: 'governance.policy_updated',
      payload: { policy_id: result.id, policy_key: policyKey, version: result.version, status: result.status },
    });
    return res.status(200).json({ ok: true, policy: result });
  } catch (err: any) {
    console.error('[governance POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Policy draft create failed' });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const policyId = String(body.policyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !policyId || !['activate', 'archive'].includes(action)) {
    return res.status(400).json({ error: 'companyId, policyId, action ∈ activate|archive required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    let result;
    if (action === 'activate') {
      result = await activatePolicyDraft({ organizationId: companyId, policyDraftId: policyId, actorUserId: ctx.userId });
      void publishRealtime({
        organizationId: companyId,
        topic: 'governance' as never,
        eventName: 'governance.policy_activated',
        payload: { policy_id: result.id, policy_key: result.policy_key, version: result.version },
      });
    } else {
      result = await archivePolicy({ organizationId: companyId, policyId });
    }
    return res.status(200).json({ ok: true, policy: result });
  } catch (err: any) {
    console.error('[governance PATCH] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Policy update failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/governance' });
