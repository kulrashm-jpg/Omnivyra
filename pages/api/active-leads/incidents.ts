/**
 * Phase 9 — Incident management endpoint.
 *
 *   GET    ?companyId=...&incidentId=...
 *     Single incident + timeline.
 *
 *   GET    ?companyId=...&status=...&severity=...&category=...
 *     List incidents.
 *
 *   POST   { companyId, action:'create', title, description?, severity?, category, ownerUserId?, linkedEscalationId?, linkedReplayId? }
 *   POST   { companyId, action:'update', incidentId, status?, severity?, ownerUserId?, linkedEscalationId?, linkedReplayId?, note? }
 *   POST   { companyId, action:'note',   incidentId, body }
 *
 * Auth: enforceCompanyAccess + MANAGE_LISTENING_CAPABILITIES on mutations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import {
  addIncidentNote,
  createIncident,
  getIncident,
  listIncidents,
  updateIncident,
} from '../../../backend/services/intelligenceIncidentService';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from '../../../backend/types/intelligenceIncident';

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
    if (req.query.incidentId) {
      const r = await getIncident(companyId, String(req.query.incidentId));
      if (!r.incident) return res.status(404).json({ error: 'incident_not_found' });
      return res.status(200).json(r);
    }
    const status = typeof req.query.status === 'string' && INCIDENT_STATUSES.includes(req.query.status as IncidentStatus) ? (req.query.status as IncidentStatus) : undefined;
    const severity = typeof req.query.severity === 'string' && INCIDENT_SEVERITIES.includes(req.query.severity as IncidentSeverity) ? (req.query.severity as IncidentSeverity) : undefined;
    const category = typeof req.query.category === 'string' && INCIDENT_CATEGORIES.includes(req.query.category as IncidentCategory) ? (req.query.category as IncidentCategory) : undefined;
    const items = await listIncidents(companyId, { status, severity, category });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[incidents GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load incidents' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = String(body.companyId ?? '');
  const action = String(body.action ?? '');
  if (!companyId || !['create', 'update', 'note'].includes(action)) {
    return res.status(400).json({ error: 'companyId and action ∈ create|update|note required' });
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
      const incident = await createIncident({
        organizationId: companyId,
        title: String(body.title ?? ''),
        description: typeof body.description === 'string' ? body.description : null,
        severity: typeof body.severity === 'string' && INCIDENT_SEVERITIES.includes(body.severity as IncidentSeverity) ? (body.severity as IncidentSeverity) : 'sev3',
        category: INCIDENT_CATEGORIES.includes(body.category as IncidentCategory) ? (body.category as IncidentCategory) : 'other',
        ownerUserId: typeof body.ownerUserId === 'string' ? body.ownerUserId : null,
        linkedEscalationId: typeof body.linkedEscalationId === 'string' ? body.linkedEscalationId : null,
        linkedReplayId: typeof body.linkedReplayId === 'string' ? body.linkedReplayId : null,
        metadata: (body.metadata as Record<string, unknown>) ?? {},
        createdBy: ctx.userId,
      });
      return res.status(200).json({ ok: true, incident });
    }
    if (action === 'update') {
      const incident = await updateIncident({
        organizationId: companyId,
        incidentId: String(body.incidentId ?? ''),
        status: typeof body.status === 'string' && INCIDENT_STATUSES.includes(body.status as IncidentStatus) ? (body.status as IncidentStatus) : undefined,
        severity: typeof body.severity === 'string' && INCIDENT_SEVERITIES.includes(body.severity as IncidentSeverity) ? (body.severity as IncidentSeverity) : undefined,
        ownerUserId: typeof body.ownerUserId !== 'undefined' ? (body.ownerUserId as string | null) : undefined,
        linkedEscalationId: typeof body.linkedEscalationId !== 'undefined' ? (body.linkedEscalationId as string | null) : undefined,
        linkedReplayId: typeof body.linkedReplayId !== 'undefined' ? (body.linkedReplayId as string | null) : undefined,
        note: typeof body.note === 'string' ? body.note : null,
        actorUserId: ctx.userId,
      });
      return res.status(200).json({ ok: true, incident });
    }
    const entry = await addIncidentNote({
      organizationId: companyId,
      incidentId: String(body.incidentId ?? ''),
      body: String(body.body ?? ''),
      actorUserId: ctx.userId,
    });
    return res.status(200).json({ ok: true, entry });
  } catch (err: any) {
    console.error('[incidents POST] failed:', err?.message);
    return res.status(500).json({ ok: false, error: err?.message ?? 'incident_failed' });
  }
}
