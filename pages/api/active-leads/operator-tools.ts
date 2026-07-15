import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 8 — Operator tooling endpoint.
 *
 *   GET   ?companyId=...&actionKind=...
 *   POST  { companyId, action: 'pause'|'resume'|'recover_partitions'|'approve_overage', ... }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  approveOverage,
  listOperatorActions,
  pauseListeningSource,
  recoverOrgPartitions,
  resumeListeningSource,
} from '../../../backend/services/operatorToolingService';
import {
  OPERATOR_ACTION_KINDS,
  type OperatorActionKind,
} from '../../../backend/types/operatorAction';
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
    const actionKind = typeof req.query.actionKind === 'string' && OPERATOR_ACTION_KINDS.includes(req.query.actionKind as OperatorActionKind)
      ? (req.query.actionKind as OperatorActionKind)
      : undefined;
    const items = await listOperatorActions(companyId, { actionKind });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[operator-tools GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load operator actions' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['pause', 'resume', 'recover_partitions', 'approve_overage'].includes(action)) {
    return res.status(400).json({ error: 'companyId, action ∈ pause|resume|recover_partitions|approve_overage required' });
  }
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    if (action === 'pause') {
      const result = await pauseListeningSource({
        organizationId: companyId,
        listeningSourceId: String(body.listeningSourceId ?? ''),
        actorUserId: ctx.userId,
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
      });
      void publishRealtime({ organizationId: companyId, topic: 'operator_audit', eventName: 'rollout.activated', payload: { kind: 'pause', target: String(body.listeningSourceId ?? '') } });
      return res.status(200).json(result);
    }
    if (action === 'resume') {
      const result = await resumeListeningSource({
        organizationId: companyId,
        listeningSourceId: String(body.listeningSourceId ?? ''),
        actorUserId: ctx.userId,
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
      });
      return res.status(200).json(result);
    }
    if (action === 'recover_partitions') {
      const result = await recoverOrgPartitions({
        organizationId: companyId,
        actorUserId: ctx.userId,
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
      });
      return res.status(200).json({ ok: true, recovered: result.recovered });
    }
    const result = await approveOverage({
      organizationId: companyId,
      category: body.category as 'embedding' | 'execution' | 'connector' | 'realtime' | 'storage' | 'semantic_indexing',
      units: Number(body.units ?? 0),
      attributionRef: typeof body.attributionRef === 'string' ? body.attributionRef : null,
      actorUserId: ctx.userId,
      rationale: typeof body.rationale === 'string' ? body.rationale : null,
    });
    return res.status(200).json({ ok: true, action: result.action });
  } catch (err: any) {
    console.error('[operator-tools POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Operator action failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/operator-tools' });
