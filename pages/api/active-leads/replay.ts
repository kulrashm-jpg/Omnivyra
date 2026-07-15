import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 7 — Replay operations endpoint.
 *
 *   GET    ?companyId=...&inventory=1&kind=projection   — DLQ inventory
 *   GET    ?companyId=...                                — replay ops history
 *   POST   { companyId, targetKind, itemIds }           — request replay
 *   PATCH  { companyId, replayId, action: 'preview'|'approve'|'execute' }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  approveReplay,
  executeReplay,
  listDLQInventory,
  listReplayOperations,
  previewReplay,
  requestReplay,
} from '../../../backend/services/dlqReplayService';
import {
  REPLAY_TARGET_KINDS,
  type ReplayTargetKind,
} from '../../../backend/types/replayOps';
import { evaluateGovernance } from '../../../backend/services/governanceEnforcementService';
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
    if (req.query.inventory === '1' || req.query.inventory === 'true') {
      const kind = typeof req.query.kind === 'string' && REPLAY_TARGET_KINDS.includes(req.query.kind as ReplayTargetKind)
        ? (req.query.kind as ReplayTargetKind)
        : undefined;
      const items = await listDLQInventory(companyId, { kind });
      return res.status(200).json({ items, total: items.length });
    }
    const items = await listReplayOperations(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[replay GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load replay state' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const targetKind = body.targetKind as ReplayTargetKind;
  const itemIds = Array.isArray(body.itemIds) ? (body.itemIds as string[]).filter((s) => typeof s === 'string') : [];
  if (!companyId || !REPLAY_TARGET_KINDS.includes(targetKind) || itemIds.length === 0) {
    return res.status(400).json({ error: 'companyId, valid targetKind, itemIds[] required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const decision = await evaluateGovernance({
      organizationId: companyId,
      action: 'replay.execute',
      actorUserId: ctx.userId,
      context: { target_kind: targetKind, batch_size: itemIds.length },
    });
    if (decision.decision === 'denied') {
      return res.status(409).json({ ok: false, reason: 'governance_denied', detail: decision.reasons.join(',') });
    }
    const result = await requestReplay({ organizationId: companyId, targetKind, itemIds, requestedBy: ctx.userId });
    void publishRealtime({
      organizationId: companyId,
      topic: 'governance' as never,
      eventName: 'replay.requested',
      payload: { replay_id: result.id, target_kind: targetKind, batch_size: result.batch_size },
    });
    return res.status(200).json({ ok: true, replay: result });
  } catch (err: any) {
    console.error('[replay POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Replay request failed' });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const replayId = String(body.replayId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !replayId || !['preview', 'approve', 'execute'].includes(action)) {
    return res.status(400).json({ error: 'companyId, replayId, action ∈ preview|approve|execute required' });
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
    if (action === 'preview') {
      result = await previewReplay({ organizationId: companyId, replayId });
    } else if (action === 'approve') {
      result = await approveReplay({ organizationId: companyId, replayId, approverUserId: ctx.userId });
    } else {
      result = await executeReplay({ organizationId: companyId, replayId, executorUserId: ctx.userId });
      void publishRealtime({
        organizationId: companyId,
        topic: 'governance' as never,
        eventName: 'replay.executed',
        payload: { replay_id: result.id, target_kind: result.target_kind, status: result.status },
      });
    }
    return res.status(200).json({ ok: true, replay: result });
  } catch (err: any) {
    console.error('[replay PATCH] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Replay update failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/replay' });
