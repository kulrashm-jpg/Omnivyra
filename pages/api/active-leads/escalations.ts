/**
 * Phase 6 — Escalation endpoint.
 *
 *   GET    ?companyId=...&status=open
 *   POST   { companyId, escalationType, severity, title, body?, opportunityId? }
 *   PATCH  { companyId, escalationId, action: 'assign'|'status', ... }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  assignEscalation,
  createEscalation,
  listEscalations,
  updateEscalationStatus,
} from '../../../backend/services/escalationService';
import {
  ESCALATION_SEVERITIES,
  ESCALATION_STATUSES,
  ESCALATION_TYPES,
  type EscalationSeverity,
  type EscalationStatus,
  type EscalationType,
} from '../../../backend/types/escalation';
import { publishRealtime } from '../../../backend/services/realtimePublisherService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    const status = typeof req.query.status === 'string' && ESCALATION_STATUSES.includes(req.query.status as EscalationStatus)
      ? (req.query.status as EscalationStatus)
      : undefined;
    const assignedToUserId = typeof req.query.assignedToUserId === 'string' ? String(req.query.assignedToUserId) : undefined;
    const items = await listEscalations(companyId, { status, assignedToUserId });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[escalations GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load escalations' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const escalationType = body.escalationType as EscalationType;
  const severity = (body.severity ?? 'medium') as EscalationSeverity;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!ESCALATION_TYPES.includes(escalationType)) return res.status(400).json({ error: 'invalid escalationType' });
  if (!ESCALATION_SEVERITIES.includes(severity)) return res.status(400).json({ error: 'invalid severity' });
  if (!title) return res.status(400).json({ error: 'title required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }
  try {
    const result = await createEscalation({
      organizationId: companyId,
      opportunityFeedItemId: typeof body.opportunityId === 'string' ? String(body.opportunityId) : null,
      escalationType,
      severity,
      requestedBy: ctx.userId,
      assignedToUserId: typeof body.assignedToUserId === 'string' ? String(body.assignedToUserId) : null,
      title,
      body: typeof body.body === 'string' ? body.body : null,
    });
    void publishRealtime({
      organizationId: companyId,
      topic: 'escalations',
      eventName: 'escalation.created',
      payload: {
        escalation_id: result.id,
        escalation_type: result.escalation_type,
        severity: result.severity,
        opportunity_feed_item_id: result.opportunity_feed_item_id,
      },
    });
    return res.status(200).json({ ok: true, escalation: result });
  } catch (err: any) {
    console.error('[escalations POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Create failed' });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const escalationId = String(body.escalationId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !escalationId || !['assign', 'status'].includes(action)) {
    return res.status(400).json({ error: 'companyId, escalationId, action ∈ assign|status required' });
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
    if (action === 'assign') {
      const assignedTo = String(body.assignedToUserId ?? '');
      if (!assignedTo) return res.status(400).json({ error: 'assignedToUserId required' });
      result = await assignEscalation({
        organizationId: companyId,
        escalationId,
        assignedToUserId: assignedTo,
        actorUserId: ctx.userId,
      });
    } else {
      const status = body.status as EscalationStatus;
      if (!ESCALATION_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
      result = await updateEscalationStatus({
        organizationId: companyId,
        escalationId,
        status,
        actorUserId: ctx.userId,
        reason: typeof body.reason === 'string' ? body.reason : null,
      });
    }
    void publishRealtime({
      organizationId: companyId,
      topic: 'escalations',
      eventName: 'escalation.updated',
      payload: { escalation_id: escalationId, action, actor_user_id: ctx.userId },
    });
    return res.status(200).json({ ok: true, escalation: result });
  } catch (err: any) {
    console.error('[escalations PATCH] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Update failed' });
  }
}
