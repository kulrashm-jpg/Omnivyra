import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 10 — Production safeguards endpoint.
 *
 *   GET    ?companyId=...                          — list states
 *   GET    ?companyId=...&triggers=1&stateId=...   — trigger history
 *
 *   POST   { companyId, action:'report',      safeguardKind, observedValue }
 *   POST   { companyId, action:'override',    safeguardKind, rationale }
 *   POST   { companyId, action:'rearm',       safeguardKind }
 *   POST   { companyId, action:'set_threshold', safeguardKind, newThreshold }
 *   POST   { companyId, action:'disable',     safeguardKind, rationale }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on POST.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  disableSafeguard,
  listSafeguardStates,
  listSafeguardTriggers,
  overrideSafeguard,
  reArmSafeguard,
  reportSafeguardObservation,
  setSafeguardThreshold,
} from '../../../backend/services/productionSafeguardService';
import {
  SAFEGUARD_KINDS,
  type SafeguardKind,
} from '../../../backend/types/productionSafeguard';

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
    if (req.query.triggers) {
      const items = await listSafeguardTriggers(companyId, {
        safeguardStateId: typeof req.query.stateId === 'string' ? req.query.stateId : undefined,
      });
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listSafeguardStates(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[production-safeguards GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load safeguards' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['report', 'override', 'rearm', 'set_threshold', 'disable'].includes(action)) {
    return res.status(400).json({ error: 'companyId and valid action required' });
  }
  const safeguardKind = SAFEGUARD_KINDS.includes(body.safeguardKind as SafeguardKind) ? (body.safeguardKind as SafeguardKind) : null;
  if (!safeguardKind) return res.status(400).json({ error: 'valid safeguardKind required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'report') {
      const state = await reportSafeguardObservation({
        organizationId: companyId,
        safeguardKind,
        observedValue: Number(body.observedValue ?? 0),
        actedBy: ctx.userId,
      });
      return res.status(200).json({ ok: true, state });
    }
    if (action === 'override') {
      const state = await overrideSafeguard({
        organizationId: companyId,
        safeguardKind,
        actorUserId: ctx.userId,
        rationale: String(body.rationale ?? 'operator override'),
      });
      return res.status(200).json({ ok: true, state });
    }
    if (action === 'rearm') {
      const state = await reArmSafeguard({ organizationId: companyId, safeguardKind, actorUserId: ctx.userId });
      return res.status(200).json({ ok: true, state });
    }
    if (action === 'set_threshold') {
      const state = await setSafeguardThreshold({
        organizationId: companyId,
        safeguardKind,
        newThreshold: Number(body.newThreshold ?? 0),
        actorUserId: ctx.userId,
      });
      return res.status(200).json({ ok: true, state });
    }
    const state = await disableSafeguard({
      organizationId: companyId,
      safeguardKind,
      actorUserId: ctx.userId,
      rationale: String(body.rationale ?? 'operator disabled'),
    });
    return res.status(200).json({ ok: true, state });
  } catch (err: any) {
    console.error('[production-safeguards POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'safeguard_action_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/production-safeguards' });
